/**
 * workflow-trigger-sync — webhook polling 내부 로직 커버리지 (L123-135).
 * fake timers로 setInterval 트리거, abort/error/!ok 분기 커버.
 * - L128-132: data 있음 → execute 호출
 * - L133: execute !ok → warn 로그
 * - L135-137: webhook_store.get 예외 → catch 블록
 * - L123: abort 시 poll 중단
 * - L128: webhook_store.get null → continue
 * - L192: kanban entries 없음 → 조기 return 0
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
  trigger_nodes: [{ id: "t1", trigger_type: "webhook", webhook_path: "/hook/v1" }],
} as unknown as TemplateWithSlug;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ══════════════════════════════════════════════════════════
// webhook polling 내부 — data 있음 → execute 호출 (L128-132)
// ══════════════════════════════════════════════════════════

describe("webhook polling — data 있음 → execute 호출", () => {
  it("setInterval 발화 → webhook_store.get data 반환 → execute 호출됨", async () => {
    const webhook_data = { method: "POST", body: { key: "value" } };
    const webhook_store = {
      get: vi.fn().mockResolvedValue(webhook_data),
      set: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]),
    } as unknown as WebhookStore;
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true, workflow_id: "wf-1" });

    await sync_all_workflow_triggers([webhook_template], make_deps({ webhook_store, execute }));

    // setInterval이 5초마다 poll 실행 — 5001ms 진행
    await vi.advanceTimersByTimeAsync(5001);

    expect(vi.mocked(execute)).toHaveBeenCalledWith(
      "webhook-flow", "slack", "C001", { webhook: webhook_data },
    );
  });
});

// ══════════════════════════════════════════════════════════
// webhook polling — !result.ok → warn 로그 (L133)
// ══════════════════════════════════════════════════════════

describe("webhook polling — execute !ok → warn 로그", () => {
  it("execute 반환 {ok:false} → 경고 로그만 기록, 예외 미전파", async () => {
    const webhook_data = { method: "POST", body: {} };
    const webhook_store = {
      get: vi.fn().mockResolvedValue(webhook_data),
      set: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]),
    } as unknown as WebhookStore;
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: false, error: "workflow_failed" });

    await sync_all_workflow_triggers([webhook_template], make_deps({ webhook_store, execute }));
    await vi.advanceTimersByTimeAsync(5001);

    expect(vi.mocked(execute)).toHaveBeenCalled();
    // !ok 분기 실행 후 예외 없음 (정상 종료)
  });
});

// ══════════════════════════════════════════════════════════
// webhook polling — webhook_store.get 예외 → catch 블록 (L135-137)
// ══════════════════════════════════════════════════════════

describe("webhook polling — webhook_store.get 예외 → 에러 격리", () => {
  it("webhook_store.get throw → catch 처리, 예외 미전파", async () => {
    const webhook_store = {
      get: vi.fn().mockRejectedValue(new Error("store error")),
      set: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]),
    } as unknown as WebhookStore;
    const execute: WorkflowExecuteFn = vi.fn();

    await sync_all_workflow_triggers([webhook_template], make_deps({ webhook_store, execute }));
    await vi.advanceTimersByTimeAsync(5001);

    // execute가 호출되지 않음 (catch에서 중단)
    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// webhook polling — abort.aborted=true → 즉시 반환 (L123)
// ══════════════════════════════════════════════════════════

describe("webhook polling — abort 시 poll 중단 (L123)", () => {
  it("abort 후 setInterval 발화 → poll 실행 안 됨 (abort guard)", async () => {
    const webhook_store = {
      get: vi.fn().mockResolvedValue({ method: "GET", body: {} }),
      set: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]),
    } as unknown as WebhookStore;
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });

    // 첫 번째 sync 실행 → _abort 내부에서 생성됨
    await sync_all_workflow_triggers([webhook_template], make_deps({ webhook_store, execute }));

    // 두 번째 sync 호출 → 기존 _abort.abort() 호출 → 첫 번째 interval 중지
    await sync_all_workflow_triggers([], make_deps({ webhook_store, execute }));

    // 5초 진행해도 첫 번째 poll은 abort 상태
    await vi.advanceTimersByTimeAsync(5001);

    // execute는 두 번째 sync에 webhook_entries=0이므로 호출 안 됨
    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// webhook polling — L128: data null → continue
// ══════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════
// L192: kanban_store 있지만 kanban entries 없음 → 조기 return 0
// ══════════════════════════════════════════════════════════

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
