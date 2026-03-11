/**
 * workflow-trigger-sync — 미커버 분기 (cov5):
 * - L124: webhook poll → abort.aborted=true → 즉시 return
 * - L128: webhook poll → webhook_store.get null → continue (데이터 없음)
 * - L192: kanban_store 설정됐지만 kanban entries 없음 → 조기 return 0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sync_all_workflow_triggers,
  type WorkflowTriggerSyncDeps,
  type WorkflowExecuteFn,
} from "@src/cron/workflow-trigger-sync.js";
import type { TemplateWithSlug } from "@src/orchestration/workflow-loader.js";
import type { CronScheduler } from "@src/cron/contracts.js";
import type { MessageBusLike, MessageBusTap } from "@src/bus/index.js";
import type { WebhookStore } from "@src/services/webhook-store.service.js";
import type { KanbanStoreLike } from "@src/services/kanban-store.js";

function make_cron(): CronScheduler {
  return {
    list_jobs: vi.fn().mockResolvedValue([]),
    add_job: vi.fn().mockResolvedValue({ id: "new-job" }),
    remove_job: vi.fn().mockResolvedValue(true),
    enable_job: vi.fn(), run_job: vi.fn(), status: vi.fn(),
    every: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
    disable_all_and_pause: vi.fn(),
  } as unknown as CronScheduler;
}

function make_bus(): MessageBusLike & MessageBusTap {
  return {
    publish_inbound: vi.fn(), publish_outbound: vi.fn(),
    consume_inbound: vi.fn(), consume_outbound: vi.fn(),
    on_publish: vi.fn(),
  } as unknown as MessageBusLike & MessageBusTap;
}

function make_deps(overrides: Partial<WorkflowTriggerSyncDeps> = {}): WorkflowTriggerSyncDeps {
  return {
    cron: make_cron(),
    bus: make_bus(),
    webhook_store: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]) } as unknown as WebhookStore,
    kanban_store: null,
    execute: vi.fn().mockResolvedValue({ ok: true }),
    default_channel: "slack",
    default_chat_id: "C001",
    ...overrides,
  };
}

const webhook_template: TemplateWithSlug = {
  slug: "webhook-flow",
  trigger_nodes: [{ id: "t1", trigger_type: "webhook", webhook_path: "/hook/poll" }],
} as unknown as TemplateWithSlug;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ── L128: webhook_store.get null → continue ───────────────────────────────────

describe("webhook polling — L128: data null → continue", () => {
  it("setInterval 발화 → webhook_store.get null → L128 continue (execute 미호출)", async () => {
    const webhook_store = { get: vi.fn().mockResolvedValue(null), set: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]) } as unknown as WebhookStore;
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });

    await sync_all_workflow_triggers([webhook_template], make_deps({ webhook_store, execute }));

    // setInterval 5001ms 진행 → poll 실행 → get null → continue
    await vi.advanceTimersByTimeAsync(5001);

    // data가 null이면 execute를 호출하지 않아야 함
    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });
});

// ── L124: abort.aborted → 즉시 return ────────────────────────────────────────

describe("webhook polling — L124: abort 신호 후 poll → return", () => {
  it("두 번째 sync_all 호출로 이전 abort 발생 → L124: abort.aborted return", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const webhook_store = { get: vi.fn().mockResolvedValue(null), set: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]) } as unknown as WebhookStore;

    // 첫 번째 호출: abort controller A 설정, webhook 폴링 시작
    await sync_all_workflow_triggers([webhook_template], make_deps({ webhook_store, execute }));

    // 두 번째 호출(webhook 없음): 이전 abort controller A를 abort 처리
    await sync_all_workflow_triggers([], make_deps({ execute }));

    // 첫 번째 interval 발화 시 abort.aborted=true → L124 return
    await vi.advanceTimersByTimeAsync(5001);

    // abort 상태에서 execute 호출 없어야 함
    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });
});

// ── L192: kanban_store 있지만 kanban entries 없음 → 0 반환 ───────────────────

describe("workflow-trigger-sync — L192: kanban entries 없음 → 조기 return 0", () => {
  it("kanban_store 설정 + kanban entries 없는 templates → L192 return 0", async () => {
    const kanban_store = { list_boards: vi.fn().mockResolvedValue([]) } as unknown as KanbanStoreLike;

    // webhook trigger만 있는 template (kanban 없음)
    const non_kanban_template: TemplateWithSlug = {
      slug: "no-kanban",
      trigger_nodes: [{ id: "t1", trigger_type: "webhook", webhook_path: "/no-kanban" }],
    } as unknown as TemplateWithSlug;

    const result = await sync_all_workflow_triggers(
      [non_kanban_template],
      make_deps({ kanban_store }),
    );

    // kanban_event.registered = 0 (L192: 조기 return 0)
    expect(result.kanban_event.registered).toBe(0);
  });
});
