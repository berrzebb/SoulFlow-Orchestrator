/**
 * phase-loop-runner — 미커버 분기 보충 (cov4):
 * - L537-543: workflow try-catch 에러 경로 (workspace 없음 → throw)
 * - L363-365: kanban_store list_boards 호출
 * - L1002: build_agent_task — tools 포함
 * - L1004: build_agent_task — memory.origin 포함
 * - L1006-1014: build_agent_task — kanban_board_id (role=implementer + kanban_store)
 * - L503,L505: retry_targeted — all agents "good" → retry_defs empty → break
 * - L1216-1261: build_runner_services optional deps (orche node 실행 시 설정)
 * - L174: depends_on dep이 skipped_nodes에 있음 → resolved로 처리
 * - L1276: resolve_field 경로 없음 → undefined → skip
 * - L1285: apply_field_mappings to_field 없음 → 직접 assign
 * - L1292: resolve_field empty path → return obj
 * - L1296: resolve_field null 중간값 → undefined
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { register_all_nodes } from "@src/agent/nodes/index.js";
import { run_phase_loop } from "@src/agent/phase-loop-runner.js";
import type { PhaseLoopRunOptions } from "@src/agent/phase-loop.types.js";
import type { IfNodeDefinition } from "@src/agent/workflow-node.types.js";

vi.mock("@src/agent/worktree.js", () => ({
  create_worktree: vi.fn(),
  create_isolated_directory: vi.fn(),
  merge_worktrees: vi.fn(),
  cleanup_worktrees: vi.fn(),
}));

beforeAll(() => {
  register_all_nodes();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────

function make_store() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    insert_message: vi.fn().mockResolvedValue(undefined),
  };
}

const noop_logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

function make_subagents(overrides: Record<string, unknown> = {}) {
  return {
    spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
    wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
    stop: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    get_provider_caps: vi.fn().mockReturnValue({ chatgpt_available: false, claude_available: false, openrouter_available: true }),
    ...overrides,
  };
}

function base_opts(overrides: Partial<PhaseLoopRunOptions> = {}): PhaseLoopRunOptions {
  return {
    workflow_id: "wf-cov4",
    title: "Cov4 WF",
    objective: "test",
    channel: "slack",
    chat_id: "C1",
    workspace: "/tmp/cov4",
    phases: [{
      phase_id: "p1",
      title: "Phase 1",
      agents: [{
        agent_id: "a1", role: "analyst", label: "Analyst",
        backend: "openrouter", system_prompt: "analyze",
      }],
    }],
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════
// L537-543 — workflow try-catch 에러 경로
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L537-543 에러 catch", () => {
  it("workspace='' → run_phase_agents throws → catch → error 반환", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop(
      base_opts({ workspace: "" }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(result.error).toBeTruthy();
    expect(result.error).toContain("workspace");
    // catch 블록에서 store.upsert 호출됨
    expect(store.upsert).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// L363-365 — kanban_store list_boards 호출
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L363-365 kanban_store list_boards", () => {
  it("kanban_store 제공 → list_boards 호출됨", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const kanban_store = {
      list_boards: vi.fn().mockResolvedValue([]),
    };

    const result = await run_phase_loop(
      base_opts(),
      {
        subagents: subagents as any,
        store: store as any,
        logger: noop_logger,
        kanban_store: kanban_store as any,
      },
    );

    expect(result.status).toBe("completed");
    expect(kanban_store.list_boards).toHaveBeenCalledWith("workflow", "wf-cov4");
  });

  it("kanban_store board 반환 → kanban_board_id 설정 (L1006-1014)", async () => {
    const store = make_store();
    let spawned_task = "";
    const subagents = make_subagents({
      spawn: vi.fn().mockImplementationOnce(async (args: any) => {
        spawned_task = args.task;
        return { subagent_id: "sa1" };
      }),
    });
    const kanban_store = {
      list_boards: vi.fn().mockResolvedValue([{ board_id: "board-123" }]),
    };

    await run_phase_loop(
      base_opts({
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{
            agent_id: "a1", role: "implementer", label: "Implementer",
            backend: "openrouter", system_prompt: "implement",
          }],
        }],
      }),
      {
        subagents: subagents as any,
        store: store as any,
        logger: noop_logger,
        kanban_store: kanban_store as any,
      },
    );

    // build_agent_task에서 kanban_board_id가 task에 포함됨
    expect(spawned_task).toContain("board-123");
    expect(spawned_task).toContain("Kanban Board");
  });
});

// ══════════════════════════════════════════════════════════
// L1002 — build_agent_task tools 포함
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1002 build_agent_task tools", () => {
  it("agent_def.tools 있음 → task에 Available Tools 섹션 포함", async () => {
    const store = make_store();
    let spawned_task = "";
    const subagents = make_subagents({
      spawn: vi.fn().mockImplementationOnce(async (args: any) => {
        spawned_task = args.task;
        return { subagent_id: "sa1" };
      }),
    });

    await run_phase_loop(
      base_opts({
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{
            agent_id: "a1", role: "analyst", label: "Analyst",
            backend: "openrouter", system_prompt: "analyze",
            tools: ["code_runner", "file_reader"],
          }],
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(spawned_task).toContain("Available Tools");
    expect(spawned_task).toContain("code_runner");
  });
});

// ══════════════════════════════════════════════════════════
// L1004 — build_agent_task memory.origin
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1004 build_agent_task memory.origin", () => {
  it("initial_memory.origin 있음 → task에 Origin Channel 섹션 포함", async () => {
    const store = make_store();
    let spawned_task = "";
    const subagents = make_subagents({
      spawn: vi.fn().mockImplementationOnce(async (args: any) => {
        spawned_task = args.task;
        return { subagent_id: "sa1" };
      }),
    });

    await run_phase_loop(
      base_opts({
        initial_memory: { origin: { channel: "slack", chat_id: "C1" } },
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    expect(spawned_task).toContain("Origin Channel");
  });
});

// ══════════════════════════════════════════════════════════
// L503, L505 — retry_targeted: all agents "good" → retry_defs empty
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L503/L505 retry_targeted all-good", () => {
  it("critic 거부이지만 모든 agent_reviews quality=good → retry_agents empty → L505 break", async () => {
    const store = make_store();
    // Reject once (but all reviews are "good"), then approve
    const reject_all_good = JSON.stringify({
      approved: false,
      summary: "minor issues",
      agent_reviews: [{ agent_id: "a1", quality: "good", feedback: "mostly ok" }],
    });
    const approve = JSON.stringify({ approved: true, summary: "ok", agent_reviews: [] });

    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockResolvedValueOnce({ subagent_id: "critic1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "agent output" })
        .mockResolvedValueOnce({ status: "completed", content: reject_all_good }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(
      base_opts({
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
          critic: {
            backend: "openrouter",
            system_prompt: "review",
            gate: true,
            on_rejection: "retry_targeted" as any,
            max_retries: 3,
          },
        }],
      }),
      { subagents: subagents as any, store: store as any, logger: noop_logger },
    );

    // retry_defs.length === 0 → critic_passed = true → completed
    expect(result.status).toBe("completed");
    // 재실행 없이 2번만 spawn (agent + critic)
    expect(subagents.spawn).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════
// L1216-1261 — build_runner_services optional deps
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1216-1261 build_runner_services optional deps", () => {
  it("모든 optional deps 제공 → build_runner_services에서 각 서비스 설정됨", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const decision_service = {
      append_decision: vi.fn(),
      list_decisions: vi.fn().mockResolvedValue([]),
      get_effective_decisions: vi.fn().mockResolvedValue([]),
      archive_decision: vi.fn(),
    };
    const promise_service = {
      append_promise: vi.fn(),
      list_promises: vi.fn().mockResolvedValue([]),
      get_effective_promises: vi.fn().mockResolvedValue([]),
      archive_promise: vi.fn(),
    };
    const embed = vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] });
    const vector_store = vi.fn().mockResolvedValue({ rows: [] });
    const oauth_fetch = vi.fn().mockResolvedValue({ status: 200, body: {}, headers: {} });
    const get_webhook_data = vi.fn().mockResolvedValue(null);
    const wait_kanban_event = vi.fn().mockResolvedValue(null);
    const create_task = vi.fn().mockResolvedValue({ task_id: "t1", status: "completed" });
    const query_db = vi.fn().mockResolvedValue({ rows: [], affected_rows: 0 });

    // "set" orche node → build_runner_services 호출됨
    const result = await run_phase_loop({
      workflow_id: "wf-runner-svc",
      title: "Runner Svc WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov4",
      phases: [],
      nodes: [
        { node_id: "set1", node_type: "set", title: "Set1", assignments: [{ key: "x", value: "val" }] } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      decision_service: decision_service as any,
      promise_service: promise_service as any,
      embed: embed as any,
      vector_store: vector_store as any,
      oauth_fetch: oauth_fetch as any,
      get_webhook_data: get_webhook_data as any,
      wait_kanban_event: wait_kanban_event as any,
      create_task: create_task as any,
      query_db: query_db as any,
    });

    expect(result.status).toBe("completed");
    expect(result.memory["set1"]).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// L174 — depends_on: dep이 skipped_nodes에 있음 → resolved
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L174 depends_on skipped dep → resolved", () => {
  it("IF가 true → false_branch=dep_node 스킵; 다른 노드의 depends_on=[dep_node] → skipped로 resolve됨", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const events: Array<{ type: string; node_id?: string }> = [];

    const if_node: IfNodeDefinition = {
      node_id: "if1",
      node_type: "if",
      title: "IF",
      condition: "true",
      outputs: {
        true_branch: [],
        false_branch: ["skipped_dep"],
      },
    };

    const result = await run_phase_loop({
      workflow_id: "wf-dep-skipped",
      title: "Dep Skipped WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov4",
      phases: [],
      nodes: [
        if_node as any,
        // skipped_dep is in false_branch → skipped when IF=true
        { node_id: "skipped_dep", node_type: "set", title: "SkippedDep", assignments: [{ key: "d", value: "should_not_run" }] } as any,
        // depends_on skipped_dep → dep is in skipped_nodes → L174 fires → dep resolved
        { node_id: "dependent", node_type: "set", title: "Dependent", depends_on: ["skipped_dep"], assignments: [{ key: "result", value: "ran" }] } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      on_event: (e) => events.push(e as any),
    });

    expect(result.status).toBe("completed");
    // skipped_dep가 스킵됨
    const skipped = events.filter((e) => e.type === "node_skipped" && e.node_id === "skipped_dep");
    expect(skipped.length).toBeGreaterThan(0);
    // dependent는 실행됨 (dep was in skipped_nodes → resolved)
    expect(result.memory["dependent"]).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// L1276, L1285, L1292, L1296 — field_mappings 엣지 케이스
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — field_mappings 엣지 케이스", () => {
  it("L1276: from_field 경로 없음 → undefined → 매핑 스킵", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-fm-undef",
      title: "FM Undef WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov4",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "v" }] } as any,
      ],
      field_mappings: [
        { from_node: "src", from_field: "nonexistent.deep.path", to_node: "target", to_field: "x" },
      ],
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // 매핑되지 않음
    expect(result.memory["target"]).toBeUndefined();
  });

  it("L1285: to_field 없음 → memory[to_node] = value 직접 할당", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-fm-direct",
      title: "FM Direct WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov4",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "direct_value" }] } as any,
      ],
      field_mappings: [
        { from_node: "src", from_field: "val", to_node: "target_slot", to_field: "" },
      ],
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // to_field="" → memory[target_slot] = value 직접 할당
    expect(result.memory["target_slot"]).toBe("direct_value");
  });

  it("L1292: from_field='' → resolve_field('', obj) → obj 자체 반환", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-fm-empty-path",
      title: "FM Empty Path WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov4",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "whole" }] } as any,
      ],
      field_mappings: [
        { from_node: "src", from_field: "", to_node: "whole_output", to_field: "" },
      ],
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // from_field="" → obj 자체 (set 노드 output 전체)
    expect(result.memory["whole_output"]).toBeDefined();
  });

  it("L1296: from_field 경로 중간에 null → undefined 반환 → 매핑 스킵", async () => {
    const store = make_store();
    const subagents = make_subagents();

    // "set" node output에 null 값을 포함시키기 어려우므로
    // "from_field: 'a.b.c'" 에서 output이 { a: null } 이면 a.b → null로 current됨
    // "set" 노드가 null 값 설정 가능한지 확인 (JSON null)
    const result = await run_phase_loop({
      workflow_id: "wf-fm-null",
      title: "FM Null WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov4",
      phases: [],
      nodes: [
        // assignments에서 null은 JSON으로 직접 전달 가능
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "a", value: null }] } as any,
      ],
      field_mappings: [
        { from_node: "src", from_field: "a.b.c", to_node: "target", to_field: "x" },
      ],
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // a가 null → a.b 접근 시 undefined 반환 → 매핑 스킵
    expect(result.memory["target"]).toBeUndefined();
  });
});
