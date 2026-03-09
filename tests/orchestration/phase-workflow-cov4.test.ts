/**
 * phase-workflow — 미커버 람다 분기 커버리지 (cov4).
 * - exec() 옵션 람다: invoke_tool, on_event, load_template
 * - channel_callbacks: send_message (success/error), ask_channel (timeout/resolve)
 * - format_phase_summary: agent.error 있는 경우, critic review
 * - format_workflow_preview: critic 없는 경우
 * - generate_dynamic_workflow: response=null, json_match 없음, 파싱 오류
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@src/agent/phase-loop-runner.js", () => ({
  run_phase_loop: vi.fn(),
}));

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
    runtime: { execute_tool: vi.fn().mockResolvedValue({ result: "tool ok" }) } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    process_tracker: null,
    workspace: "/tmp/test-phase-wf-cov4",
    subagents: { get: vi.fn(), list: vi.fn() } as never,
    phase_workflow_store: { upsert: vi.fn().mockResolvedValue(undefined) } as never,
    bus: null,
    hitl_store: { set: vi.fn(), get: vi.fn(), delete: vi.fn() } as never,
    get_sse_broadcaster: undefined,
    render_hitl: (body: string, type: string) => `[${type}] ${body}`,
    decision_service: null,
    promise_service: null,
    ...overrides,
  };
}

async function setup_template() {
  const { load_workflow_template, load_workflow_templates } = await import("@src/orchestration/workflow-loader.js");
  const tpl = {
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
  vi.mocked(load_workflow_template).mockReturnValue(tpl as never);
  vi.mocked(load_workflow_templates).mockReturnValue([tpl] as never);
  return tpl;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// exec 옵션 람다: invoke_tool, on_event, load_template
// ══════════════════════════════════════════

describe("run_phase_loop — exec 옵션 람다 직접 호출", () => {
  it("invoke_tool 람다 → runtime.execute_tool 위임", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    await setup_template();
    const execute_tool = vi.fn().mockResolvedValue({ result: "done" });
    const deps = make_deps({ runtime: { execute_tool } as never });
    await run_phase_loop(deps, make_req(), "test");

    const call_opts = vi.mocked(exec_mock).mock.calls[0][0];
    const result = await call_opts.invoke_tool("bash", { cmd: "echo hi" }, { channel: "slack", chat_id: "C1", sender_id: "U1", workflow_id: "wf-1" });
    expect(execute_tool).toHaveBeenCalledWith("bash", { cmd: "echo hi" }, {
      channel: "slack", chat_id: "C1", sender_id: "U1", task_id: "wf-1",
    });
    expect(result).toEqual({ result: "done" });
  });

  it("invoke_tool 람다 ctx=undefined → task_id 없이 호출", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    await setup_template();
    const execute_tool = vi.fn().mockResolvedValue({ result: "done" });
    const deps = make_deps({ runtime: { execute_tool } as never });
    await run_phase_loop(deps, make_req(), "test");

    const call_opts = vi.mocked(exec_mock).mock.calls[0][0];
    await call_opts.invoke_tool("read", { path: "/tmp/foo" }, undefined);
    expect(execute_tool).toHaveBeenCalledWith("read", { path: "/tmp/foo" }, undefined);
  });

  it("on_event 람다 → sse_broadcaster.broadcast_workflow_event + on_agent_event 호출", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    await setup_template();
    const broadcast = vi.fn();
    const on_agent_event = vi.fn();
    const deps = make_deps({
      get_sse_broadcaster: () => ({ broadcast_workflow_event: broadcast }),
    });
    const req = make_req({ on_agent_event });
    await run_phase_loop(deps, req, "test");

    const call_ctx = vi.mocked(exec_mock).mock.calls[0][1];
    call_ctx.on_event({ type: "phase_started", workflow_id: "wf-1", status: "running" } as never);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "phase_started" }));
    expect(on_agent_event).toHaveBeenCalled();
  });

  it("on_event 람다 — get_sse_broadcaster() null → 오류 없음", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    await setup_template();
    const deps = make_deps({ get_sse_broadcaster: () => null });
    await run_phase_loop(deps, make_req(), "test");

    const call_ctx = vi.mocked(exec_mock).mock.calls[0][1];
    expect(() => call_ctx.on_event({ type: "phase_started" } as never)).not.toThrow();
  });

  it("load_template 람다 → load_workflow_template(workspace, name) 위임", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    const { load_workflow_template } = await import("@src/orchestration/workflow-loader.js");
    await setup_template();
    await run_phase_loop(make_deps(), make_req(), "test");

    const call_ctx = vi.mocked(exec_mock).mock.calls[0][1];
    call_ctx.load_template("my-workflow");
    expect(load_workflow_template).toHaveBeenCalledWith("/tmp/test-phase-wf-cov4", "my-workflow");
  });
});

// ══════════════════════════════════════════
// send_message 람다 — bus publish
// ══════════════════════════════════════════

describe("run_phase_loop — send_message 람다", () => {
  it("send_message target=origin → origin_channel/chat_id로 publish", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    await setup_template();
    const publish_outbound = vi.fn().mockResolvedValue(undefined);
    const bus = { publish_outbound } as never;
    const deps = make_deps({ bus });
    await run_phase_loop(deps, make_req(), "test");

    const call_opts = vi.mocked(exec_mock).mock.calls[0][0];
    const result = await call_opts.send_message({ target: "origin", content: "알림 메시지" });
    expect(publish_outbound).toHaveBeenCalledWith(expect.objectContaining({
      provider: "slack", chat_id: "C1", content: "알림 메시지",
    }));
    expect(result.ok).toBe(true);
    expect(result.message_id).toBeDefined();
  });

  it("send_message target 다른 채널 → req.channel/chat_id 사용", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    await setup_template();
    const publish_outbound = vi.fn().mockResolvedValue(undefined);
    const bus = { publish_outbound } as never;
    const deps = make_deps({ bus });
    await run_phase_loop(deps, make_req(), "test");

    const call_opts = vi.mocked(exec_mock).mock.calls[0][0];
    const result = await call_opts.send_message({ target: "custom", channel: "telegram", chat_id: "T1", content: "커스텀" });
    expect(publish_outbound).toHaveBeenCalledWith(expect.objectContaining({
      provider: "telegram", chat_id: "T1",
    }));
    expect(result.ok).toBe(true);
  });

  it("send_message publish 실패 → ok=false 반환", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    await setup_template();
    const publish_outbound = vi.fn().mockRejectedValue(new Error("publish fail"));
    const bus = { publish_outbound } as never;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps = make_deps({ bus, logger: logger as never });
    await run_phase_loop(deps, make_req(), "test");

    const call_opts = vi.mocked(exec_mock).mock.calls[0][0];
    const result = await call_opts.send_message({ target: "origin", content: "msg" });
    expect(result.ok).toBe(false);
    expect(logger.error).toHaveBeenCalledWith("workflow_send_message_failed", expect.any(Object));
  });
});

// ══════════════════════════════════════════
// ask_channel 람다 — timeout / resolve
// ══════════════════════════════════════════

describe("run_phase_loop — ask_channel 람다", () => {
  it("ask_channel: timeout → timed_out=true", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    await setup_template();
    const publish_outbound = vi.fn().mockResolvedValue(undefined);
    const hitl_store = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
    const bus = { publish_outbound } as never;
    const deps = make_deps({ bus, hitl_store: hitl_store as never });
    await run_phase_loop(deps, make_req(), "test");

    const call_opts = vi.mocked(exec_mock).mock.calls[0][0];

    // timeout_ms=10ms → 빠르게 타임아웃
    const response_promise = call_opts.ask_channel({ target: "origin", content: "질문" }, 10);
    const response = await response_promise;

    expect(response.timed_out).toBe(true);
    expect(response.response).toBe("");
    expect(hitl_store.delete).toHaveBeenCalled();
  });

  it("ask_channel: hitl resolve 호출 → timed_out=false, response=내용", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    await setup_template();
    const publish_outbound = vi.fn().mockResolvedValue(undefined);
    let captured_resolve: ((content: string) => void) | null = null;
    const hitl_store = {
      set: vi.fn((id, { resolve }) => { captured_resolve = resolve; }),
      get: vi.fn(),
      delete: vi.fn(),
    };
    const bus = { publish_outbound } as never;
    const deps = make_deps({ bus, hitl_store: hitl_store as never });
    await run_phase_loop(deps, make_req(), "test");

    const call_opts = vi.mocked(exec_mock).mock.calls[0][0];

    const response_promise = call_opts.ask_channel({ target: "origin", content: "질문" }, 5000);
    // hitl.set이 캡처된 resolve 함수를 호출
    expect(captured_resolve).not.toBeNull();
    captured_resolve!("사용자의 대답");

    const response = await response_promise;
    expect(response.timed_out).toBe(false);
    expect(response.response).toBe("사용자의 대답");
  });
});

// ══════════════════════════════════════════
// format_phase_summary — agent.error 있는 경우
// ══════════════════════════════════════════

describe("run_phase_loop — format_phase_summary agent.error", () => {
  it("agent.error 있을 때 → error 텍스트 표시", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({
      status: "completed",
      phases: [{
        phase_id: "p1", title: "실패 단계", status: "failed",
        agents: [
          { agent_id: "a1", label: "Analyst", status: "failed", error: "분석 실패했습니다", result: null },
        ],
      }],
      memory: {},
    } as never);

    await setup_template();
    const result = await run_phase_loop(make_deps(), make_req(), "test");
    expect(result.reply).toContain("분석 실패했습니다");
  });
});

// ══════════════════════════════════════════
// generate_dynamic_workflow: LLM 응답 분기
// ══════════════════════════════════════════

describe("run_phase_loop — generate_dynamic_workflow 분기", () => {
  it("LLM 응답 없음 (null) → no_matching_workflow_template 에러", async () => {
    const { load_workflow_templates, load_workflow_template } = await import("@src/orchestration/workflow-loader.js");
    vi.mocked(load_workflow_template).mockReturnValue(null);
    vi.mocked(load_workflow_templates).mockReturnValue([]);

    const run_orchestrator = vi.fn().mockResolvedValue({ content: null });
    const deps = make_deps({ providers: { run_orchestrator } as never });
    const result = await run_phase_loop(deps, make_req(), "test task");
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("LLM 응답에 'phases' JSON 없음 → no_matching_workflow_template 에러", async () => {
    const { load_workflow_templates, load_workflow_template } = await import("@src/orchestration/workflow-loader.js");
    vi.mocked(load_workflow_template).mockReturnValue(null);
    vi.mocked(load_workflow_templates).mockReturnValue([]);

    const run_orchestrator = vi.fn().mockResolvedValue({ content: "This is not JSON at all." });
    const deps = make_deps({ providers: { run_orchestrator } as never });
    const result = await run_phase_loop(deps, make_req(), "test task");
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("LLM JSON 파싱 성공 → format_workflow_preview + waiting_user_input 반환", async () => {
    const { load_workflow_templates, load_workflow_template } = await import("@src/orchestration/workflow-loader.js");
    vi.mocked(load_workflow_template).mockReturnValue(null);
    vi.mocked(load_workflow_templates).mockReturnValue([]);

    const dynamic_workflow_json = JSON.stringify({
      title: "Dynamic Workflow",
      objective: "test task",
      phases: [{
        phase_id: "p1", title: "분석", agents: [
          { agent_id: "a1", role: "analyst", label: "분석가", backend: "openrouter", system_prompt: "데이터를 분석하세요." },
        ],
        critic: null,
      }],
    });
    const run_orchestrator = vi.fn().mockResolvedValue({ content: dynamic_workflow_json });
    const deps = make_deps({ providers: { run_orchestrator } as never });
    const result = await run_phase_loop(deps, make_req(), "test task");
    // format_workflow_preview 호출 → reply에 "다음 워크플로우를 생성했습니다" 포함
    expect(result.reply).toContain("Phase 1");
    expect(result.mode).toBe("phase");
  });

  it("LLM JSON 파싱 성공 — critic=null → critic_note='' (format_workflow_preview 분기)", async () => {
    const { load_workflow_templates, load_workflow_template } = await import("@src/orchestration/workflow-loader.js");
    vi.mocked(load_workflow_template).mockReturnValue(null);
    vi.mocked(load_workflow_templates).mockReturnValue([]);

    const dynamic = JSON.stringify({
      title: "No Critic Workflow",
      objective: "test",
      phases: [{
        phase_id: "p1", title: "실행",
        agents: [{ agent_id: "a1", role: "coder", label: "코더", backend: "openrouter", system_prompt: "코드 작성." }],
        critic: null, // critic 없음 → critic_note=""
      }],
    });
    const run_orchestrator = vi.fn().mockResolvedValue({ content: dynamic });
    const deps = make_deps({ providers: { run_orchestrator } as never });
    const result = await run_phase_loop(deps, make_req(), "test");
    // critic_note="" 분기 커버: critic 없으면 " + critic" 미포함
    expect(result.reply).toContain("1 agents)");
    expect(result.reply).not.toContain("+ critic");
  });
});
