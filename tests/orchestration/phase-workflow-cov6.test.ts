/**
 * phase-workflow — 미커버 분기 (cov6):
 * - L208: generate_dynamic_workflow — run_orchestrator content=null → return null
 * - L214: generate_dynamic_workflow — JSON phases 없음/title 없음 → return null
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

function make_req(): OrchestrationRequest {
  return {
    provider: "slack",
    message: {
      id: "m1", provider: "slack", channel: "slack",
      sender_id: "U1", chat_id: "C1",
      content: "test", at: new Date().toISOString(), metadata: {},
    },
    mode: "once",
    run_id: "run-cov6",
  } as OrchestrationRequest;
}

function make_deps(run_orchestrator_result: unknown): PhaseWorkflowDeps {
  return {
    providers: {
      run_orchestrator: vi.fn().mockResolvedValue(run_orchestrator_result),
      get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
    } as never,
    runtime: {} as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    process_tracker: null,
    workspace: "/tmp/test-phase-wf-cov6",
    subagents: { get: vi.fn(), list: vi.fn() } as never,
    phase_workflow_store: { upsert: vi.fn().mockResolvedValue(undefined) } as never,
    bus: null,
    hitl_store: { set: vi.fn(), get: vi.fn(), delete: vi.fn() } as never,
    get_sse_broadcaster: undefined,
    render_hitl: (body: string, type: string) => `[${type}] ${body}`,
    decision_service: null,
    promise_service: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── L208: run_orchestrator content=null → !response → return null ─────────────

describe("generate_dynamic_workflow — L208: content=null → null 반환", () => {
  it("run_orchestrator가 content=null 반환 → L208 return null → no_matching_workflow_template", async () => {
    const deps = make_deps({ content: null });

    const result = await run_phase_loop(deps, make_req(), "unique no-template task xyz123");

    // generate_dynamic_workflow returns null → L70-72: error_result
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("run_orchestrator가 null 반환 → L208 !response → return null", async () => {
    const deps = make_deps(null);

    const result = await run_phase_loop(deps, make_req(), "another unique unmatched task abc456");

    expect(result.error).toContain("no_matching_workflow_template");
  });
});

// ── L214: JSON에 title 없거나 phases 배열 아님 → return null ─────────────────

describe("generate_dynamic_workflow — L214: title/phases 검증 실패 → null 반환", () => {
  it("content에 phases 있으나 title 없음 → L214 !raw.title → return null", async () => {
    // json_match 성공 (phases 키워드 포함), but title 없음 → L214 fires
    const deps = make_deps({ content: '{"phases": [{"phase_id": "p1"}]}' });

    const result = await run_phase_loop(deps, make_req(), "unmatched task no title zyx789");

    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("content에 title 있으나 phases가 배열 아님 → L214 !Array.isArray(raw.phases) → return null", async () => {
    // phases가 객체 (배열이 아님) → L214 fires
    const deps = make_deps({ content: '{"title": "테스트", "phases": {"key": "val"}}' });

    const result = await run_phase_loop(deps, make_req(), "yet another unmatched task 999");

    expect(result.error).toContain("no_matching_workflow_template");
  });
});
