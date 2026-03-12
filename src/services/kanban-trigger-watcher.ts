/** Kanban Trigger Watcher — waiting 상태 워크플로우를 kanban 이벤트로 자동 resume. */

import { create_logger } from "../logger.js";
import { error_message } from "../utils/common.js";
import type { KanbanStoreLike, KanbanEvent } from "./kanban-store.js";

const log = create_logger("kanban-trigger-watcher");

interface PendingTriggerMeta {
  node_id: string;
  board_id: string;
  actions?: string[];
  column_id?: string;
}

interface WorkflowStoreMinimal {
  list(): Promise<Array<{ workflow_id: string; status: string; memory: Record<string, unknown> }>>;
  get(workflow_id: string): Promise<{ workflow_id: string; status: string; memory: Record<string, unknown> } | null>;
  upsert(state: never): Promise<void>;
}

interface WorkflowResumer {
  resume(workflow_id: string): Promise<{ ok: boolean; error?: string }>;
}

export interface KanbanTriggerWatcher {
  /** 특정 워크플로우가 waiting 전환되었음을 즉시 알림 → 스캔 대기 없이 구독. */
  notify(workflow_id: string): void;
  dispose(): void;
}

/**
 * waiting_user_input 상태의 워크플로우 중 `__pending_kanban_trigger`가 있는 것을 찾아,
 * 해당 board의 kanban 이벤트를 구독하여 매칭 시 자동 resume.
 */
export async function setup_kanban_trigger_watcher(opts: {
  kanban_store: KanbanStoreLike;
  workflow_store: WorkflowStoreMinimal;
  resumer: WorkflowResumer;
}): Promise<KanbanTriggerWatcher> {
  const { kanban_store, workflow_store, resumer } = opts;
  const subscriptions = new Map<string, { board_id: string; listener: (e: KanbanEvent) => void }>();

  async function scan_and_subscribe(): Promise<void> {
    const all = await workflow_store.list();
    const waiting = all.filter((w) => w.status === "waiting_user_input" && w.memory?.__pending_kanban_trigger);

    for (const wf of waiting) {
      if (subscriptions.has(wf.workflow_id)) continue;
      const meta = wf.memory.__pending_kanban_trigger as PendingTriggerMeta;
      if (!meta?.board_id) continue;
      subscribe_for_workflow(wf.workflow_id, meta);
    }
  }

  function subscribe_for_workflow(workflow_id: string, meta: PendingTriggerMeta): void {
    const listener = (event: KanbanEvent) => {
      const act = event.data;
      if (meta.actions?.length && !meta.actions.includes(act.action)) return;
      if (meta.column_id) {
        const d = act.detail as Record<string, unknown>;
        if (d.column_id !== meta.column_id && d.to !== meta.column_id) return;
      }

      // 매칭 — 이벤트 데이터를 memory에 주입하고 resume
      void inject_and_resume(workflow_id, {
        card_id: act.card_id,
        board_id: act.board_id,
        action: act.action,
        actor: act.actor,
        detail: act.detail,
        created_at: act.created_at,
      }).catch((err) => {
        log.error("inject_and_resume_failed", { workflow_id, error: error_message(err) });
      });
    };

    kanban_store.subscribe(meta.board_id, listener);
    subscriptions.set(workflow_id, { board_id: meta.board_id, listener });
    log.info("kanban_trigger_watch_subscribed", { workflow_id, board_id: meta.board_id });
  }

  async function inject_and_resume(workflow_id: string, event_data: Record<string, unknown>): Promise<void> {
    // 구독 해제
    const sub = subscriptions.get(workflow_id);
    if (sub) {
      kanban_store.unsubscribe(sub.board_id, sub.listener);
      subscriptions.delete(workflow_id);
    }

    // 이벤트 데이터를 memory에 주입
    const state = await workflow_store.get(workflow_id);
    if (!state || state.status !== "waiting_user_input") return;

    state.memory.__pending_kanban_trigger_event = event_data;
    await workflow_store.upsert(state as never);

    // resume
    const result = await resumer.resume(workflow_id);
    if (result.ok) {
      log.info("kanban_trigger_auto_resumed", { workflow_id, card_id: event_data.card_id });
    } else {
      log.warn("kanban_trigger_resume_failed", { workflow_id, error: result.error });
    }
  }

  // 초기 스캔
  await scan_and_subscribe();

  // 주기적 스캔 (새로 waiting 상태가 된 워크플로우 감지)
  const interval = setInterval(() => {
    void scan_and_subscribe().catch((err) => {
      log.warn("kanban_trigger_scan_error", { error: error_message(err) });
    });
  }, 30_000);

  return {
    notify(workflow_id: string) {
      if (subscriptions.has(workflow_id)) return;
      void workflow_store.get(workflow_id).then((wf) => {
        if (!wf || wf.status !== "waiting_user_input") return;
        const meta = wf.memory?.__pending_kanban_trigger as PendingTriggerMeta | undefined;
        if (!meta?.board_id) return;
        subscribe_for_workflow(workflow_id, meta);
      }).catch((err) => {
        log.warn("kanban_trigger_notify_error", { workflow_id, error: error_message(err) });
      });
    },
    dispose() {
      clearInterval(interval);
      for (const [, sub] of subscriptions) {
        kanban_store.unsubscribe(sub.board_id, sub.listener);
      }
      subscriptions.clear();
    },
  };
}
