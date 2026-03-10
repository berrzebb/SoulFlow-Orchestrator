/**
 * 워크플로우 trigger_nodes → 런타임 서비스 자동 동기화.
 * - cron → CronService 등록/동기화
 * - webhook → WebhookStore 폴링
 * - channel_message → bus inbound 구독
 * - kanban_event → KanbanStore subscribe
 * - filesystem_watch → fs.watch 폴더 감시
 * - manual → 대시보드 수동 실행 (별도 처리 불필요)
 */

import { watch as fs_watch } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve as path_resolve, relative as path_relative } from "node:path";
import { randomUUID } from "node:crypto";
import { minimatch } from "minimatch";
import type { CronScheduler } from "./contracts.js";
import type { TemplateWithSlug } from "../orchestration/workflow-loader.js";
import type { TriggerNodeRecord } from "../agent/phase-loop.types.js";
import type { MessageBusLike, MessageBusTap } from "../bus/index.js";
import type { WebhookStore } from "../services/webhook-store.service.js";
import type { KanbanStoreLike, KanbanEvent } from "../services/kanban-store.js";
import { create_logger } from "../logger.js";

const log = create_logger("workflow-trigger-sync");

/** 워크플로우 실행 콜백. */
export type WorkflowExecuteFn = (slug: string, channel: string, chat_id: string, trigger_data?: Record<string, unknown>) => Promise<{ ok: boolean; workflow_id?: string; error?: string }>;

/** 동기화 결과. */
export interface TriggerSyncResult {
  cron: { added: number; removed: number; updated: number };
  webhook: { registered: number };
  channel_message: { registered: number };
  kanban_event: { registered: number };
  filesystem_watch: { registered: number };
}

interface TriggerEntry {
  slug: string;
  trigger: TriggerNodeRecord;
}

/** 워크플로우에서 모든 trigger_nodes 추출. */
function extract_triggers(templates: TemplateWithSlug[]): TriggerEntry[] {
  const results: TriggerEntry[] = [];
  for (const t of templates) {
    if (t.trigger_nodes?.length) {
      for (const tn of t.trigger_nodes) {
        results.push({ slug: t.slug, trigger: tn });
      }
    } else if (t.trigger?.type === "cron" && t.trigger.schedule) {
      results.push({
        slug: t.slug,
        trigger: { id: "__cron__", trigger_type: "cron", schedule: t.trigger.schedule, timezone: t.trigger.timezone },
      });
    }
  }
  return results;
}

// ── Cron Sync ──

async function sync_cron_triggers(
  cron: CronScheduler,
  entries: TriggerEntry[],
): Promise<TriggerSyncResult["cron"]> {
  const cron_entries = entries.filter((e) => e.trigger.trigger_type === "cron" && e.trigger.schedule);
  const desired = new Map(cron_entries.map((e) => [e.slug, e]));

  const existing_jobs = await cron.list_jobs(true);
  const wf_jobs = existing_jobs.filter((j) => j.payload.message.startsWith("workflow_trigger:"));

  let added = 0, removed = 0, updated = 0;

  for (const job of wf_jobs) {
    const slug = job.payload.message.replace("workflow_trigger:", "");
    const want = desired.get(slug);
    if (!want) {
      await cron.remove_job(job.id);
      removed++;
      log.info("cron trigger removed", { slug, job_id: job.id });
      continue;
    }
    // schedule 변경 감지
    if ((job.schedule.expr || "") !== want.trigger.schedule || (job.schedule.tz || "") !== (want.trigger.timezone || "")) {
      await cron.remove_job(job.id);
      await cron.add_job(
        `workflow: ${slug}`,
        { kind: "cron", expr: want.trigger.schedule!, tz: want.trigger.timezone || null, at_ms: null, every_ms: null },
        `workflow_trigger:${slug}`,
        false, null, null, false,
      );
      updated++;
      log.info("cron trigger updated", { slug, schedule: want.trigger.schedule });
    }
    desired.delete(slug);
  }

  for (const [slug, entry] of desired) {
    await cron.add_job(
      `workflow: ${slug}`,
      { kind: "cron", expr: entry.trigger.schedule!, tz: entry.trigger.timezone || null, at_ms: null, every_ms: null },
      `workflow_trigger:${slug}`,
      false, null, null, false,
    );
    added++;
    log.info("cron trigger added", { slug, schedule: entry.trigger.schedule });
  }

  if (added || removed || updated) log.info("cron sync done", { added, removed, updated });
  return { added, removed, updated };
}

// ── Webhook Polling ──

const WEBHOOK_POLL_INTERVAL_MS = 5_000;

