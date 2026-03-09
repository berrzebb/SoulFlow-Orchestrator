/**
 * phase-workflow — 추가 미커버 분기 커버리지 (cov3).
 * - exec() completed → format_phase_summary 호출
 * - exec() waiting_user_input + pending_user_input → render_hitl(question)
 * - exec() waiting_user_input + critic rejected → render_hitl(escalation)
 * - exec() terminal/error 상태 → 로깅 + error 반환
 * - bus 있을 때 build_phase_channel_callbacks → send_message/ask_channel
 * - format_phase_summary: memory key 기반 fallback
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// phase-loop-runner 모킹 (동적 import 대응)
vi.mock("@src/agent/phase-loop-runner.js", () => ({
  run_phase_loop: vi.fn(),
}));

// workflow-loader 모킹
vi.mock("@src/orchestration/workflow-loader.js", () => ({
  load_workflow_templates: vi.fn().mockReturnValue([]),
  load_workflow_template: vi.fn().mockReturnValue(null),
  substitute_variables: vi.fn().mockImplementation((t) => t),
}));

import { run_phase_loop } from "@src/orchestration/execution/phase-workflow.js";
import type { PhaseWorkflowDeps } from "@src/orchestration/execution/phase-workflow.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

function make_req(overrides?: Partial<OrchestrationRequest>): OrchestrationRequest {
  return {
    provider: "slack",
    message: {
      id: "m1", provider: "slack", channel: "slack",
      sender_id: "U1", chat_id: "C1",
      content: "test task", at: new Date().toISOString(), metadata: {},
    },
    mode: "once",
    run_id: "run-1",
    ...overrides,
  } as OrchestrationRequest;
}

function make_deps(overrides?: Partial<PhaseWorkflowDeps>): PhaseWorkflowDeps {
  return {
    providers: {
      run_orchestrator: vi.fn().mockResolvedValue({ content: null }),
    } as never,
    runtime: { execute_tool: vi.fn() } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    process_tracker: null,
    workspace: "/tmp/test-phase-wf",
    subagents: { get: vi.fn(), list: vi.fn() } as never,
    phase_workflow_store: {
      upsert: vi.fn().mockResolvedValue(undefined),
    } as never,
    bus: null,
    hitl_store: { set: vi.fn(), get: vi.fn(), delete: vi.fn() } as never,
    get_sse_broadcaster: undefined,
    render_hitl: (body: string, type: string) => `[${type}] ${body}`,
    decision_service: null,
    promise_service: null,
    ...overrides,
  };
}

// workflow-loader의 load_workflow_template에 적절한 템플릿 반환 설정
async function setup_template_match() {
  const { load_workflow_template, load_workflow_templates } = await import("@src/orchestration/workflow-loader.js");
  const mock_template = {
    title: "Test Workflow",
    objective: "test",
    phases: [{
      phase_id: "p1",
      title: "Phase 1",
      agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "analyze" }],
      critic: { backend: "openrouter", system_prompt: "review", gate: true },
    }],
    variables: {},
  };
  vi.mocked(load_workflow_template).mockReturnValue(mock_template as never);
  vi.mocked(load_workflow_templates).mockReturnValue([mock_template] as never);
  return mock_template;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// completed 상태 → format_phase_summary 호출
// ══════════════════════════════════════════

describe("run_phase_loop — exec() completed", () => {
  it("exec → completed + phases → 완료 메시지 반환", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({
      status: "completed",
      phases: [
        {
          phase_id: "p1", title: "분석 단계", status: "completed",
          agents: [
            { agent_id: "a1", label: "Analyst", status: "completed", result: "분석 완료" },
          ],
          critic: { backend: "openrouter", system_prompt: "review", gate: true, approved: true, review: "잘 됨" },
        },
      ],
      memory: {},
    } as never);

    await setup_template_match();
    const deps = make_deps();
    const result = await run_phase_loop(deps, make_req(), "test task");
    expect(result.mode).toBe("phase");
    expect(result.reply).toContain("완료");
  });

  it("exec → completed + 빈 phases + memory key → memory key 기반 fallback 출력", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({
      status: "completed",
      phases: [],
      memory: {
        origin: { channel: "slack", chat_id: "C1", sender_id: "U1" },
        final_result: "워크플로우 최종 결과입니다.",
      },
    } as never);

    await setup_template_match();
    const deps = make_deps();
    const result = await run_phase_loop(deps, make_req(), "test task");
    expect(result.mode).toBe("phase");
    expect(result.reply).toContain("워크플로우 최종 결과입니다.");
  });
});

// ══════════════════════════════════════════
// waiting_user_input + pending_user_input → render_hitl(question)
// ══════════════════════════════════════════

describe("run_phase_loop — exec() waiting_user_input", () => {
  it("pending_user_input 있음 → render_hitl('question') 호출", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({
      status: "waiting_user_input",
      phases: [
        {
          phase_id: "p1", title: "확인 필요", status: "waiting_user_input",
          pending_user_input: true,
          agents: [
            { agent_id: "a1", label: "Analyst", status: "completed", result: "사용자 확인이 필요합니다." },
          ],
        },
      ],
      memory: {},
    } as never);

    await setup_template_match();
    const deps = make_deps();
    const result = await run_phase_loop(deps, make_req(), "test task");
    expect(result.mode).toBe("phase");
    expect(result.reply).toContain("[question]");
  });

  it("critic rejected → render_hitl('escalation') 호출", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({
      status: "waiting_user_input",
      phases: [
        {
          phase_id: "p1", title: "검토 실패", status: "waiting_user_input",
          pending_user_input: false,
          agents: [
            { agent_id: "a1", label: "Analyst", status: "completed", result: "결과물" },
          ],
          critic: { backend: "openrouter", system_prompt: "review", gate: true, approved: false, review: "품질이 부족합니다." },
        },
      ],
      memory: {},
    } as never);

    await setup_template_match();
    const deps = make_deps();
    const result = await run_phase_loop(deps, make_req(), "test task");
    expect(result.mode).toBe("phase");
    expect(result.reply).toContain("[escalation]");
  });
});

// ══════════════════════════════════════════
// terminal 상태 → 에러 로깅 + error 반환
// ══════════════════════════════════════════

describe("run_phase_loop — exec() terminal/error 상태", () => {
  it("exec → status='aborted' → logger.warn + error 반환", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({
      status: "aborted",
      phases: [],
      memory: {},
      error: "user_cancelled",
    } as never);

    await setup_template_match();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps = make_deps({ logger: logger as never });
    const result = await run_phase_loop(deps, make_req(), "test task");
    expect(result.mode).toBe("phase");
    expect(result.error).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith("phase_loop_terminal", expect.any(Object));
  });
});

// ══════════════════════════════════════════
// bus 있을 때 channel_callbacks 빌드 + on_progress 호출
// ══════════════════════════════════════════

describe("run_phase_loop — bus 있음 → channel_callbacks 포함", () => {
  it("bus 있음 → exec 호출 시 on_phase_change 콜백 포함", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({
      status: "completed",
      phases: [],
      memory: {},
    } as never);

    await setup_template_match();
    const bus = { publish_outbound: vi.fn().mockResolvedValue(undefined) } as never;
    const on_progress = vi.fn();
    const deps = make_deps({ bus });
    const req = make_req({ on_progress });
    await run_phase_loop(deps, req, "test task");
    // exec()가 on_phase_change를 호출 → on_progress 실행
    // exec_mock의 실제 호출 인자를 확인
    expect(exec_mock).toHaveBeenCalled();
    const call_opts = vi.mocked(exec_mock).mock.calls[0][0];
    expect(typeof call_opts.on_phase_change).toBe("function");
    // on_phase_change 직접 호출하여 on_progress 검증
    call_opts.on_phase_change({ current_phase: 0, phases: [{}] });
    expect(on_progress).toHaveBeenCalled();
  });

  it("process_tracker.link_workflow 있을 때 → run_id+workflow_id 연결", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({
      status: "completed",
      phases: [],
      memory: {},
    } as never);

    await setup_template_match();
    const process_tracker = { link_workflow: vi.fn(), list_active: vi.fn() } as never;
    const deps = make_deps({ process_tracker });
    await run_phase_loop(deps, make_req({ run_id: "run-1" }), "test task");
    expect((process_tracker as any).link_workflow).toHaveBeenCalledWith("run-1", expect.any(String));
  });
});
