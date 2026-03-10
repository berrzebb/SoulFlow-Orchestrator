/**
 * workflow-trigger-sync — 트리거 동기화 로직 단위 테스트.
 * 모든 의존성을 mock으로 대체하여 순수 로직만 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sync_all_workflow_triggers,
  type WorkflowTriggerSyncDeps,
  type WorkflowExecuteFn,
} from "../../src/cron/workflow-trigger-sync.js";
import type { TemplateWithSlug } from "../../src/orchestration/workflow-loader.js";
import type { CronScheduler } from "../../src/cron/contracts.js";
import type { CronJob } from "../../src/cron/types.js";
import type { MessageBusLike, MessageBusTap } from "../../src/bus/index.js";
import type { WebhookStore } from "../../src/services/webhook-store.service.js";
import type { KanbanStoreLike } from "../../src/services/kanban-store.js";

// ── mock 헬퍼 ────────────────────────────────────────────────────

function make_job(slug: string, schedule: string, tz = ""): CronJob {
  return {
    id: `job-${slug}`,
    name: `workflow: ${slug}`,
    schedule: { kind: "cron", expr: schedule, tz, at_ms: null, every_ms: null },
    payload: { message: `workflow_trigger:${slug}` },
    enabled: true,
    deliver: false,
    channel: null,
    to: null,
    delete_after_run: false,
    created_at: "2025-01-01T00:00:00Z",
    last_run_at: null,
    next_run_at: null,
    run_count: 0,
  } as unknown as CronJob;
}

function make_cron(overrides: Partial<CronScheduler> = {}): CronScheduler {
  return {
    list_jobs: vi.fn().mockResolvedValue([]),
    add_job: vi.fn().mockResolvedValue({ id: "new-job" }),
    remove_job: vi.fn().mockResolvedValue(true),
    enable_job: vi.fn(),
    run_job: vi.fn(),
    status: vi.fn(),
    every: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    disable_all_and_pause: vi.fn(),
    ...overrides,
  } as unknown as CronScheduler;
}

function make_bus(): MessageBusLike & MessageBusTap {
  return {
    publish_inbound: vi.fn(),
    publish_outbound: vi.fn(),
    consume_inbound: vi.fn(),
    consume_outbound: vi.fn(),
    on_publish: vi.fn(),
  } as unknown as MessageBusLike & MessageBusTap;
}

function make_webhook_store(): WebhookStore {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
  } as unknown as WebhookStore;
}

function make_execute(): WorkflowExecuteFn {
  return vi.fn().mockResolvedValue({ ok: true, workflow_id: "wf-123" });
}

function make_deps(overrides: Partial<WorkflowTriggerSyncDeps> = {}): WorkflowTriggerSyncDeps {
  return {
    cron: make_cron(),
    bus: make_bus(),
    webhook_store: make_webhook_store(),
    kanban_store: null,
    execute: make_execute(),
    default_channel: "slack",
    default_chat_id: "chat-001",
    ...overrides,
  };
}

function make_cron_template(slug: string, schedule: string, timezone?: string): TemplateWithSlug {
  return {
    slug,
    trigger_nodes: [
      { id: "t1", trigger_type: "cron", schedule, timezone },
    ],
  } as unknown as TemplateWithSlug;
}

// ── 테스트 ─────────────────────────────────────────────────────

describe("sync_all_workflow_triggers — cron 동기화", () => {
  it("새 cron 트리거 → add_job 호출", async () => {
    const cron = make_cron();
    const deps = make_deps({ cron });
    const templates = [make_cron_template("daily-report", "0 9 * * *")];

    const result = await sync_all_workflow_triggers(templates, deps);

    expect(vi.mocked(cron.add_job)).toHaveBeenCalledOnce();
    expect(vi.mocked(cron.add_job)).toHaveBeenCalledWith(
      "workflow: daily-report",
      expect.objectContaining({ kind: "cron", expr: "0 9 * * *" }),
      "workflow_trigger:daily-report",
      false, null, null, false,
    );
    expect(result.cron.added).toBe(1);
    expect(result.cron.removed).toBe(0);
  });

  it("기존 동일 schedule → 변경 없음 (add/remove 미호출)", async () => {
    const existing_job = make_job("weekly-summary", "0 9 * * 1");
    const cron = make_cron({ list_jobs: vi.fn().mockResolvedValue([existing_job]) });
    const deps = make_deps({ cron });
    const templates = [make_cron_template("weekly-summary", "0 9 * * 1")];

    const result = await sync_all_workflow_triggers(templates, deps);

    expect(vi.mocked(cron.add_job)).not.toHaveBeenCalled();
    expect(vi.mocked(cron.remove_job)).not.toHaveBeenCalled();
    expect(result.cron.added).toBe(0);
    expect(result.cron.updated).toBe(0);
  });

  it("schedule 변경 → remove 후 add (updated+1)", async () => {
    const existing_job = make_job("hourly", "0 * * * *");
    const cron = make_cron({ list_jobs: vi.fn().mockResolvedValue([existing_job]) });
    const deps = make_deps({ cron });
    const templates = [make_cron_template("hourly", "30 * * * *")]; // schedule 변경

    const result = await sync_all_workflow_triggers(templates, deps);

    expect(vi.mocked(cron.remove_job)).toHaveBeenCalled();
    expect(vi.mocked(cron.add_job)).toHaveBeenCalled();
    expect(result.cron.updated).toBe(1);
  });

  it("삭제된 워크플로우 → remove_job 호출 (removed+1)", async () => {
    const existing_job = make_job("old-workflow", "0 0 * * *");
    const cron = make_cron({ list_jobs: vi.fn().mockResolvedValue([existing_job]) });
    const deps = make_deps({ cron });
    const templates: TemplateWithSlug[] = []; // 빈 템플릿 — old-workflow 없음

    const result = await sync_all_workflow_triggers(templates, deps);

    expect(vi.mocked(cron.remove_job)).toHaveBeenCalledWith("job-old-workflow");
    expect(result.cron.removed).toBe(1);
  });
});

describe("sync_all_workflow_triggers — trigger_nodes cron 지원", () => {
  it("trigger_nodes에 cron 트리거 있을 때 cron 등록", async () => {
    const cron = make_cron();
    const deps = make_deps({ cron });
    const template: TemplateWithSlug = {
      slug: "scheduled-cron",
      title: "Scheduled Workflow",
      objective: "",
      phases: [],
      trigger_nodes: [{ id: "__cron__", trigger_type: "cron", schedule: "0 8 * * *" }],
    } as unknown as TemplateWithSlug;

    const result = await sync_all_workflow_triggers([template], deps);

    expect(vi.mocked(cron.add_job)).toHaveBeenCalled();
    expect(result.cron.added).toBe(1);
  });
});

describe("sync_all_workflow_triggers — channel_message 트리거", () => {
  it("channel_message 트리거 → bus.on_publish 호출", async () => {
    const bus = make_bus();
    const deps = make_deps({ bus });
    const template: TemplateWithSlug = {
      slug: "msg-handler",
      trigger_nodes: [
        { id: "t1", trigger_type: "channel_message", channel_type: "slack", chat_id: "C001" },
      ],
    } as unknown as TemplateWithSlug;

    const result = await sync_all_workflow_triggers([template], deps);

    expect(vi.mocked(bus.on_publish)).toHaveBeenCalled();
    expect(result.channel_message.registered).toBe(1);
  });

  it("channel_message 없음 → on_publish 미호출", async () => {
    const bus = make_bus();
    const deps = make_deps({ bus });
    const templates: TemplateWithSlug[] = [];

    await sync_all_workflow_triggers(templates, deps);

    expect(vi.mocked(bus.on_publish)).not.toHaveBeenCalled();
  });
});

describe("sync_all_workflow_triggers — channel_message 콜백 실행 경로", () => {
  it("on_publish 콜백 — inbound + 채널·채팅 매칭 → execute 호출", async () => {
    let captured_cb: ((dir: string, msg: any) => void) | undefined;
    const bus = make_bus();
    vi.mocked(bus.on_publish).mockImplementation((cb: any) => { captured_cb = cb; });
    const execute = make_execute();
    const deps = make_deps({ bus, execute });

    await sync_all_workflow_triggers([{
      slug: "msg-handler",
      trigger_nodes: [{ id: "t1", trigger_type: "channel_message", channel_type: "slack", chat_id: "C001" }],
    } as unknown as TemplateWithSlug], deps);

    captured_cb!("inbound", { channel: "slack", chat_id: "C001", provider: "slack" });
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(execute)).toHaveBeenCalledWith("msg-handler", "slack", "C001", expect.any(Object));
  });

  it("on_publish 콜백 — outbound → execute 미호출", async () => {
    let captured_cb: ((dir: string, msg: any) => void) | undefined;
    const bus = make_bus();
    vi.mocked(bus.on_publish).mockImplementation((cb: any) => { captured_cb = cb; });
    const execute = make_execute();
    const deps = make_deps({ bus, execute });

    await sync_all_workflow_triggers([{
      slug: "msg-handler",
      trigger_nodes: [{ id: "t1", trigger_type: "channel_message", channel_type: "slack", chat_id: "C001" }],
    } as unknown as TemplateWithSlug], deps);

    captured_cb!("outbound", { channel: "slack", chat_id: "C001" });
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });

  it("on_publish 콜백 — 채널 불일치 → execute 미호출", async () => {
    let captured_cb: ((dir: string, msg: any) => void) | undefined;
    const bus = make_bus();
    vi.mocked(bus.on_publish).mockImplementation((cb: any) => { captured_cb = cb; });
    const execute = make_execute();
    const deps = make_deps({ bus, execute });

    await sync_all_workflow_triggers([{
      slug: "msg-handler",
      trigger_nodes: [{ id: "t1", trigger_type: "channel_message", channel_type: "telegram", chat_id: "C001" }],
    } as unknown as TemplateWithSlug], deps);

    captured_cb!("inbound", { channel: "slack", chat_id: "C001" });
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });
});

describe("sync_all_workflow_triggers — kanban_event 콜백 실행 경로", () => {
  it("kanban listener — 이벤트 발생 → execute 호출", async () => {
    let captured_listener: ((event: any) => void) | undefined;
    const kanban_store: Partial<KanbanStoreLike> = {
      subscribe: vi.fn((_, listener) => { captured_listener = listener; }),
      unsubscribe: vi.fn(),
    };
    const execute = make_execute();
    const deps = make_deps({ kanban_store: kanban_store as KanbanStoreLike, execute });

    await sync_all_workflow_triggers([{
      slug: "kb-handler",
      trigger_nodes: [{ id: "t1", trigger_type: "kanban_event", kanban_board_id: "board-1" }],
    } as unknown as TemplateWithSlug], deps);

    expect(captured_listener).toBeDefined();
    captured_listener!({ board_id: "board-1", data: { action: "moved", card_id: "card-1", detail: {} } });
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(execute)).toHaveBeenCalledWith("kb-handler", expect.any(String), expect.any(String), expect.any(Object));
  });

  it("kanban listener — action 필터 불일치 → execute 미호출", async () => {
    let captured_listener: ((event: any) => void) | undefined;
    const kanban_store: Partial<KanbanStoreLike> = {
      subscribe: vi.fn((_, listener) => { captured_listener = listener; }),
      unsubscribe: vi.fn(),
    };
    const execute = make_execute();
    const deps = make_deps({ kanban_store: kanban_store as KanbanStoreLike, execute });

    await sync_all_workflow_triggers([{
      slug: "kb-handler",
      trigger_nodes: [{ id: "t1", trigger_type: "kanban_event", kanban_board_id: "board-1", kanban_actions: ["archived"] }],
    } as unknown as TemplateWithSlug], deps);

    captured_listener!({ board_id: "board-1", data: { action: "moved", card_id: "card-1", detail: {} } });
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });
});

describe("sync_all_workflow_triggers — webhook 트리거", () => {
  it("webhook 트리거 → webhook.registered 반환", async () => {
    const deps = make_deps();
    const template: TemplateWithSlug = {
      slug: "webhook-handler",
      trigger_nodes: [
        { id: "t1", trigger_type: "webhook", webhook_path: "/hook/v1" },
      ],
    } as unknown as TemplateWithSlug;

    const result = await sync_all_workflow_triggers([template], deps);

    expect(result.webhook.registered).toBe(1);
  });
});

describe("sync_all_workflow_triggers — kanban_event 트리거", () => {
  it("kanban_store null → kanban_event.registered = 0", async () => {
    const deps = make_deps({ kanban_store: null });
    const template: TemplateWithSlug = {
      slug: "kb-handler",
      trigger_nodes: [
        { id: "t1", trigger_type: "kanban_event", kanban_board_id: "board-1" },
      ],
    } as unknown as TemplateWithSlug;

    const result = await sync_all_workflow_triggers([template], deps);

    expect(result.kanban_event.registered).toBe(0);
  });

  it("kanban_store 있음 → subscribe 호출됨", async () => {
    const kanban_store: Partial<KanbanStoreLike> = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    };
    const deps = make_deps({ kanban_store: kanban_store as KanbanStoreLike });
    const template: TemplateWithSlug = {
      slug: "kb-handler",
      trigger_nodes: [
        { id: "t1", trigger_type: "kanban_event", kanban_board_id: "board-1" },
      ],
    } as unknown as TemplateWithSlug;

    const result = await sync_all_workflow_triggers([template], deps);

    expect(vi.mocked(kanban_store.subscribe!)).toHaveBeenCalled();
    expect(result.kanban_event.registered).toBe(1);
  });
});

describe("sync_all_workflow_triggers — 빈 템플릿", () => {
  it("빈 배열 → 모든 카운트 0", async () => {
    const result = await sync_all_workflow_triggers([], make_deps());
    expect(result.cron.added).toBe(0);
    expect(result.cron.removed).toBe(0);
    expect(result.webhook.registered).toBe(0);
    expect(result.channel_message.registered).toBe(0);
    expect(result.kanban_event.registered).toBe(0);
  });
});