function start_webhook_polling(
  entries: TriggerEntry[],
  webhook_store: WebhookStore,
  execute: WorkflowExecuteFn,
  default_channel: string,
  default_chat_id: string,
  abort: AbortSignal,
): number {
  const webhook_entries = entries.filter((e) => e.trigger.trigger_type === "webhook" && e.trigger.webhook_path);
  if (!webhook_entries.length) return 0;

  const poll = async () => {
    for (const entry of webhook_entries) {
      if (abort.aborted) return;
      const path = entry.trigger.webhook_path!;
      try {
        const data = await webhook_store.get(path);
        if (!data) continue;
        log.info("webhook trigger fired", { slug: entry.slug, path, method: data.method });
        const channel = entry.trigger.channel_type || default_channel;
        const chat_id = entry.trigger.chat_id || default_chat_id;
        const result = await execute(entry.slug, channel, chat_id, { webhook: data });
        if (!result.ok) log.warn("webhook trigger failed", { slug: entry.slug, error: result.error });
      } catch (e) {
        log.warn("webhook poll error", { slug: entry.slug, path, error: String(e) });
      }
    }
  };

  const timer = setInterval(() => { if (!abort.aborted) void poll(); }, WEBHOOK_POLL_INTERVAL_MS);
  abort.addEventListener("abort", () => clearInterval(timer), { once: true });

  log.info("webhook polling started", { count: webhook_entries.length, paths: webhook_entries.map((e) => e.trigger.webhook_path) });
  return webhook_entries.length;
}

// ── Channel Message Subscription ──

function subscribe_channel_message_triggers(
  entries: TriggerEntry[],
  bus: MessageBusLike & MessageBusTap,
  execute: WorkflowExecuteFn,
): number {
  const msg_entries = entries.filter((e) => e.trigger.trigger_type === "channel_message");
  if (!msg_entries.length) return 0;

  bus.on_publish((dir, msg) => {
    if (dir !== "inbound") return;
    for (const entry of msg_entries) {
      const want_channel = entry.trigger.channel_type;
      const want_chat = entry.trigger.chat_id;
      if (want_channel && msg.channel !== want_channel) continue;
      if (want_chat && msg.chat_id !== want_chat) continue;
      log.info("channel_message trigger fired", { slug: entry.slug, channel: msg.channel, chat_id: msg.chat_id });
      void execute(entry.slug, msg.channel || msg.provider, msg.chat_id, { message: msg }).catch((e) => {
        log.warn("channel_message trigger failed", { slug: entry.slug, error: String(e) });
      });
    }
  });

  log.info("channel_message triggers subscribed", { count: msg_entries.length });
  return msg_entries.length;
}

// ── Kanban Event Subscription ──

const _kanban_unsubs: Array<() => void> = [];

function subscribe_kanban_triggers(
  entries: TriggerEntry[],
  kanban_store: KanbanStoreLike | null,
  execute: WorkflowExecuteFn,
  default_channel: string,
  default_chat_id: string,
): number {
  // 이전 구독 해제
  for (const unsub of _kanban_unsubs) unsub();
  _kanban_unsubs.length = 0;

  if (!kanban_store) return 0;
  const kb_entries = entries.filter((e) => e.trigger.trigger_type === "kanban_event" && e.trigger.kanban_board_id);
  if (!kb_entries.length) return 0;

  for (const entry of kb_entries) {
    const board_id = entry.trigger.kanban_board_id!;
    const actions = new Set(entry.trigger.kanban_actions || []);
    const column_id = entry.trigger.kanban_column_id;

    const listener = (event: KanbanEvent) => {
      const activity = event.data;
      if (actions.size && !actions.has(activity.action)) return;
      if (column_id && activity.detail?.column_id !== column_id) return;
      log.info("kanban_event trigger fired", { slug: entry.slug, board_id, action: activity.action, card_id: activity.card_id });
      const channel = entry.trigger.channel_type || default_channel;
      const chat_id = entry.trigger.chat_id || default_chat_id;
      void execute(entry.slug, channel, chat_id, { kanban_event: event }).catch((e) => {
        log.warn("kanban_event trigger failed", { slug: entry.slug, error: String(e) });
      });
    };

    kanban_store.subscribe(board_id, listener);
    _kanban_unsubs.push(() => kanban_store.unsubscribe(board_id, listener));
  }

  log.info("kanban_event triggers subscribed", { count: kb_entries.length });
  return kb_entries.length;
}

// ── Filesystem Watch ──

const DEFAULT_BATCH_MS = 500;

const _fs_watchers: Array<() => void> = [];

