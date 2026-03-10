/**
 * phase-loop-runner — 미커버 분기 보충 (cov7):
 * - L1172: invoke_llm with system prompt
 * - L1199, L1204: spawn_agent service lambda body
 * - L1206: wait_agent service lambda body
 * - L1216: decision.append lambda
 * - L1222: decision.list lambda
 * - L1223: decision.get_effective lambda
 * - L1224: decision.archive lambda
 * - L1230: promise.append lambda
 * - L1236: promise.list lambda
 * - L1237: promise.get_effective lambda
 * - L1238: promise.archive lambda
 * - L191-192: orche node skip on goto re-visit
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
    // invoke_llm 내부에서 호출됨
    get_provider_caps: vi.fn().mockReturnValue({ openrouter_available: true }),
  };
}

// ══════════════════════════════════════════════════════════
// L1172 — invoke_llm with system prompt
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1172 invoke_llm system prompt 포함", () => {
  it("llm 노드 + system_prompt 있음 → messages에 system role push (L1172)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const run_headless = vi.fn().mockResolvedValue({ content: "llm response", usage: {} });
    const providers = { run_headless } as any;

    const result = await run_phase_loop({
      workflow_id: "wf-llm-sys",
      title: "LLM System WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        {
          node_id: "llm1",
          node_type: "llm",
          title: "LLM with system",
          backend: "openrouter",
          prompt_template: "Please do something useful and helpful",
          system_prompt: "You are a highly capable assistant for testing",
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      providers,
    });

    expect(result.status).toBe("completed");
    expect(run_headless).toHaveBeenCalled();
    // system message pushed (L1172)
    const messages = run_headless.mock.calls[0][0].messages;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("highly capable assistant");
  });
});

// ══════════════════════════════════════════════════════════
// L1199, L1204 — spawn_agent lambda body (await=false)
// L1206 — wait_agent lambda body (await=true)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1199/L1204/L1206 spawn_agent + wait_agent lambda", () => {
  it("spawn_agent 노드 await_completion=false → spawn 호출, wait 미호출 (L1199-1204)", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-spawn-no-wait",
      title: "Spawn No Wait WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        {
          node_id: "sp1",
          node_type: "spawn_agent",
          title: "Spawn Agent",
          task: "Perform an important background task here",
          role: "analyst",
          await_completion: false,
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // spawn_agent lambda body (L1199-1204) called
    expect(subagents.spawn).toHaveBeenCalled();
    // wait_for_completion NOT called (await_completion=false)
    expect(subagents.wait_for_completion).not.toHaveBeenCalled();
  });

  it("spawn_agent 노드 await_completion=true → spawn + wait 모두 호출 (L1199+L1206)", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-spawn-wait",
      title: "Spawn Wait WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        {
          node_id: "sp2",
          node_type: "spawn_agent",
          title: "Spawn And Wait Agent",
          task: "Perform a foreground synchronous task here",
          role: "synthesizer",
          await_completion: true,
          max_iterations: 5,
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // Both spawn (L1199) and wait_for_completion (L1206) called
    expect(subagents.spawn).toHaveBeenCalled();
    expect(subagents.wait_for_completion).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// L1216-1224 — decision service lambda bodies
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1216-1224 decision service lambdas", () => {
  function make_decision_service() {
    return {
      append_decision: vi.fn().mockResolvedValue({ action: "created", record: { id: "d1", key: "choice", value: "yes" } }),
      list_decisions: vi.fn().mockResolvedValue([]),
      get_effective_decisions: vi.fn().mockResolvedValue([]),
      archive_decision: vi.fn().mockResolvedValue(true),
    };
  }

  it("decision operation=append → decision.append lambda body (L1216)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const decision_service = make_decision_service();

    const result = await run_phase_loop({
      workflow_id: "wf-dec-append",
      title: "Decision Append WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        {
          node_id: "dec1",
          node_type: "decision",
          title: "Append Decision",
          operation: "append",
          scope: "global",
          key: "strategy",
          value: "aggressive",
          rationale: "test rationale",
          priority: 1,
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      decision_service: decision_service as any,
    });

    expect(result.status).toBe("completed");
    // decision.append lambda body (L1216) called → calls ds.append_decision
    expect(decision_service.append_decision).toHaveBeenCalled();
  });

  it("decision operation=list → decision.list lambda body (L1222)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const decision_service = make_decision_service();

    await run_phase_loop({
      workflow_id: "wf-dec-list",
      title: "Decision List WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        { node_id: "dec2", node_type: "decision", title: "List Decisions", operation: "list", scope: "global" } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      decision_service: decision_service as any,
    });

    expect(decision_service.list_decisions).toHaveBeenCalled();
  });

  it("decision operation=get_effective → decision.get_effective lambda (L1223)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const decision_service = make_decision_service();

    await run_phase_loop({
      workflow_id: "wf-dec-geff",
      title: "Decision GetEffective WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        { node_id: "dec3", node_type: "decision", title: "Get Effective", operation: "get_effective" } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      decision_service: decision_service as any,
    });

    expect(decision_service.get_effective_decisions).toHaveBeenCalled();
  });

  it("decision operation=archive → decision.archive lambda (L1224)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const decision_service = make_decision_service();

    await run_phase_loop({
      workflow_id: "wf-dec-archive",
      title: "Decision Archive WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        { node_id: "dec4", node_type: "decision", title: "Archive Decision", operation: "archive", target_id: "decision-123" } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      decision_service: decision_service as any,
    });

    expect(decision_service.archive_decision).toHaveBeenCalledWith("decision-123");
  });
});

// ══════════════════════════════════════════════════════════
// L1230-1238 — promise service lambda bodies
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1230-1238 promise service lambdas", () => {
  function make_promise_service() {
    return {
      append_promise: vi.fn().mockResolvedValue({ action: "created", record: { id: "p1" } }),
      list_promises: vi.fn().mockResolvedValue([]),
      get_effective_promises: vi.fn().mockResolvedValue([]),
      archive_promise: vi.fn().mockResolvedValue(true),
    };
  }

  it("promise operation=append → promise.append lambda body (L1230)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const promise_service = make_promise_service();

    await run_phase_loop({
      workflow_id: "wf-prm-append",
      title: "Promise Append WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        {
          node_id: "prm1",
          node_type: "promise",
          title: "Append Promise",
          operation: "append",
          scope: "global",
          key: "delivery",
          value: "on_time",
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      promise_service: promise_service as any,
    });

    expect(promise_service.append_promise).toHaveBeenCalled();
  });

  it("promise operation=list → promise.list lambda body (L1236)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const promise_service = make_promise_service();

    await run_phase_loop({
      workflow_id: "wf-prm-list",
      title: "Promise List WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        { node_id: "prm2", node_type: "promise", title: "List Promises", operation: "list" } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      promise_service: promise_service as any,
    });

    expect(promise_service.list_promises).toHaveBeenCalled();
  });

  it("promise operation=get_effective → promise.get_effective lambda (L1237)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const promise_service = make_promise_service();

    await run_phase_loop({
      workflow_id: "wf-prm-geff",
      title: "Promise GetEffective WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        { node_id: "prm3", node_type: "promise", title: "Get Effective", operation: "get_effective" } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      promise_service: promise_service as any,
    });

    expect(promise_service.get_effective_promises).toHaveBeenCalled();
  });

  it("promise operation=archive → promise.archive lambda (L1238)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const promise_service = make_promise_service();

    await run_phase_loop({
      workflow_id: "wf-prm-archive",
      title: "Promise Archive WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [],
      nodes: [
        { node_id: "prm4", node_type: "promise", title: "Archive Promise", operation: "archive", target_id: "promise-abc" } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      promise_service: promise_service as any,
    });

    expect(promise_service.archive_promise).toHaveBeenCalledWith("promise-abc");
  });
});

// ══════════════════════════════════════════════════════════
// L191-192 — orche node skip on goto re-visit
// nodes[]에 phase + set 노드를 함께 배치해야 normalize_workflow가 nodes를 우선 사용
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L191-192 goto 후 orche node 재방문 스킵", () => {
  it("phase-2 critic goto phase-1 → set_b(orche) 재방문 → status=completed → L191-192", async () => {
    const store = make_store();
    const critic_reject = JSON.stringify({ approved: false, summary: "needs improvement retry goto now" });

    let wait_count = 0;
    const subagents = {
      ...make_subagents(),
      spawn: vi.fn().mockImplementation(async () => ({ subagent_id: `sa${++wait_count}` })),
      wait_for_completion: vi.fn().mockImplementation(async () => {
        if (wait_count === 3) {
          return { status: "completed", content: critic_reject };
        }
        return { status: "completed", content: "completed result" };
      }),
    };

    // NOTE: options.nodes takes precedence over options.phases in normalize_workflow
    // Phase nodes must be in options.nodes as node_type:"phase" entries
    const result = await run_phase_loop({
      workflow_id: "wf-goto-orche",
      title: "Goto Orche WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov7",
      phases: [], // unused when nodes[] has length
      nodes: [
        {
          node_id: "phase-1",
          node_type: "phase",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "A1", backend: "openrouter", system_prompt: "analyze" }],
        } as any,
        {
          node_id: "set_b",
          node_type: "set",
          title: "Set B",
          assignments: [{ key: "r", value: "b_val" }],
        } as any,
        {
          node_id: "phase-2",
          node_type: "phase",
          title: "Phase 2",
          agents: [{ agent_id: "a2", role: "analyst", label: "A2", backend: "openrouter", system_prompt: "synthesize" }],
          critic: {
            backend: "openrouter",
            system_prompt: "review carefully",
            gate: true,
            on_rejection: "goto",
            goto_phase: "phase-1",
            max_retries: 1,
          },
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    // After goto: phase-1 re-runs (reset), then set_b is skipped (orche already completed → L191-192)
    // phase-2 re-runs, critic → count=2 > max_retries=1 → waiting_user_input
    expect(["completed", "waiting_user_input"]).toContain(result.status);
  });
});
