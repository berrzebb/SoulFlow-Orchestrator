/**
 * phase-loop-runner — 미커버 분기 보충 (cov8):
 * - L211-214: execute_node 람다 body (loop 노드 → body set 노드 실행)
 * - L219: run_sub_workflow → load_template null 반환 → template not found throw
 * - L327: phase_idx < 0 → resume_state.phases에 없는 phase 노드 → skip
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { register_all_nodes } from "@src/agent/nodes/index.js";
import { run_phase_loop } from "@src/agent/phase-loop-runner.js";

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

function make_store() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    insert_message: vi.fn().mockResolvedValue(undefined),
  };
}

const noop_logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

function make_subagents() {
  return {
    spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
    wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
    stop: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    get_provider_caps: vi.fn().mockReturnValue({ openrouter_available: true }),
  };
}

// ══════════════════════════════════════════════════════════
// L211-214 — execute_node 람다 body
// loop 노드의 runner_execute → runner.execute_node(body_node, ctx) 호출 경로
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L211-214 execute_node 람다 body", () => {
  it("loop 노드 body에 set 노드 → runner.execute_node 호출 → 람다 L211-214 실행", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-loop-exec-node",
      title: "Loop Execute Node Test",
      objective: "execute_node 람다 커버",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov8",
      phases: [],
      nodes: [
        {
          node_id: "loop1",
          node_type: "loop",
          title: "Loop over items",
          array_field: "items",
          body_nodes: ["body_set"],
          max_iterations: 2,
        } as any,
        {
          node_id: "body_set",
          node_type: "set",
          title: "Body Set",
          assignments: [{ key: "result", value: "iteration_done" }],
        } as any,
      ],
      initial_memory: { items: ["x", "y"] },
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // loop body_set이 execute_node 람다를 통해 실행되었음
    expect(result.memory["loop1"]).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// L213 — execute_node 람다 runner_execute true 분기
// loop body 노드가 runner_execute를 가진 spawn_agent → L213 return h.runner_execute(...)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L213 execute_node 람다 runner_execute true 분기", () => {
  it("loop body에 spawn_agent(runner_execute 보유) → execute_node L213 true 분기 실행", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-loop-spawn-body",
      title: "Loop Spawn Body Test",
      objective: "execute_node runner_execute true branch",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov8",
      phases: [],
      nodes: [
        {
          node_id: "outer_loop",
          node_type: "loop",
          title: "Loop with spawn body",
          array_field: "tasks",
          body_nodes: ["spawn_body"],
          max_iterations: 1,
        } as any,
        {
          node_id: "spawn_body",
          node_type: "spawn_agent",
          title: "Spawn from loop body",
          task: "Process task from loop iteration",
          role: "analyst",
          await_completion: false,
        } as any,
      ],
      initial_memory: { tasks: ["task1"] },
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // spawn_body가 execute_node 람다(L213 true branch)를 통해 실행됨
    expect(subagents.spawn).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// L219 — run_sub_workflow → load_template null 반환
// sub_workflow 노드 runner_execute → runner.run_sub_workflow(name, {})
// → deps.load_template!(name) === null → throw → sub-workflow catch → error output
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L219 sub_workflow template not found", () => {
  it("sub_workflow 노드 + load_template이 null → L219 throw → error output 반환 (workflow 계속)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const load_template = vi.fn().mockReturnValue(null);

    const result = await run_phase_loop({
      workflow_id: "wf-subwf-missing",
      title: "Sub Workflow Missing Test",
      objective: "sub_workflow template not found 커버",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov8",
      phases: [],
      nodes: [
        {
          node_id: "sub1",
          node_type: "sub_workflow",
          title: "Missing Sub Workflow",
          workflow_name: "nonexistent_template",
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      load_template,
    });

    expect(result.status).toBe("completed");
    expect(load_template).toHaveBeenCalledWith("nonexistent_template");
    // sub_workflow 노드는 예외 전파 없이 error output 반환
    const sub_output = result.memory["sub1"] as Record<string, unknown>;
    expect(sub_output?.error).toContain("nonexistent_template");
  });
});

// ══════════════════════════════════════════════════════════
// L327 — phase_idx < 0
// resume_state.phases에 현재 workflow 노드에 없는 phase만 포함
// → phase-a 노드 처리 시 findIndex → -1 → L327 node_idx++ skip
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L327 phase_idx < 0 (resume_state 불일치)", () => {
  it("resume_state.phases에 없는 phase 노드 처리 → phase_idx=-1 → L327 skip 후 계속", async () => {
    const store = make_store();
    const subagents = make_subagents();

    // resume_state: phase-orphan은 포함되지 않음
    const resume_state = {
      workflow_id: "wf-phase-orphan",
      title: "Phase Orphan Test",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      status: "running" as const,
      current_phase: 0,
      phases: [], // phase-orphan 없음
      orche_states: [],
      memory: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      definition: { title: "Phase Orphan Test", objective: "test", phases: [], nodes: undefined },
    };

    const result = await run_phase_loop({
      workflow_id: "wf-phase-orphan",
      title: "Phase Orphan Test",
      objective: "phase_idx=-1 커버",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov8",
      phases: [],
      nodes: [
        // phase-orphan: resume_state.phases에 없음 → phase_idx=-1 → L327
        {
          node_id: "phase-orphan",
          node_type: "phase",
          title: "Orphaned Phase",
          agents: [{ agent_id: "a1", role: "analyst", label: "A1", backend: "openrouter", system_prompt: "analyze" }],
        } as any,
        // 그 다음 set 노드로 workflow 완료
        {
          node_id: "after_skip",
          node_type: "set",
          assignments: [{ key: "skipped_phase", value: "true" }],
        } as any,
      ],
      resume_state: resume_state as any,
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // phase-orphan은 스킵 → set 노드는 실행됨
    expect(result.memory["skipped_phase"]).toBe("true");
  });
});