function start_filesystem_watch_triggers(
  entries: TriggerEntry[],
  execute: WorkflowExecuteFn,
  default_channel: string,
  default_chat_id: string,
  workspace: string,
): number {
  // 이전 감시자 정리
  for (const stop of _fs_watchers) stop();
  _fs_watchers.length = 0;

  const fs_entries = entries.filter((e) => e.trigger.trigger_type === "filesystem_watch" && e.trigger.watch_path);
  if (!fs_entries.length) return 0;

  for (const entry of fs_entries) {
    const rel_path = entry.trigger.watch_path!;
    const abs_path = path_resolve(workspace, rel_path);
    const events_filter = new Set(entry.trigger.watch_events?.length ? entry.trigger.watch_events : ["add"]);
    const pattern = entry.trigger.watch_pattern?.trim() || undefined;
    const batch_ms = entry.trigger.watch_batch_ms ?? DEFAULT_BATCH_MS;

    // 배치 수집 버퍼
    type FileChange = { path: string; event: string };
    const pending = new Map<string, FileChange>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      if (!pending.size) return;
      const snapshot = [...pending.values()];
      pending.clear();

      const channel = entry.trigger.channel_type || default_channel;
      const chat_id = entry.trigger.chat_id || default_chat_id;

      // 파일 크기 비동기 조회 후 실행
      void Promise.all(
        snapshot.map(async (f) => {
          let size_bytes = 0;
          if (f.event !== "unlink") {
            try { size_bytes = (await stat(f.path)).size; } catch { /* 삭제 직후 등 무시 */ }
          }
          return { path: path_relative(workspace, f.path), event: f.event, size_bytes };
        }),
      ).then((files) => {
        const payload = {
          files,
          batch_id: randomUUID(),
          triggered_at: new Date().toISOString(),
          watch_path: rel_path,
        };
        log.info("filesystem_watch trigger fired", { slug: entry.slug, count: files.length, watch_path: rel_path });
        void execute(entry.slug, channel, chat_id, { filesystem_event: payload }).catch((e) => {
          log.warn("filesystem_watch trigger failed", { slug: entry.slug, error: String(e) });
        });
      });
    };

    let watcher: ReturnType<typeof fs_watch> | null = null;
    try {
      watcher = fs_watch(abs_path, { recursive: true }, (event_type, filename) => {
        if (!filename) return;
        const abs_file = path_resolve(abs_path, filename);
        const rel_file = path_relative(workspace, abs_file);

        // glob 패턴 필터
        if (pattern && !minimatch(rel_file, pattern, { dot: true })) return;

        // fs.watch는 "rename" | "change" 두 종류만 발생 — "rename"은 add/unlink 모두 포함
        // stat으로 존재 여부 확인 후 add/unlink 구분은 flush 시점에 처리
        const mapped_event = event_type === "change" ? "change" : "add";
        if (!events_filter.has(mapped_event as "add" | "change" | "unlink")) return;

        pending.set(abs_file, { path: abs_file, event: mapped_event });
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, batch_ms);
      });
    } catch (err) {
      log.warn("filesystem_watch setup failed", { slug: entry.slug, watch_path: abs_path, error: String(err) });
      continue;
    }

    _fs_watchers.push(() => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    });
  }

  log.info("filesystem_watch triggers started", { count: fs_entries.length, paths: fs_entries.map((e) => e.trigger.watch_path) });
  return fs_entries.length;
}

// ── Public API ──

export interface WorkflowTriggerSyncDeps {
  cron: CronScheduler;
  bus: MessageBusLike & MessageBusTap;
  webhook_store: WebhookStore;
  kanban_store: KanbanStoreLike | null;
  execute: WorkflowExecuteFn;
  default_channel: string;
  default_chat_id: string;
  /** 파일시스템 트리거의 기준 디렉토리 (workspace 루트). */
  workspace?: string;
}

let _abort: AbortController | null = null;

/**
 * 워크플로우 트리거 전체 동기화.
 * 부팅 시 + 워크플로우 저장/삭제 시 호출.
 */
export async function sync_all_workflow_triggers(
  templates: TemplateWithSlug[],
  deps: WorkflowTriggerSyncDeps,
): Promise<TriggerSyncResult> {
  // 기존 폴링 정리
  _abort?.abort();
  _abort = new AbortController();

  const all_triggers = extract_triggers(templates);

  const cron_result = await sync_cron_triggers(deps.cron, all_triggers);

  const webhook_registered = start_webhook_polling(
    all_triggers, deps.webhook_store, deps.execute,
    deps.default_channel, deps.default_chat_id, _abort.signal,
  );

  const channel_registered = subscribe_channel_message_triggers(all_triggers, deps.bus, deps.execute);

  const kanban_registered = subscribe_kanban_triggers(
    all_triggers, deps.kanban_store, deps.execute,
    deps.default_channel, deps.default_chat_id,
  );

  const fs_registered = start_filesystem_watch_triggers(
    all_triggers, deps.execute,
    deps.default_channel, deps.default_chat_id,
    deps.workspace ?? process.cwd(),
  );

  return {
    cron: cron_result,
    webhook: { registered: webhook_registered },
    channel_message: { registered: channel_registered },
    kanban_event: { registered: kanban_registered },
    filesystem_watch: { registered: fs_registered },
  };
}
