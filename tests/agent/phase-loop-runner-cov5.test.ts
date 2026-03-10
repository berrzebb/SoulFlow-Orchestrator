/**
 * phase-loop-runner — 미커버 분기 보충 (cov5):
 * - L175-176: depends_on에서 phase_dep 찾음 (completed) → resolved
 * - L826: SEQUENTIAL_LOOP_CONFIG.format_ask_entry ([ASK_USER] → ask_user 호출)
 * - L845: abort_signal already aborted → looping phase 즉시 break
 * - L1041: build_phase_context — prev_phase.critic.review 포함
 * - L1079: truncate_for_critic — result 빈 문자열 → "(no result)"
 * - L1307-1311: set_nested_field — nested to_field "a.b" → 중간 키 생성
 * - L264: switch default_targets 처리
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { register_all_nodes } from "@src/agent/nodes/index.js";
import { run_phase_loop } from "@src/agent/phase-loop-runner.js";
import type { PhaseLoopRunOptions } from "@src/agent/phase-loop.types.js";
import type { SwitchNodeDefinition } from "@src/agent/workflow-node.types.js";

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

// ══════════════════════════════════════════════════════════
// L175-176 — depends_on phase_dep (phase 완료 → resolved)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L175-176 depends_on phase_dep", () => {
  it("Phase B depends_on Phase A → Phase A 완료 후 Phase B 실행", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" }) // Phase A
        .mockResolvedValueOnce({ subagent_id: "sa2" }), // Phase B
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "phase a done" })
        .mockResolvedValueOnce({ status: "completed", content: "phase b done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop({
      workflow_id: "wf-dep-phase",
      title: "Dep Phase WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov5",
      phases: [
        {
          phase_id: "phase-a",
          title: "Phase A",
          agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "do a" }],
        },
        {
          phase_id: "phase-b",
          title: "Phase B",
          depends_on: ["phase-a"], // L172: depends_on 체크 → L175-176: phase_dep 찾음
          agents: [{ agent_id: "b1", role: "analyst", label: "B", backend: "openrouter", system_prompt: "do b" }],
        },
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    expect(subagents.spawn).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════
// L826 — SEQUENTIAL_LOOP_CONFIG.format_ask_entry
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L826 sequential_loop format_ask_entry", () => {
  it("[ASK_USER] 포함 → ask_user 호출 → format_ask_entry 실행 (L826) → [DONE] 종료", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "[ASK_USER] What is your name?" })
        .mockResolvedValueOnce({ status: "completed", content: "Answer received. [DONE]" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const ask_user = vi.fn().mockResolvedValue("User response here");

    const result = await run_phase_loop({
      workflow_id: "wf-seq-ask",
      title: "Seq Ask WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov5",
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        mode: "sequential_loop",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "loop" }],
      }],
      ask_user,
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // ask_user가 호출됨 → format_ask_entry 실행됨 (L826)
    expect(ask_user).toHaveBeenCalledWith("What is your name?");
  });
});

// ══════════════════════════════════════════════════════════
// L845 — abort_signal already aborted → looping phase break
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L845 abort_signal aborted in looping phase", () => {
  it("이미 aborted된 signal → run_looping_phase 첫 반복에서 break", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "some output" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const controller = new AbortController();
    controller.abort(); // 이미 aborted

    const result = await run_phase_loop({
      workflow_id: "wf-abort-loop",
      title: "Abort Loop WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov5",
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        mode: "sequential_loop",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "loop" }],
      }],
      abort_signal: controller.signal,
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    // abort로 인해 spawn은 호출되지 않음
    expect(subagents.spawn).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// L1041 + L1079 — build_phase_context critic.review + truncate_for_critic
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1041/L1079 build_phase_context critic.review", () => {
  it("Phase 1에 critic 있고 approved → Phase 2 context에 critic review 포함 (L1041)", async () => {
    const store = make_store();
    const critic_approved = JSON.stringify({ approved: true, summary: "excellent work!", agent_reviews: [] });

    let second_task = "";
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })  // phase1 agent
        .mockResolvedValueOnce({ subagent_id: "critic1" }) // critic
        .mockImplementationOnce(async (args: any) => { second_task = args.task; return { subagent_id: "sa2" }; }), // phase2 agent
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "phase1 output" })
        .mockResolvedValueOnce({ status: "completed", content: critic_approved })
        .mockResolvedValueOnce({ status: "completed", content: "phase2 output" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop({
      workflow_id: "wf-critic-review",
      title: "Critic Review WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov5",
      phases: [
        {
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "analyze" }],
          critic: { backend: "openrouter", system_prompt: "review quality", gate: false },
        },
        {
          phase_id: "p2",
          title: "Phase 2",
          agents: [{ agent_id: "b1", role: "analyst", label: "Synthesizer", backend: "openrouter", system_prompt: "synthesize" }],
        },
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // Phase 2 task에 Critic Review 섹션 포함됨 (L1041)
    expect(second_task).toContain("Critic Review");
    expect(second_task).toContain("excellent work!");
  });

  it("Phase 1 agent empty content → truncate_for_critic '(no result)' (L1079)", async () => {
    const store = make_store();
    let second_task = "";
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockImplementationOnce(async (args: any) => { second_task = args.task; return { subagent_id: "sa2" }; }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "" }) // empty → agent.result = ""
        .mockResolvedValueOnce({ status: "completed", content: "phase2 done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    await run_phase_loop({
      workflow_id: "wf-empty-result",
      title: "Empty Result WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov5",
      phases: [
        {
          phase_id: "p1",
          title: "Phase 1",
          agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "analyze" }],
        },
        {
          phase_id: "p2",
          title: "Phase 2",
          agents: [{ agent_id: "b1", role: "analyst", label: "Synthesizer", backend: "openrouter", system_prompt: "synthesize" }],
        },
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    // build_phase_context 에서 truncate_for_critic("") → "(no result)" (L1079)
    expect(second_task).toContain("(no result)");
  });
});

// ══════════════════════════════════════════════════════════
// L1307-1311 — set_nested_field for loop (nested to_field)
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L1307-1311 set_nested_field 중간 키 생성 (orche node)", () => {
  it("set orche node + to_field='a.b' → 중간 키 'a' 생성 후 'b' 설정", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop({
      workflow_id: "wf-nested-field",
      title: "Nested Field WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov5",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "nested_value" }] } as any,
      ],
      field_mappings: [
        // to_field="a.b" → set_nested_field with 2-level path → L1308,L1309 실행
        { from_node: "src", from_field: "val", to_node: "target", to_field: "a.b" },
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // target.a.b = "nested_value" 설정됨
    const target = result.memory["target"] as Record<string, unknown>;
    expect((target?.a as Record<string, unknown>)?.b).toBe("nested_value");
  });

  it("to_field='x.y.z' → 3단계 중간 키 생성 (L1308-1309 반복)", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop({
      workflow_id: "wf-deep-nested",
      title: "Deep Nested WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov5",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "deep" }] } as any,
      ],
      field_mappings: [
        { from_node: "src", from_field: "val", to_node: "target", to_field: "x.y.z" },
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    const target = result.memory["target"] as any;
    expect(target?.x?.y?.z).toBe("deep");
  });
});

// ══════════════════════════════════════════════════════════
// L264 — switch default_targets 처리
// ══════════════════════════════════════════════════════════

describe("run_phase_loop — L264 switch default_targets", () => {
  it("switch unmatched case → default_targets 사용 (L264)", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const sw_node: SwitchNodeDefinition = {
      node_id: "sw1",
      node_type: "switch",
      title: "Switch",
      expression: '"unknown_value"', // 어떤 case도 매칭 안 됨 → default_targets 사용
      cases: [
        { value: "case_a", targets: ["set_a"] },
      ],
      default_targets: ["set_default"],
    };

    const result = await run_phase_loop({
      workflow_id: "wf-sw-default",
      title: "Switch Default WF",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/cov5",
      phases: [],
      nodes: [
        sw_node as any,
        { node_id: "set_a", node_type: "set", title: "Set A", assignments: [{ key: "r", value: "a" }] } as any,
        { node_id: "set_default", node_type: "set", title: "Set Default", assignments: [{ key: "r", value: "default" }] } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // default_targets가 활성화되어 set_default 실행됨, set_a는 스킵됨
    expect(result.memory["set_default"]).toBeDefined();
  });
});
