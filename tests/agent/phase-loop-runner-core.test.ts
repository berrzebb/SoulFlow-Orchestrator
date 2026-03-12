/**
 * phase-loop-runner — 미커버 경로 보충.
 * - Phase 에이전트 실행 (run_phase_agents): 성공 / 실패
 * - 실패 정책: fail_fast, quorum
 * - Critic 리뷰: 승인, 거부(escalate), 예외(soft-fail)
 * - sequential_loop 모드: [DONE] 토큰으로 종료
 * - 중단 신호(abort_signal)
 * - 오케스트레이션 노드 예외 → 워크플로우 failed
 * - resume 상태: 완료 노드 스킵
 * - merge_phase_results_to_memory 경로
 * - depends_on phase_dep, format_ask_entry, abort looping, critic review context
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { register_all_nodes } from "@src/agent/nodes/index.js";
import { run_phase_loop } from "@src/agent/phase-loop-runner.js";
import type { PhaseLoopRunOptions } from "@src/agent/phase-loop.types.js";
import type { IfNodeDefinition, SwitchNodeDefinition } from "@src/agent/workflow-node.types.js";

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

function make_subagents(
  spawn_result = { subagent_id: "sa1" },
  wait_result: { status: string; content?: string; error?: string } = { status: "completed", content: "agent output" },
) {
  return {
    spawn: vi.fn().mockResolvedValue(spawn_result),
    wait_for_completion: vi.fn().mockResolvedValue(wait_result),
    stop: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  };
}

const noop_logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

function single_phase_opts(overrides: Partial<PhaseLoopRunOptions> = {}): PhaseLoopRunOptions {
  return {
    workflow_id: "wf-test",
    title: "Test WF",
    objective: "objective",
    channel: "slack",
    chat_id: "C1",
    workspace: "/tmp/phase-test",
    phases: [{
      phase_id: "p1",
      title: "Phase 1",
      agents: [{
        agent_id: "a1",
        role: "analyst",
        label: "Analyst",
        backend: "openrouter",
        system_prompt: "analyze",
      }],
    }],
    ...overrides,
  };
}

// ──────────────────────────────────────────────────
// 기본 Phase 에이전트 실행 — 성공
// ──────────────────────────────────────────────────

describe("run_phase_loop — 기본 phase 에이전트 성공", () => {
  it("단일 에이전트 완료 → status=completed", async () => {
    const store = make_store();
    const subagents = make_subagents({ subagent_id: "sa1" }, { status: "completed", content: "good output" });

    const result = await run_phase_loop(single_phase_opts(), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(result.phases[0]?.agents[0]?.status).toBe("completed");
    expect(subagents.spawn).toHaveBeenCalledOnce();
  });

  it("에이전트 실패 (wait_result status=failed) → best_effort로 완료", async () => {
    const store = make_store();
    const subagents = make_subagents({ subagent_id: "sa1" }, { status: "failed", error: "timeout" });

    const result = await run_phase_loop(single_phase_opts(), { subagents: subagents as any, store: store as any, logger: noop_logger });

    // best_effort policy → 실패해도 workflow는 completed
    expect(result.status).toBe("completed");
    expect(result.phases[0]?.agents[0]?.status).toBe("failed");
  });

  it("spawn 예외 → 에이전트 failed, best_effort라서 workflow completed", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockRejectedValue(new Error("spawn error")),
      wait_for_completion: vi.fn(),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts(), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.phases[0]?.agents[0]?.status).toBe("failed");
    expect(result.status).toBe("completed");
  });
});

// ──────────────────────────────────────────────────
// 실패 정책: fail_fast
// ──────────────────────────────────────────────────

describe("run_phase_loop — fail_fast 정책", () => {
  it("에이전트 실패 + fail_fast → workflow failed", async () => {
    const store = make_store();
    const subagents = make_subagents({ subagent_id: "sa1" }, { status: "failed", error: "err" });

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        failure_policy: "fail_fast",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("failed");
  });
});

// ──────────────────────────────────────────────────
// 실패 정책: quorum
// ──────────────────────────────────────────────────

describe("run_phase_loop — quorum 정책", () => {
  it("에이전트 실패 + quorum=2, success=0 → workflow failed", async () => {
    const store = make_store();
    const subagents = make_subagents({ subagent_id: "sa1" }, { status: "failed", error: "err" });

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        failure_policy: "quorum",
        quorum_count: 2,
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("failed");
  });
});

// ──────────────────────────────────────────────────
// Critic — 승인
// ──────────────────────────────────────────────────

describe("run_phase_loop — critic 승인", () => {
  it("critic approved=true → workflow completed", async () => {
    const store = make_store();
    const critic_response = JSON.stringify({ approved: true, summary: "looks good", agent_reviews: [] });
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" }) // agent
        .mockResolvedValueOnce({ subagent_id: "critic1" }), // critic
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "output" }) // agent
        .mockResolvedValueOnce({ status: "completed", content: critic_response }), // critic
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
        critic: { backend: "openrouter", system_prompt: "review", gate: true },
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(result.phases[0]?.critic?.approved).toBe(true);
  });
});

// ──────────────────────────────────────────────────
// Critic — 거부 + escalate
// ──────────────────────────────────────────────────

describe("run_phase_loop — critic 거부 + escalate", () => {
  it("critic rejected + gate=true + escalate → waiting_user_input", async () => {
    const store = make_store();
    const critic_response = JSON.stringify({ approved: false, summary: "bad output", agent_reviews: [] });
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" }) // agent
        .mockResolvedValueOnce({ subagent_id: "critic1" }), // critic
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "output" }) // agent
        .mockResolvedValueOnce({ status: "completed", content: critic_response }), // critic
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
        critic: { backend: "openrouter", system_prompt: "review", gate: true, on_rejection: "escalate" },
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("waiting_user_input");
  });
});

// ──────────────────────────────────────────────────
// Critic — 예외 → soft-fail (approved=true)
// ──────────────────────────────────────────────────

describe("run_phase_loop — critic 예외", () => {
  it("critic spawn 예외 → soft-fail: workflow completed", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" }) // agent
        .mockRejectedValueOnce(new Error("critic spawn failed")), // critic
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "output" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
        critic: { backend: "openrouter", system_prompt: "review", gate: true },
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    // critic 예외 → approved=true (soft-fail) → workflow completes
    expect(result.status).toBe("completed");
  });
});

// ──────────────────────────────────────────────────
// sequential_loop 모드
// ──────────────────────────────────────────────────

describe("run_phase_loop — sequential_loop 모드", () => {
  it("[DONE] 토큰 → 루프 종료 후 completed", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "first output" })
        .mockResolvedValueOnce({ status: "completed", content: "final [DONE]" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        mode: "sequential_loop",
        max_loop_iterations: 5,
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(result.phases[0]?.agents[0]?.status).toBe("completed");
  });
});

// ──────────────────────────────────────────────────
// 중단 신호
// ──────────────────────────────────────────────────

describe("run_phase_loop — abort_signal", () => {
  it("이미 중단된 신호 → 즉시 cancelled", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const abort = new AbortController();
    abort.abort(); // 즉시 중단

    const result = await run_phase_loop(single_phase_opts({ abort_signal: abort.signal }), {
      subagents: subagents as any, store: store as any, logger: noop_logger,
    });

    expect(result.status).toBe("cancelled");
    expect(subagents.spawn).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────
// 오케스트레이션 노드 예외
// ──────────────────────────────────────────────────

describe("run_phase_loop — orche 노드 예외", () => {
  it("orche 노드 실행 실패 → workflow failed", async () => {
    const store = make_store();
    const subagents = make_subagents();

    // "delay" 노드는 wait_ms가 없으면 즉시 완료되므로, 존재하지 않는 node_type으로 예외 유발
    const result = await run_phase_loop({
      workflow_id: "wf-fail",
      title: "Fail WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp/phase-test",
      nodes: [{
        node_id: "bad_node",
        node_type: "nonexistent_type_xyz" as any,
        title: "Bad",
      } as any],
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    // 핸들러가 없으므로 execute_orche_node에서 에러 발생 → failed
    expect(result.status).toBe("failed");
  });
});

// ──────────────────────────────────────────────────
// on_event 콜백
// ──────────────────────────────────────────────────

describe("run_phase_loop — on_event 콜백", () => {
  it("workflow_started, phase_started, agent_started 이벤트 발생", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const events: string[] = [];

    await run_phase_loop(single_phase_opts(), {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      on_event: (e) => events.push(e.type),
    });

    expect(events).toContain("workflow_started");
    expect(events).toContain("phase_started");
    expect(events).toContain("agent_started");
    expect(events).toContain("workflow_completed");
  });
});

// ──────────────────────────────────────────────────
// resume 상태: 완료된 phase 스킵
// ──────────────────────────────────────────────────

describe("run_phase_loop — resume 완료 phase 스킵", () => {
  it("이미 completed인 phase_state → 에이전트 재실행 안 함", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const resume_state: any = {
      workflow_id: "wf-resume",
      title: "Resume WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      status: "running",
      current_phase: 0,
      memory: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      orche_states: [],
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        status: "completed",
        agents: [{
          agent_id: "a1", role: "analyst", label: "A", model: "",
          status: "completed", result: "done", messages: [],
        }],
      }],
      definition: {
        title: "Resume WF",
        objective: "obj",
        phases: [{ phase_id: "p1", title: "Phase 1", agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }] }],
      },
    };

    const result = await run_phase_loop(single_phase_opts({
      workflow_id: "wf-resume",
      resume_state,
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // resume 시 이미 완료된 phase는 spawn 호출 없이 스킵됨
    expect(subagents.spawn).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────
// IF 노드 + skipped_nodes 처리 (L160-167, L250-254)
// ──────────────────────────────────────────────────

describe("run_phase_loop — IF 노드 분기 + skipped", () => {
  it("condition=true → false_branch 노드 스킵 처리", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const events: Array<{ type: string; node_id?: string; reason?: string }> = [];

    const if_node: IfNodeDefinition = {
      node_id: "if1",
      node_type: "if",
      title: "IF",
      condition: "true",
      outputs: {
        true_branch: ["set_true"],
        false_branch: ["set_false"],
      },
    };

    await run_phase_loop({
      workflow_id: "wf-if",
      title: "IF WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp",
      phases: [],
      nodes: [
        if_node as any,
        { node_id: "set_true", node_type: "set", title: "Set True", assignments: [{ key: "r", value: "true_path" }] } as any,
        { node_id: "set_false", node_type: "set", title: "Set False", assignments: [{ key: "r", value: "false_path" }] } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      on_event: (e) => events.push(e as any),
    });

    const skipped = events.filter((e) => e.type === "node_skipped" && e.node_id === "set_false");
    expect(skipped.length).toBeGreaterThan(0);
    expect((skipped[0] as any).reason).toBe("if_branch_inactive");
  });
});

// ──────────────────────────────────────────────────
// Switch 노드 + skipped_nodes 처리 (L257-267)
// ──────────────────────────────────────────────────

describe("run_phase_loop — Switch 노드 분기 + skipped", () => {
  it("switch 매칭 case_a → case_b targets 스킵", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const events: Array<{ type: string; node_id?: string }> = [];

    const sw_node: SwitchNodeDefinition = {
      node_id: "sw1",
      node_type: "switch",
      title: "Switch",
      expression: '"case_a"',
      cases: [
        { value: "case_a", targets: ["set_a"] },
        { value: "case_b", targets: ["set_b"] },
      ],
    };

    await run_phase_loop({
      workflow_id: "wf-switch",
      title: "Switch WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp",
      phases: [],
      nodes: [
        sw_node as any,
        { node_id: "set_a", node_type: "set", title: "Set A", assignments: [{ key: "r", value: "a" }] } as any,
        { node_id: "set_b", node_type: "set", title: "Set B", assignments: [{ key: "r", value: "b" }] } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      on_event: (e) => events.push(e as any),
    });

    const skipped = events.filter((e) => e.type === "node_skipped" && e.node_id === "set_b");
    expect(skipped.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────
// Resume: orche_states 완료 노드 스킵 (L131-132)
// ──────────────────────────────────────────────────

describe("run_phase_loop — resume orche_states 완료 노드", () => {
  it("resume_state.orche_states에 completed 노드 → completed_node_ids 추가 후 스킵", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const events: Array<{ type: string; node_id?: string }> = [];

    const resume_state: any = {
      workflow_id: "wf-orche-resume",
      title: "Orche Resume WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      status: "running",
      current_phase: 0,
      memory: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      phases: [],
      orche_states: [
        { node_id: "set1", node_type: "set", status: "completed", result: { r: "done" } },
      ],
      definition: {
        title: "Orche Resume WF",
        objective: "obj",
        phases: [],
        nodes: [
          { node_id: "set1", node_type: "set", title: "Set1", assignments: [{ key: "r", value: "v" }] },
        ],
      },
    };

    await run_phase_loop({
      workflow_id: "wf-orche-resume",
      title: "Orche Resume WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp",
      phases: [],
      nodes: [
        { node_id: "set1", node_type: "set", title: "Set1", assignments: [{ key: "r", value: "v" }] } as any,
      ],
      resume_state,
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      on_event: (e) => events.push(e as any),
    });

    const skipped = events.filter((e) => e.type === "node_skipped" && e.node_id === "set1");
    expect(skipped.length).toBeGreaterThan(0);
    expect((skipped[0] as any).reason).toBe("already_completed");
  });
});

// ──────────────────────────────────────────────────
// depends_on: 존재하지 않는 의존성 → unmet (L178-182)
// ──────────────────────────────────────────────────

describe("run_phase_loop — depends_on 미충족 (unfound dep)", () => {
  it("depends_on에 존재하지 않는 노드 → 해당 노드 스킵, workflow completed", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-dep",
      title: "Dep WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp",
      phases: [],
      nodes: [
        { node_id: "set_a", node_type: "set", title: "Set A", assignments: [{ key: "a", value: 1 }] } as any,
        // depends_on "nonexistent" 은 노드 목록에 없어 unmet 상태 유지
        { node_id: "set_b", node_type: "set", title: "Set B", depends_on: ["nonexistent_xyz"], assignments: [{ key: "b", value: 2 }] } as any,
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    // set_b는 unmet dep으로 실행되지 않음 (memory에 b 없음)
    expect(result.memory["set_b"]).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────
// field_mappings (L245-247)
// ──────────────────────────────────────────────────

describe("run_phase_loop — field_mappings", () => {
  it("from_node 출력 필드를 to_node 메모리에 주입", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-field-map",
      title: "FieldMap WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "set", title: "Src", assignments: [{ key: "val", value: "mapped_value" }] } as any,
      ],
      // to_node "target_slot"은 실제 노드가 아니므로 덮어쓰이지 않음
      field_mappings: [
        { from_node: "src", from_field: "val", to_node: "target_slot", to_field: "injected" },
      ],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
    });

    expect(result.status).toBe("completed");
    expect((result.memory["target_slot"] as any)?.injected).toBe("mapped_value");
  });
});

// ──────────────────────────────────────────────────
// interactive 모드 (L369-379)
// ──────────────────────────────────────────────────

describe("run_phase_loop — interactive 모드", () => {
  it("[SPEC_COMPLETE] 토큰 → 루프 종료 후 completed", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "interactive response [SPEC_COMPLETE]" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Interactive Phase",
        mode: "interactive" as any,
        max_loop_iterations: 5,
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
  });
});

// ──────────────────────────────────────────────────
// Critic retry_all 거부 정책 (L483-494)
// ──────────────────────────────────────────────────

describe("run_phase_loop — critic retry_all 정책", () => {
  it("1회 거부 후 retry_all → 재실행 후 승인 → completed", async () => {
    const store = make_store();
    const reject = JSON.stringify({ approved: false, summary: "needs work", agent_reviews: [] });
    const approve = JSON.stringify({ approved: true, summary: "good", agent_reviews: [] });
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })       // 1st agent
        .mockResolvedValueOnce({ subagent_id: "critic1" })   // 1st critic
        .mockResolvedValueOnce({ subagent_id: "sa2" })       // retry agent
        .mockResolvedValueOnce({ subagent_id: "critic2" }),  // 2nd critic
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "output" })
        .mockResolvedValueOnce({ status: "completed", content: reject })
        .mockResolvedValueOnce({ status: "completed", content: "improved" })
        .mockResolvedValueOnce({ status: "completed", content: approve }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
        critic: { backend: "openrouter", system_prompt: "review", gate: true, on_rejection: "retry_all" as any, max_retries: 2 },
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(subagents.spawn).toHaveBeenCalledTimes(4);
  });
});

// ──────────────────────────────────────────────────
// Critic retry_targeted 거부 정책 (L498-520)
// ──────────────────────────────────────────────────

describe("run_phase_loop — critic retry_targeted 정책", () => {
  it("1회 거부 후 retry_targeted → 지적된 에이전트 재실행 후 승인 → completed", async () => {
    const store = make_store();
    const reject = JSON.stringify({
      approved: false,
      summary: "a1 needs improvement",
      agent_reviews: [{ agent_id: "a1", quality: "needs_improvement", feedback: "improve" }],
    });
    const approve = JSON.stringify({ approved: true, summary: "good", agent_reviews: [] });
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockResolvedValueOnce({ subagent_id: "critic1" })
        .mockResolvedValueOnce({ subagent_id: "sa2" })
        .mockResolvedValueOnce({ subagent_id: "critic2" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "output" })
        .mockResolvedValueOnce({ status: "completed", content: reject })
        .mockResolvedValueOnce({ status: "completed", content: "improved" })
        .mockResolvedValueOnce({ status: "completed", content: approve }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
        critic: { backend: "openrouter", system_prompt: "review", gate: true, on_rejection: "retry_targeted" as any, max_retries: 2 },
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(subagents.spawn).toHaveBeenCalledTimes(4);
  });
});

// ──────────────────────────────────────────────────
// Resume: 에이전트 전원 completed → phase 완료 스킵 (L338-344)
// ──────────────────────────────────────────────────

describe("run_phase_loop — resume 에이전트 전원 completed", () => {
  it("resume 시 agents 전원 completed 이지만 phase_state.status=running → phase completed로 승격 후 스킵", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const resume_state: any = {
      workflow_id: "wf-agents-done",
      title: "Agents Done WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      status: "running",
      current_phase: 0,
      memory: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      orche_states: [],
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        // status가 running이지만 agents는 전원 completed
        status: "running",
        agents: [{
          agent_id: "a1", role: "analyst", label: "A", model: "",
          status: "completed", result: "done", messages: [],
        }],
      }],
      definition: {
        title: "Agents Done WF",
        objective: "obj",
        phases: [{ phase_id: "p1", title: "Phase 1", agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }] }],
      },
    };

    const result = await run_phase_loop(single_phase_opts({
      workflow_id: "wf-agents-done",
      resume_state,
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(subagents.spawn).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────
// Critic goto 거부 정책 — target not found (L453-457)
// ──────────────────────────────────────────────────

describe("run_phase_loop — critic goto: target phase 없음", () => {
  it("goto_phase가 존재하지 않으면 critic_passed=true 처리", async () => {
    const store = make_store();
    const reject = JSON.stringify({ approved: false, summary: "bad", agent_reviews: [] });
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })
        .mockResolvedValueOnce({ subagent_id: "critic1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "output" })
        .mockResolvedValueOnce({ status: "completed", content: reject }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
        critic: { backend: "openrouter", system_prompt: "review", gate: true, on_rejection: "goto" as any, goto_phase: "nonexistent_phase" as any },
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    // goto_phase가 없으면 critic_passed=true → workflow completed
    expect(result.status).toBe("completed");
  });
});

// ──────────────────────────────────────────────────
// Critic goto 거부 정책 — 실제 goto + max_retries 초과 시 escalate (L439-450)
// ──────────────────────────────────────────────────

describe("run_phase_loop — critic goto: 실제 goto 후 max_retries 초과 → escalate", () => {
  it("goto 1회 후 max_retries(1) 초과 → waiting_user_input", async () => {
    const store = make_store();
    const reject = JSON.stringify({ approved: false, summary: "bad", agent_reviews: [] });
    // goto 후 p1 재실행: agent 2번 + critic 2번
    const subagents = {
      spawn: vi.fn()
        .mockResolvedValueOnce({ subagent_id: "sa1" })      // 1st p1 agent
        .mockResolvedValueOnce({ subagent_id: "c1" })       // 1st critic → reject → goto
        .mockResolvedValueOnce({ subagent_id: "sa2" })      // 2nd p1 agent (after goto reset)
        .mockResolvedValueOnce({ subagent_id: "c2" }),      // 2nd critic → reject → count=2>1 → escalate
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "output1" })
        .mockResolvedValueOnce({ status: "completed", content: reject })
        .mockResolvedValueOnce({ status: "completed", content: "output2" })
        .mockResolvedValueOnce({ status: "completed", content: reject }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
        critic: {
          backend: "openrouter",
          system_prompt: "review",
          gate: true,
          on_rejection: "goto" as any,
          goto_phase: "p1" as any,
          max_retries: 1,
        },
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("waiting_user_input");
    expect(subagents.spawn).toHaveBeenCalledTimes(4);
  });
});

// ──────────────────────────────────────────────────
// is_waiting: kanban_trigger 노드가 null 반환 → waiting (L271-293)
// ──────────────────────────────────────────────────

describe("run_phase_loop — is_waiting: kanban_trigger null 이벤트", () => {
  it("wait_kanban_event가 null 반환 → state=waiting_user_input, node_waiting 이벤트", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const events: Array<{ type: string }> = [];
    const kanban_waiting_cb = vi.fn();

    const result = await run_phase_loop({
      workflow_id: "wf-kanban-wait",
      title: "Kanban Wait WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp",
      phases: [],
      nodes: [{
        node_id: "kanban1",
        node_type: "kanban_trigger" as any,
        title: "Kanban Trigger",
        kanban_board_id: "board-001",
        kanban_actions: ["created"],
      } as any],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      on_event: (e) => events.push(e),
      wait_kanban_event: async () => null,
      on_kanban_trigger_waiting: kanban_waiting_cb,
    });

    expect(result.status).toBe("waiting_user_input");
    expect(events.some((e) => e.type === "node_waiting")).toBe(true);
    expect(kanban_waiting_cb).toHaveBeenCalledWith("wf-kanban-wait");
  });
});

// ──────────────────────────────────────────────────
// [ASK_USER] in interactive mode (L900-912)
// ──────────────────────────────────────────────────

describe("run_phase_loop — interactive 모드 [ASK_USER]", () => {
  it("[ASK_USER] 토큰 → ask_user 호출 후 loop 계속, [SPEC_COMPLETE]로 종료", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "[ASK_USER] 선호도를 알려주세요" })
        .mockResolvedValueOnce({ status: "completed", content: "완료 [SPEC_COMPLETE]" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };
    const ask_user = vi.fn().mockResolvedValue("내 선호도는 A입니다");

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Interactive Phase",
        mode: "interactive" as any,
        max_loop_iterations: 5,
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
      }],
      ask_user,
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(ask_user).toHaveBeenCalledWith("선호도를 알려주세요");
    expect(subagents.spawn).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────────
// sequential_loop 최대 반복 도달 (L923-926)
// ──────────────────────────────────────────────────

describe("run_phase_loop — sequential_loop 최대 반복 도달", () => {
  it("max_loop_iterations 도달 후 DONE 없으면 last result로 완료", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
      // [DONE] 없는 응답 → 최대 반복(2)에 도달
      wait_for_completion: vi.fn()
        .mockResolvedValueOnce({ status: "completed", content: "first iteration result" })
        .mockResolvedValueOnce({ status: "completed", content: "second iteration result" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const result = await run_phase_loop(single_phase_opts({
      phases: [{
        phase_id: "p1",
        title: "Loop Phase",
        mode: "sequential_loop",
        max_loop_iterations: 2,
        agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "openrouter", system_prompt: "s" }],
      }],
    }), { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    expect(subagents.spawn).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────────
// Resume: agent 일부만 completed → 나머지만 재실행 (L616-618)
// ──────────────────────────────────────────────────

describe("run_phase_loop — resume 에이전트 일부 completed", () => {
  it("a1 completed, a2 pending → a2만 spawn, a1은 스킵", async () => {
    const store = make_store();
    const subagents = {
      spawn: vi.fn().mockResolvedValue({ subagent_id: "sa2" }),
      wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "a2 result" }),
      stop: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    const resume_state: any = {
      workflow_id: "wf-partial",
      title: "Partial Resume WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      status: "running",
      current_phase: 0,
      memory: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      orche_states: [],
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        status: "running",
        agents: [
          { agent_id: "a1", role: "analyst", label: "A1", model: "", status: "completed", result: "a1 done", messages: [] },
          { agent_id: "a2", role: "analyst", label: "A2", model: "", status: "pending", messages: [] },
        ],
      }],
      definition: {
        title: "Partial Resume WF",
        objective: "obj",
        phases: [{
          phase_id: "p1",
          title: "Phase 1",
          agents: [
            { agent_id: "a1", role: "analyst", label: "A1", backend: "openrouter", system_prompt: "s" },
            { agent_id: "a2", role: "analyst", label: "A2", backend: "openrouter", system_prompt: "s" },
          ],
        }],
      },
    };

    const result = await run_phase_loop({
      workflow_id: "wf-partial",
      title: "Partial Resume WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp",
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [
          { agent_id: "a1", role: "analyst", label: "A1", backend: "openrouter", system_prompt: "s" },
          { agent_id: "a2", role: "analyst", label: "A2", backend: "openrouter", system_prompt: "s" },
        ],
      }],
      resume_state,
    }, { subagents: subagents as any, store: store as any, logger: noop_logger });

    expect(result.status).toBe("completed");
    // a1은 스킵되고 a2만 spawn
    expect(subagents.spawn).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────
// sub_workflow with load_template (L217-219, L234)
// ──────────────────────────────────────────────────

describe("run_phase_loop — sub_workflow load_template", () => {
  it("load_template 제공 시 sub_workflow 노드 → 재귀 실행 후 결과 반환", async () => {
    const store = make_store();
    const subagents = make_subagents();

    const result = await run_phase_loop({
      workflow_id: "wf-parent",
      title: "Parent WF",
      objective: "obj",
      channel: "slack",
      chat_id: "C1",
      workspace: "/tmp",
      phases: [],
      nodes: [{
        node_id: "sub1",
        node_type: "sub_workflow" as any,
        title: "Sub Workflow",
        workflow_name: "child_template",
      } as any],
    }, {
      subagents: subagents as any,
      store: store as any,
      logger: noop_logger,
      load_template: (name) => {
        if (name === "child_template") {
          return {
            title: "Child WF",
            objective: "child obj",
            phases: [{
              phase_id: "cp1",
              title: "Child Phase",
              agents: [{ agent_id: "ca1", role: "analyst", label: "Child A", backend: "openrouter", system_prompt: "s" }],
            }],
          };
        }
        return null;
      },
    });

    expect(result.status).toBe("completed");
    // sub1 메모리에 sub_workflow 결과가 들어있어야 함
    expect(result.memory["sub1"]).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// cov5 고유 테스트 — 미커버 분기 보충
// ══════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────
// L175-176 — depends_on phase_dep (phase 완료 → resolved)
// ──────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────
// L826 — SEQUENTIAL_LOOP_CONFIG.format_ask_entry
// ──────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────
// L845 — abort_signal already aborted → looping phase break
// ──────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────
// L1041 + L1079 — build_phase_context critic.review + truncate_for_critic
// ──────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────
// L264 — switch default_targets 처리
// ──────────────────────────────────────────────────

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
