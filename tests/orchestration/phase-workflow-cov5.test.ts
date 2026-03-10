/**
 * phase-workflow — 미커버 람다 분기 보충 (cov5).
 * L83: store.upsert reject → logger.error("workflow_upsert_failed")
 * L275: bus.publish_outbound reject → logger.error("workflow_ask_channel_send_failed")
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

function make_base_deps(overrides?: Partial<PhaseWorkflowDeps>): PhaseWorkflowDeps {
  return {
    providers: {
      run_orchestrator: vi.fn().mockResolvedValue({ content: null }),
    } as never,
    runtime: { execute_tool: vi.fn().mockResolvedValue({ result: "ok" }) } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    process_tracker: null,
    workspace: "/tmp/test-phase-wf-cov5",
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

const DYNAMIC_WF = JSON.stringify({
  title: "동적 워크플로우",
  objective: "test",
  phases: [{
    phase_id: "p1", title: "분석",
    agents: [{ agent_id: "a1", role: "analyst", label: "분석가", backend: "openrouter", system_prompt: "분석" }],
  }],
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// L83: store.upsert reject → workflow_upsert_failed 로깅
// ══════════════════════════════════════════

describe("run_phase_loop — store.upsert reject (L83)", () => {
  it("dynamic workflow에서 upsert 실패 → logger.error 호출됨 (L83)", async () => {
    const { load_workflow_templates, load_workflow_template } = await import("@src/orchestration/workflow-loader.js");
    vi.mocked(load_workflow_template).mockReturnValue(null);
    vi.mocked(load_workflow_templates).mockReturnValue([]);

    // store.upsert가 rejected Promise 반환 → L83 catch 실행
    const upsert = vi.fn().mockRejectedValue(new Error("db write failure"));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const run_orchestrator = vi.fn().mockResolvedValue({ content: DYNAMIC_WF });

    const deps = make_base_deps({
      providers: { run_orchestrator, get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter") } as never,
      phase_workflow_store: { upsert } as never,
      logger: logger as never,
    });

    const result = await run_phase_loop(deps, make_req(), "test task");
    // 동적 워크플로우 미리보기 반환 (upsert 실패는 catch로 처리)
    expect(result.mode).toBe("phase");
    // 비동기 catch이므로 잠시 대기
    await new Promise((r) => setTimeout(r, 20));
    expect(logger.error).toHaveBeenCalledWith(
      "workflow_upsert_failed",
      expect.objectContaining({ error: "db write failure" }),
    );
  });
});

// ══════════════════════════════════════════
// L275: ask_channel publish_outbound reject → workflow_ask_channel_send_failed
// ══════════════════════════════════════════

describe("run_phase_loop — ask_channel publish_outbound reject (L275)", () => {
  it("publish_outbound 실패 → logger.error 호출 후 hitl 대기 계속됨 (L275)", async () => {
    const { run_phase_loop: exec_mock } = await import("@src/agent/phase-loop-runner.js");
    vi.mocked(exec_mock).mockResolvedValue({ status: "completed", phases: [], memory: {} } as never);

    const { load_workflow_template, load_workflow_templates } = await import("@src/orchestration/workflow-loader.js");
    const tpl = {
      title: "Test WF", objective: "test",
      phases: [{ phase_id: "p1", title: "P1", agents: [{ agent_id: "a1", role: "r", label: "L", backend: "openrouter", system_prompt: "s" }] }],
    };
    vi.mocked(load_workflow_template).mockReturnValue(tpl as never);
    vi.mocked(load_workflow_templates).mockReturnValue([tpl] as never);

    // publish_outbound가 reject → L275 catch 실행
    const publish_outbound = vi.fn().mockRejectedValue(new Error("network error"));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const hitl_store = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
    const bus = { publish_outbound } as never;

    const deps = make_base_deps({ bus, logger: logger as never, hitl_store: hitl_store as never });
    await run_phase_loop(deps, make_req(), "test");

    const call_opts = vi.mocked(exec_mock).mock.calls[0][0];

    // ask_channel 호출 후 publish_outbound reject → L275 catch
    const ask_promise = call_opts.ask_channel({ target: "origin", content: "질문" }, 30);

    // 비동기 catch가 실행될 시간 부여
    await new Promise((r) => setTimeout(r, 20));
    expect(logger.error).toHaveBeenCalledWith(
      "workflow_ask_channel_send_failed",
      expect.objectContaining({ error: "network error" }),
    );

    // hitl_store.set에서 resolve 추출 후 호출 → promise 완료
    const set_call = hitl_store.set.mock.calls[0];
    if (set_call) {
      set_call[1].resolve("답변");
    }
    const response = await ask_promise;
    expect(typeof response.timed_out).toBe("boolean");
  });
});
