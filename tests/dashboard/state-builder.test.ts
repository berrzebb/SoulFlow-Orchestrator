import { describe, it, expect, vi } from "vitest";
import { pick_agent_event_fields, build_merged_tasks, build_dashboard_state } from "@src/dashboard/state-builder.ts";
import type { AgentEvent } from "@src/agent/agent.types.ts";

const SOURCE = { backend: "test" as const, task_id: "t1" };
const AT = "2025-01-01T00:00:00Z";

describe("pick_agent_event_fields", () => {
  it("tool_use 이벤트에서 tool_name을 추출한다", () => {
    const event = { type: "tool_use", source: SOURCE, at: AT, tool_name: "bash", tool_id: "t1", params: {} } as AgentEvent;
    expect(pick_agent_event_fields(event)).toEqual({ tool_name: "bash" });
  });

  it("tool_result 이벤트에서 tool_name과 is_error를 추출한다", () => {
    const event = { type: "tool_result", source: SOURCE, at: AT, tool_name: "bash", tool_id: "t1", result: "ok", is_error: false } as AgentEvent;
    expect(pick_agent_event_fields(event)).toEqual({ tool_name: "bash", is_error: false });
  });

  it("content_delta 이벤트에서 text를 200자로 잘라낸다", () => {
    const long_text = "x".repeat(300);
    const event = { type: "content_delta", source: SOURCE, at: AT, text: long_text } as AgentEvent;
    const result = pick_agent_event_fields(event);
    expect((result.text as string).length).toBe(200);
  });

  it("usage 이벤트에서 tokens와 cost_usd를 추출한다", () => {
    const event = { type: "usage", source: SOURCE, at: AT, tokens: { input: 100, output: 50 }, cost_usd: 0.01 } as AgentEvent;
    expect(pick_agent_event_fields(event)).toEqual({ tokens: { input: 100, output: 50 }, cost_usd: 0.01 });
  });

  it("error 이벤트에서 error를 300자로 잘라낸다", () => {
    const long_error = "e".repeat(500);
    const event = { type: "error", source: SOURCE, at: AT, error: long_error } as AgentEvent;
    const result = pick_agent_event_fields(event);
    expect((result.error as string).length).toBe(300);
  });

  it("complete 이벤트에서 finish_reason을 추출한다", () => {
    const event = { type: "complete", source: SOURCE, at: AT, finish_reason: "done" } as AgentEvent;
    expect(pick_agent_event_fields(event)).toEqual({ finish_reason: "done" });
  });

  it("task_lifecycle 이벤트에서 sdk_task_id/status/description을 추출한다", () => {
    const event = { type: "task_lifecycle", source: SOURCE, at: AT, sdk_task_id: "sdk1", status: "completed", description: "done" } as AgentEvent;
    expect(pick_agent_event_fields(event)).toEqual({ sdk_task_id: "sdk1", status: "completed", description: "done" });
  });

  it("approval_request 이벤트에서 request_id와 tool_name을 추출한다", () => {
    const event = { type: "approval_request", source: SOURCE, at: AT, request: { request_id: "req1", tool_name: "bash" } } as AgentEvent;
    expect(pick_agent_event_fields(event)).toEqual({ request_id: "req1", tool_name: "bash" });
  });

  it("rate_limit 이벤트에서 status와 utilization을 추출한다", () => {
    const event = { type: "rate_limit", source: SOURCE, at: AT, status: "allowed", utilization: 0.5 } as AgentEvent;
    expect(pick_agent_event_fields(event)).toEqual({ status: "allowed", utilization: 0.5 });
  });

  it("알 수 없는 타입은 빈 객체를 반환한다", () => {
    const event = { type: "init", source: SOURCE, at: AT } as AgentEvent;
    expect(pick_agent_event_fields(event)).toEqual({});
  });
});

