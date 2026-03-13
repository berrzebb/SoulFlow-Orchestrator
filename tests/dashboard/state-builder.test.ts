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

function make_full_options(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  } as any;
}

describe("build_dashboard_state", () => {
  it("모든 최상위 키를 포함한다", async () => {
    const state = await build_dashboard_state(make_full_options(), []);
    const expected_keys = ["now", "queue", "channels", "heartbeat", "ops", "agents", "tasks",
      "messages", "processes", "approvals", "active_loops", "cd_score", "cron",
      "decisions", "promises", "workflow_events", "agent_providers", "observability"];
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

// ══════════════════════════════════════════
// cov2: build_merged_tasks — memory fields
// ══════════════════════════════════════════

describe("build_merged_tasks — memory fields", () => {
  it("memory.workflow.at → updatedAt", async () => {
    const opts = {
      agent: {
        list_runtime_tasks: vi.fn(() => [{
          taskId: "t1", title: "T1", status: "completed",
          currentTurn: 1, maxTurns: 10, channel: "", chatId: "", objective: "",
          memory: { workflow: { at: "2026-01-01T12:00:00Z" } },
        }]),
        list_stored_tasks: vi.fn(async () => []),
      },
    } as any;
    const tasks = await build_merged_tasks(opts);
    expect(tasks[0].updatedAt).toBe("2026-01-01T12:00:00Z");
  });

  it("memory.__updated_at_seoul → updatedAt", async () => {
    const opts = {
      agent: {
        list_runtime_tasks: vi.fn(() => [{
          taskId: "t2", title: "T2", status: "running",
          currentTurn: 1, maxTurns: 10, channel: "", chatId: "", objective: "",
          memory: { __updated_at_seoul: "2026-02-01T00:00:00Z" },
        }]),
        list_stored_tasks: vi.fn(async () => []),
      },
    } as any;
    const tasks = await build_merged_tasks(opts);
    expect(tasks[0].updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("memory.channel + memory.chat_id → 태스크 필드", async () => {
    const opts = {
      agent: {
        list_runtime_tasks: vi.fn(() => [{
          taskId: "adhoc:x:y", title: "T3", status: "running",
          currentTurn: 1, maxTurns: 10, channel: "", chatId: "", objective: "test",
          memory: { channel: "slack", chat_id: "C123" },
        }]),
        list_stored_tasks: vi.fn(async () => []),
      },
    } as any;
    const tasks = await build_merged_tasks(opts);
    expect(tasks[0].channel).toBe("slack");
    expect(tasks[0].chat_id).toBe("C123");
  });
});

// ══════════════════════════════════════════
// cov2: subagents, processes, decisions, cron
// ══════════════════════════════════════════

describe("build_dashboard_state — subagents with data", () => {
  it("last_result 200자 자름", async () => {
    const opts = make_full_options({
      agent: {
        list_runtime_tasks: vi.fn(() => []),
        list_stored_tasks: vi.fn(async () => []),
        list_subagents: vi.fn(() => [{
          id: "sa1", label: "Bot1", role: "worker", model: "claude",
          status: "completed", session_id: "s1",
          created_at: "2026-01-01", updated_at: "2026-01-02",
          last_error: null, last_result: "x".repeat(300),
        }]),
        list_approval_requests: vi.fn(() => []),
        list_active_loops: vi.fn(() => []),
      },
    });
    const state = await build_dashboard_state(opts, []);
    expect((state.agents as any[])[0].last_result.length).toBe(200);
  });

  it("last_result 없으면 undefined, label 없으면 id 사용", async () => {
    const opts = make_full_options({
      agent: {
        list_runtime_tasks: vi.fn(() => []),
        list_stored_tasks: vi.fn(async () => []),
        list_subagents: vi.fn(() => [{
          id: "sa2", label: null, role: "worker", model: null,
          status: "idle", session_id: null,
          created_at: null, updated_at: null,
          last_error: null, last_result: null,
        }]),
        list_approval_requests: vi.fn(() => []),
        list_active_loops: vi.fn(() => []),
      },
    });
    const state = await build_dashboard_state(opts, []);
    const a = (state.agents as any[])[0];
    expect(a.last_result).toBeUndefined();
    expect(a.label).toBe("sa2");
  });
});

describe("build_dashboard_state — decisions/promises/events", () => {
  it("decisions, promises, workflow_events 매핑", async () => {
    const opts = make_full_options({
      decisions: { get_effective_decisions: vi.fn(async () => [{ id: "d1", canonical_key: "k1", value: "v1", priority: 1 }]) },
      promises: { get_effective_promises: vi.fn(async () => [{ id: "p1", canonical_key: "pk1", value: "pv", priority: 2, scope: "global", source: "user" }]) },
      events: { list: vi.fn(async () => [{ event_id: "ev1", task_id: "t1", run_id: "r1", agent_id: "a1", phase: "done", summary: "ok", at: "2026-01-01" }]) },
    });
    const state = await build_dashboard_state(opts, []);
    expect((state.decisions as any[])[0]).toMatchObject({ id: "d1" });
    expect((state.promises as any[])[0]).toMatchObject({ id: "p1" });
    expect((state.workflow_events as any[])[0]).toMatchObject({ event_id: "ev1" });
  });
});

describe("build_dashboard_state — approvals/loops/cron", () => {
  it("list_approval_requests → approvals", async () => {
    const opts = make_full_options({
      agent: {
        list_runtime_tasks: vi.fn(() => []),
        list_stored_tasks: vi.fn(async () => []),
        list_subagents: vi.fn(() => []),
        list_approval_requests: vi.fn(() => [{ request_id: "req1", tool_name: "Bash", status: "pending", created_at: "2026-01-01", context: {} }]),
        list_active_loops: vi.fn(() => []),
      },
    });
    const state = await build_dashboard_state(opts, []);
    expect((state.approvals as any[])[0].request_id).toBe("req1");
  });

  it("list_active_loops → active_loops", async () => {
    const opts = make_full_options({
      agent: {
        list_runtime_tasks: vi.fn(() => []),
        list_stored_tasks: vi.fn(async () => []),
        list_subagents: vi.fn(() => []),
        list_approval_requests: vi.fn(() => []),
        list_active_loops: vi.fn(() => [{ loopId: "loop1", agentId: "ag1", objective: "do", currentTurn: 5, maxTurns: 20, status: "running" }]),
      },
    });
    const state = await build_dashboard_state(opts, []);
    expect((state.active_loops as any[])[0].loopId).toBe("loop1");
  });

  it("cron jobs → 필드 매핑", async () => {
    const opts = make_full_options({
      cron: {
        status: vi.fn(async () => ({ enabled: true, paused: false, jobs: 1 })),
        list_jobs: vi.fn(async () => [{ id: "j1", name: "daily", enabled: true, schedule: { kind: "every", every_ms: 86400000 }, state: { next_run_at_ms: 9999, last_status: "ok" }, delete_after_run: false, payload: { kind: "agent_turn", message: "run" } }]),
      },
    });
    const state = await build_dashboard_state(opts, []);
    expect((state.cron as any).jobs[0].name).toBe("daily");
  });
});

// ══════════════════════════════════════════
// team_id 스코핑 테스트
// ══════════════════════════════════════════

describe("build_merged_tasks — team_id filtering", () => {
  it("team_id 전달 시 해당 팀 태스크만 반환한다", async () => {
    const opts = {
      agent: {
        list_runtime_tasks: vi.fn(() => [
          { taskId: "t1", team_id: "alpha", title: "A", status: "running", currentTurn: 1, maxTurns: 10, channel: "", chatId: "", objective: "", memory: {} },
          { taskId: "t2", team_id: "beta", title: "B", status: "running", currentTurn: 1, maxTurns: 10, channel: "", chatId: "", objective: "", memory: {} },
        ]),
        list_stored_tasks: vi.fn(async () => [
          { taskId: "t3", team_id: "alpha", title: "C", status: "completed", currentTurn: 5, maxTurns: 10, channel: "", chatId: "", objective: "", memory: {} },
        ]),
      },
    } as any;
    const tasks = await build_merged_tasks(opts, "alpha");
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.taskId !== "t2")).toBe(true);
  });

  it("team_id 미전달 시 전체 태스크 반환한다", async () => {
    const opts = {
      agent: {
        list_runtime_tasks: vi.fn(() => [
          { taskId: "t1", team_id: "alpha", title: "A", status: "running", currentTurn: 1, maxTurns: 10, channel: "", chatId: "", objective: "", memory: {} },
          { taskId: "t2", team_id: "beta", title: "B", status: "running", currentTurn: 1, maxTurns: 10, channel: "", chatId: "", objective: "", memory: {} },
        ]),
        list_stored_tasks: vi.fn(async () => []),
      },
    } as any;
    const tasks = await build_merged_tasks(opts);
    expect(tasks).toHaveLength(2);
  });
});

describe("build_dashboard_state — team_id scoping", () => {
  it("team_id 전달 시 process_tracker에 team_id를 전달한다", async () => {
    const tracker = {
      list_active: vi.fn(() => []),
      list_recent: vi.fn(() => []),
    };
    const opts = make_full_options({ process_tracker: tracker });
    await build_dashboard_state(opts, [], "team-x");
    expect(tracker.list_active).toHaveBeenCalledWith("team-x");
    expect(tracker.list_recent).toHaveBeenCalledWith(20, "team-x");
  });

  it("team_id 미전달 시 process_tracker에 undefined를 전달한다", async () => {
    const tracker = {
      list_active: vi.fn(() => []),
      list_recent: vi.fn(() => []),
    };
    const opts = make_full_options({ process_tracker: tracker });
    await build_dashboard_state(opts, []);
    expect(tracker.list_active).toHaveBeenCalledWith(undefined);
    expect(tracker.list_recent).toHaveBeenCalledWith(20, undefined);
  });

  it("team_id 전달 시 recent_messages를 team_id로 필터링한다", async () => {
    const opts = make_full_options();
    const msgs = [
      { direction: "inbound", sender_id: "u1", content: "a", chat_id: "", at: "2026-01-01", team_id: "alpha" },
      { direction: "inbound", sender_id: "u2", content: "b", chat_id: "", at: "2026-01-01", team_id: "beta" },
      { direction: "inbound", sender_id: "u3", content: "c", chat_id: "", at: "2026-01-01", team_id: "alpha" },
    ] as any[];
    const state = await build_dashboard_state(opts, msgs, "alpha");
    expect((state.messages as any[]).length).toBe(2);
  });
});

// ══════════════════════════════════════════
// OB-7: observability → project_summary 연동
// ══════════════════════════════════════════

describe("build_dashboard_state — observability (OB-7)", () => {
  function make_observability(spans: unknown[] = [], counters: unknown[] = []) {
    return {
      spans: { start: vi.fn(), get_spans: vi.fn(() => spans) },
      metrics: {
        counter: vi.fn(), gauge: vi.fn(), histogram: vi.fn(),
        snapshot: vi.fn(() => ({ counters, gauges: [], histograms: [] })),
      },
    };
  }

  it("observability 미설정 → null", async () => {
    const state = await build_dashboard_state(make_full_options(), []);
    expect(state.observability).toBeNull();
  });

  it("observability 설정 → ObservabilitySummary 5개 키 포함", async () => {
    const obs = make_observability();
    const opts = make_full_options({ observability: obs });
    const state = await build_dashboard_state(opts, []);
    const summary = state.observability as Record<string, unknown>;
    expect(summary).not.toBeNull();
    expect(summary).toHaveProperty("failure_summary");
    expect(summary).toHaveProperty("error_rate");
    expect(summary).toHaveProperty("latency_summary");
    expect(summary).toHaveProperty("delivery_mismatch");
    expect(summary).toHaveProperty("provider_usage");
  });

  it("spans에 에러가 있으면 failure_summary에 반영된다", async () => {
    const spans = [
      { span_id: "s1", trace_id: "tr1", kind: "orchestration_run", name: "run1",
        started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:00:01Z",
        duration_ms: 1000, status: "error", error: "timeout", attributes: {}, correlation: {} },
    ];
    const obs = make_observability(spans);
    const opts = make_full_options({ observability: obs });
    const state = await build_dashboard_state(opts, []);
    const summary = state.observability as Record<string, unknown>;
    const failures = summary.failure_summary as Array<{ kind: string; count: number }>;
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("orchestration_run");
    expect(failures[0].count).toBe(1);
  });

  it("counters에 orchestration_runs_total → provider_usage 반영", async () => {
    const counters = [
      { name: "orchestration_runs_total", labels: { provider: "claude", status: "ok" }, value: 5 },
      { name: "orchestration_runs_total", labels: { provider: "claude", status: "error" }, value: 1 },
    ];
    const obs = make_observability([], counters);
    const opts = make_full_options({ observability: obs });
    const state = await build_dashboard_state(opts, []);
    const summary = state.observability as Record<string, unknown>;
    const usage = summary.provider_usage as Array<{ provider: string; total: number; errors: number }>;
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ provider: "claude", total: 6, errors: 1 });
  });

  it("빈 spans/metrics → 모든 필드가 빈 배열 또는 0", async () => {
    const obs = make_observability();
    const opts = make_full_options({ observability: obs });
    const state = await build_dashboard_state(opts, []);
    const summary = state.observability as Record<string, unknown>;
    expect(summary.failure_summary).toEqual([]);
    expect(summary.error_rate).toEqual({ total: 0, errors: 0, rate: 0 });
    expect(summary.latency_summary).toEqual([]);
    expect(summary.delivery_mismatch).toEqual([]);
    expect(summary.provider_usage).toEqual([]);
  });
});

describe("build_dashboard_state — recent_messages sender lookup", () => {
  it("subagent sender → agents.last_message", async () => {
    const opts = make_full_options({
      agent: {
        list_runtime_tasks: vi.fn(() => []),
        list_stored_tasks: vi.fn(async () => []),
        list_subagents: vi.fn(() => [{ id: "sa-xyz", label: "Bot", role: "worker", model: null, status: "completed", session_id: null, created_at: null, updated_at: null, last_error: null, last_result: null }]),
        list_approval_requests: vi.fn(() => []),
        list_active_loops: vi.fn(() => []),
      },
    });
    const msgs = [{ sender_id: "subagent:sa-xyz", content: "Hello" }] as any[];
    const state = await build_dashboard_state(opts, msgs);
    expect((state.agents as any[])[0].last_message).toBe("Hello");
  });
});
