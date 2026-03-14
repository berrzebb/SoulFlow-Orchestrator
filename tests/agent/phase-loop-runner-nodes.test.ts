/**
 * phase-loop-runner — 노드별 실행 분기 통합 테스트:
 * - invoke_llm with system prompt (L1172)
 * - spawn_agent / wait_agent lambda (L1199, L1204, L1206)
 * - decision service lambdas (L1216-1224)
 * - promise service lambdas (L1230-1238)
 * - execute_node 람다 body (L211-214)
 * - sub_workflow null template (L219)
 * - phase_idx < 0 skip (L327)
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
      workspace: "/tmp/nodes",
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
// SO-3 — invoke_llm parse_output("json", ...) 경로 검증
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — invoke_llm JSON parsing via parse_output", () => {
  it("output_json_schema 지정 + 유효 JSON 응답 → parsed 필드에 파싱 결과 포함", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const run_headless = vi.fn().mockResolvedValue({
      content: '{"category":"positive","score":0.95}',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    const providers = { run_headless } as any;

    const result = await run_phase_loop({
      workflow_id: "wf-llm-json",
      title: "LLM JSON Parse WF",
      objective: "test parse_output json path",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/nodes",
      phases: [],
      nodes: [
        {
          node_id: "llm_json",
          node_type: "llm",
          title: "LLM with schema",
          backend: "openrouter",
          prompt_template: "Classify this text",
          output_json_schema: { type: "object", properties: { category: { type: "string" }, score: { type: "number" } } },
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      providers,
    });

    expect(result.status).toBe("completed");
    const output = result.memory["llm_json"] as Record<string, unknown>;
    expect(output.parsed).toEqual({ category: "positive", score: 0.95 });
  });

  it("output_json_schema 지정 + 비JSON 응답 → parsed는 null", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const run_headless = vi.fn().mockResolvedValue({
      content: "This is not JSON at all",
      usage: {},
    });
    const providers = { run_headless } as any;

    const result = await run_phase_loop({
      workflow_id: "wf-llm-nojson",
      title: "LLM Non-JSON Parse WF",
      objective: "test parse_output json fallback",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/nodes",
      phases: [],
      nodes: [
        {
          node_id: "llm_nojson",
          node_type: "llm",
          title: "LLM with schema but non-JSON response",
          backend: "openrouter",
          prompt_template: "Generate something",
          output_json_schema: { type: "object" },
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      providers,
    });

    expect(result.status).toBe("completed");
    const output = result.memory["llm_nojson"] as Record<string, unknown>;
    expect(output.parsed).toBeNull();
  });

  it("output_json_schema 미지정 → parsed는 null (파싱 스킵)", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const run_headless = vi.fn().mockResolvedValue({
      content: '{"valid":"json"}',
      usage: {},
    });
    const providers = { run_headless } as any;

    const result = await run_phase_loop({
      workflow_id: "wf-llm-noschema",
      title: "LLM No Schema WF",
      objective: "test no schema → no parsing",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/nodes",
      phases: [],
      nodes: [
        {
          node_id: "llm_plain",
          node_type: "llm",
          title: "LLM without schema",
          backend: "openrouter",
          prompt_template: "Just respond",
        } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      providers,
    });

    expect(result.status).toBe("completed");
    const output = result.memory["llm_plain"] as Record<string, unknown>;
    expect(output.parsed).toBeNull();
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
      workspace: "/tmp/nodes",
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
