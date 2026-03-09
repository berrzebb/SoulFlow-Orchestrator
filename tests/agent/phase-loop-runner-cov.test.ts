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
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { register_all_nodes } from "@src/agent/nodes/index.js";
import { run_phase_loop } from "@src/agent/phase-loop-runner.js";
import type { PhaseLoopRunOptions } from "@src/agent/phase-loop.types.js";

beforeAll(() => {
  register_all_nodes();
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