describe("build_merged_tasks", () => {
  function make_task(taskId: string, overrides: Record<string, unknown> = {}) {
    return {
      taskId, title: `Task ${taskId}`, status: "running",
      currentStep: "step1", exitReason: undefined,
      currentTurn: 1, maxTurns: 10,
      channel: "", chatId: "", objective: "",
      memory: {}, ...overrides,
    };
  }

  function make_options(runtime: unknown[] = [], stored: unknown[] = []) {
    return {
      agent: {
        list_runtime_tasks: vi.fn(() => runtime),
        list_stored_tasks: vi.fn(async () => stored),
      },
    } as any;
  }

  it("runtime과 stored 태스크를 병합한다", async () => {
    const options = make_options(
      [make_task("t1")],
      [make_task("t2")],
    );
    const tasks = await build_merged_tasks(options);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.taskId)).toContain("t1");
    expect(tasks.map((t) => t.taskId)).toContain("t2");
  });

  it("동일 taskId는 runtime이 우선한다", async () => {
    const options = make_options(
      [make_task("t1", { title: "runtime version" })],
      [make_task("t1", { title: "stored version" })],
    );
    const tasks = await build_merged_tasks(options);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("runtime version");
  });

  it("taskId에서 channel을 추출한다", async () => {
    const options = make_options(
      [make_task("task:telegram:abc123")],
    );
    const tasks = await build_merged_tasks(options);
    expect(tasks[0].channel).toBe("telegram");
  });

  it("objective를 200자로 잘라낸다", async () => {
    const options = make_options(
      [make_task("t1", { objective: "x".repeat(300) })],
    );
    const tasks = await build_merged_tasks(options);
    expect(tasks[0].objective.length).toBe(200);
  });

  it("빈 태스크 목록을 처리한다", async () => {
    const options = make_options();
    const tasks = await build_merged_tasks(options);
    expect(tasks).toEqual([]);
  });
});

describe("build_dashboard_state", () => {
  function make_full_options() {
    return {
      agent: {
        list_runtime_tasks: vi.fn(() => []),
        list_stored_tasks: vi.fn(async () => []),
        list_subagents: vi.fn(() => []),
        list_approval_requests: vi.fn(() => []),
        list_active_loops: vi.fn(() => []),
      },
      bus: { get_sizes: vi.fn(() => ({ inbound: 0, outbound: 0 })) },
      channels: {
        get_status: vi.fn(() => ({ enabled_channels: [], mention_loop_running: false })),
        get_channel_health: vi.fn(() => []),
        get_active_run_count: vi.fn(() => 0),
      },
      ops: { status: vi.fn(() => ({})) },
      heartbeat: { status: vi.fn(() => ({})) },
      process_tracker: {
        list_active: vi.fn(() => []),
        list_recent: vi.fn(() => []),
      },
      cron: {
        status: vi.fn(async () => ({ running: true })),
        list_jobs: vi.fn(async () => []),
      },
      decisions: { get_effective_decisions: vi.fn(async () => []) },
      promises: { get_effective_promises: vi.fn(async () => []) },
      events: { list: vi.fn(async () => []) },
      stats_ops: { get_cd_score: vi.fn(() => 42) },
      agent_provider_ops: { list: vi.fn(async () => []) },
    } as any;
  }

  it("모든 최상위 키를 포함한다", async () => {
    const state = await build_dashboard_state(make_full_options(), []);
    const expected_keys = ["now", "queue", "channels", "heartbeat", "ops", "agents", "tasks",
      "messages", "processes", "approvals", "active_loops", "cd_score", "cron",
      "decisions", "promises", "workflow_events", "agent_providers"];
    for (const key of expected_keys) {
      expect(state).toHaveProperty(key);
    }
  });

  it("messages를 역순으로 최대 20개 반환한다", async () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      direction: "inbound" as const, sender_id: `u${i}`, content: `msg${i}`, chat_id: "", at: `2025-01-01T00:${String(i).padStart(2, "0")}:00Z`,
    }));
    const state = await build_dashboard_state(make_full_options(), messages);
    const result = state.messages as Array<{ sender_id: string }>;
    expect(result).toHaveLength(20);
    // 역순: 가장 최근(29번)이 먼저
    expect(result[0].sender_id).toBe("u29");
  });

  it("optional deps null 안전", async () => {
    const opts = make_full_options();
    opts.process_tracker = null;
    opts.cron = null;
    opts.stats_ops = null;
    opts.agent_provider_ops = null;
    const state = await build_dashboard_state(opts, []);
    expect((state.processes as any).active).toEqual([]);
    expect(state.cron).toBeNull();
    expect(state.cd_score).toBeNull();
    expect(state.agent_providers).toEqual([]);
  });
});
