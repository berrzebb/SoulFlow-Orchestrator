/**
 * state-builder — 미커버 분기 커버리지.
 * - build_dashboard_state: subagents with last_result, processes, decisions/promises/workflow_events with data
 * - cron jobs mapping
 * - list_approval_requests 결과 있음
 * - list_active_loops 결과 있음
 * - memory.workflow.at → updatedAt
 */
import { describe, it, expect, vi } from "vitest";
import { build_dashboard_state, build_merged_tasks } from "@src/dashboard/state-builder.js";

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
      status: vi.fn(async () => ({ enabled: true, paused: false, jobs: 0 })),
      list_jobs: vi.fn(async () => []),
    },
    decisions: { get_effective_decisions: vi.fn(async () => []) },
    promises: { get_effective_promises: vi.fn(async () => []) },
    events: { list: vi.fn(async () => []) },
    stats_ops: { get_cd_score: vi.fn(() => 0) },
    agent_provider_ops: { list: vi.fn(async () => []) },
    ...overrides,
  } as any;
}

// ══════════════════════════════════════════════════════════
// build_merged_tasks — memory.workflow.at → updatedAt
// ══════════════════════════════════════════════════════════

describe("build_merged_tasks — memory fields", () => {
  it("memory.workflow.at → updatedAt 설정", async () => {
    const options = {
      agent: {
        list_runtime_tasks: vi.fn(() => [{
          taskId: "t1", title: "T1", status: "completed",
          currentTurn: 1, maxTurns: 10, channel: "", chatId: "", objective: "",
          memory: { workflow: { at: "2026-01-01T12:00:00Z" } },
        }]),
        list_stored_tasks: vi.fn(async () => []),
      },
    } as any;
    const tasks = await build_merged_tasks(options);
    expect(tasks[0].updatedAt).toBe("2026-01-01T12:00:00Z");
  });

  it("memory.__updated_at_seoul → updatedAt 설정", async () => {
    const options = {
      agent: {
        list_runtime_tasks: vi.fn(() => [{
          taskId: "t2", title: "T2", status: "running",
          currentTurn: 1, maxTurns: 10, channel: "", chatId: "", objective: "",
          memory: { __updated_at_seoul: "2026-02-01T00:00:00Z" },
        }]),
        list_stored_tasks: vi.fn(async () => []),
      },
    } as any;
    const tasks = await build_merged_tasks(options);
    expect(tasks[0].updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("memory.channel + memory.chat_id → 태스크 channel/chat_id", async () => {
    const options = {
      agent: {
        list_runtime_tasks: vi.fn(() => [{
          taskId: "adhoc:x:y", title: "T3", status: "running",
          currentTurn: 1, maxTurns: 10, channel: "", chatId: "",
          objective: "test",
          memory: { channel: "slack", chat_id: "C123" },
        }]),
        list_stored_tasks: vi.fn(async () => []),
      },
    } as any;
    const tasks = await build_merged_tasks(options);
    // channel_from_id = "x" but memory.channel = "slack" → memory wins
    expect(tasks[0].channel).toBe("slack");
    expect(tasks[0].chat_id).toBe("C123");
  });
});

// ══════════════════════════════════════════════════════════
// build_dashboard_state — 데이터 있는 경우
// ══════════════════════════════════════════════════════════

describe("build_dashboard_state — subagents with data", () => {
  it("subagents: last_result가 있으면 200자 자름", async () => {
    const options = make_full_options({
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
    const state = await build_dashboard_state(options, []);
    const agents = state.agents as any[];
    expect(agents[0].last_result.length).toBe(200);
  });

  it("subagents: last_result 없으면 undefined", async () => {
    const options = make_full_options({
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
    const state = await build_dashboard_state(options, []);
    const agents = state.agents as any[];
    expect(agents[0].last_result).toBeUndefined();
    // label 없으면 id 사용
    expect(agents[0].label).toBe("sa2");
  });
});

describe("build_dashboard_state — processes with data", () => {
  it("process_tracker: list_active/list_recent 결과 포함", async () => {
    const process_entry = {
      run_id: "run-1", provider: "slack", chat_id: "C1",
      sender_id: "user1", alias: "assistant", mode: "once", status: "completed",
      executor_provider: "claude", started_at: "2026-01-01", ended_at: "2026-01-02",
      loop_id: null, task_id: "task-1", subagent_ids: [], tool_calls_count: 3, error: null,
    };
    const options = make_full_options({
      process_tracker: {
        list_active: vi.fn(() => [process_entry]),
        list_recent: vi.fn(() => [process_entry]),
      },
    });
    const state = await build_dashboard_state(options, []);
    const processes = state.processes as any;
    expect(processes.active).toHaveLength(1);
    expect(processes.active[0].run_id).toBe("run-1");
    expect(processes.recent).toHaveLength(1);
  });
});

describe("build_dashboard_state — decisions/promises/events with data", () => {
  it("decisions, promises, workflow_events 매핑", async () => {
    const options = make_full_options({
      decisions: {
        get_effective_decisions: vi.fn(async () => [{
          id: "d1", canonical_key: "key1", value: "val1", priority: 1,
        }]),
      },
      promises: {
        get_effective_promises: vi.fn(async () => [{
          id: "p1", canonical_key: "pk1", value: "pval", priority: 2, scope: "global", source: "user",
        }]),
      },
      events: {
        list: vi.fn(async () => [{
          event_id: "ev1", task_id: "t1", run_id: "r1", agent_id: "a1",
          phase: "done", summary: "ok", at: "2026-01-01",
        }]),
      },
    });
    const state = await build_dashboard_state(options, []);
    const decisions = state.decisions as any[];
    expect(decisions[0]).toMatchObject({ id: "d1", canonical_key: "key1", value: "val1", priority: 1 });
    const promises = state.promises as any[];
    expect(promises[0]).toMatchObject({ id: "p1", scope: "global", source: "user" });
    const events = state.workflow_events as any[];
    expect(events[0]).toMatchObject({ event_id: "ev1", task_id: "t1" });
  });
});

describe("build_dashboard_state — approvals / active_loops", () => {
  it("list_approval_requests 결과 → approvals 배열", async () => {
    const options = make_full_options({
      agent: {
        list_runtime_tasks: vi.fn(() => []),
        list_stored_tasks: vi.fn(async () => []),
        list_subagents: vi.fn(() => []),
        list_approval_requests: vi.fn(() => [{
          request_id: "req1", tool_name: "Bash", status: "pending",
          created_at: "2026-01-01", context: { cmd: "ls" },
        }]),
        list_active_loops: vi.fn(() => []),
      },
    });
    const state = await build_dashboard_state(options, []);
    const approvals = state.approvals as any[];
    expect(approvals[0].request_id).toBe("req1");
    expect(approvals[0].tool_name).toBe("Bash");
  });

  it("list_active_loops 결과 → active_loops 배열", async () => {
    const options = make_full_options({
      agent: {
        list_runtime_tasks: vi.fn(() => []),
        list_stored_tasks: vi.fn(async () => []),
        list_subagents: vi.fn(() => []),
        list_approval_requests: vi.fn(() => []),
        list_active_loops: vi.fn(() => [{
          loopId: "loop1", agentId: "ag1", objective: "do something",
          currentTurn: 5, maxTurns: 20, status: "running",
        }]),
      },
    });
    const state = await build_dashboard_state(options, []);
    const loops = state.active_loops as any[];
    expect(loops[0].loopId).toBe("loop1");
    expect(loops[0].currentTurn).toBe(5);
  });
});

describe("build_dashboard_state — cron jobs mapping", () => {
  it("cron jobs → 필드 매핑", async () => {
    const options = make_full_options({
      cron: {
        status: vi.fn(async () => ({ enabled: true, paused: false, jobs: 1 })),
        list_jobs: vi.fn(async () => [{
          id: "j1", name: "daily-report", enabled: true,
          schedule: { kind: "every", every_ms: 86400000 },
          state: { next_run_at_ms: 9999, last_run_at_ms: 1111, last_status: "ok" },
          delete_after_run: false,
          payload: { kind: "agent_turn", message: "run daily" },
        }]),
      },
    });
    const state = await build_dashboard_state(options, []);
    const cron = state.cron as any;
    expect(cron.jobs).toHaveLength(1);
    expect(cron.jobs[0].name).toBe("daily-report");
    expect(cron.jobs[0].schedule.kind).toBe("every");
  });

  it("cron=null → state.cron=null", async () => {
    const options = make_full_options({ cron: null });
    const state = await build_dashboard_state(options, []);
    expect(state.cron).toBeNull();
  });
});

describe("build_dashboard_state — recent_messages sender lookup", () => {
  it("recent_messages → lastBySender 매핑 → agents.last_message", async () => {
    const options = make_full_options({
      agent: {
        list_runtime_tasks: vi.fn(() => []),
        list_stored_tasks: vi.fn(async () => []),
        list_subagents: vi.fn(() => [{
          id: "sa-xyz", label: "Bot", role: "worker", model: null,
          status: "completed", session_id: null,
          created_at: null, updated_at: null,
          last_error: null, last_result: null,
        }]),
        list_approval_requests: vi.fn(() => []),
        list_active_loops: vi.fn(() => []),
      },
    });
    const recent_messages = [
      { sender_id: "subagent:sa-xyz", content: "Hello from subagent" },
    ] as any[];
    const state = await build_dashboard_state(options, recent_messages);
    const agents = state.agents as any[];
    expect(agents[0].last_message).toBe("Hello from subagent");
  });
});

describe("build_dashboard_state — process_tracker=null", () => {
  it("process_tracker=null → processes empty arrays", async () => {
    const options = make_full_options({ process_tracker: null });
    const state = await build_dashboard_state(options, []);
    const processes = state.processes as any;
    expect(processes.active).toEqual([]);
    expect(processes.recent).toEqual([]);
  });
});
