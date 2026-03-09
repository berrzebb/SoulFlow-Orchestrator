/**
 * phase-workflow — 미커버 분기 추가 커버리지.
 * - workspace 없음 → throw
 * - subagents=null → error_result
 * - store=null → error_result
 * - run_phase_loop 실행 후 completed / waiting_user_input / error 상태
 */
import { describe, it, expect, vi } from "vitest";
import { run_phase_loop } from "@src/orchestration/execution/phase-workflow.js";
import type { PhaseWorkflowDeps } from "@src/orchestration/execution/phase-workflow.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

function make_req(overrides?: Partial<OrchestrationRequest>): OrchestrationRequest {
  return {
    provider: "slack",
    message: {
      id: "m1",
      provider: "slack",
      channel: "slack",
      sender_id: "U1",
      chat_id: "C1",
      content: "test task",
      at: new Date().toISOString(),
      metadata: {},
    },
    mode: "once",
    ...overrides,
  } as OrchestrationRequest;
}

function make_deps(overrides?: Partial<PhaseWorkflowDeps>): PhaseWorkflowDeps {
  return {
    providers: {} as never,
    runtime: { execute_tool: vi.fn() } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    process_tracker: null,
    workspace: "/tmp/workspace",
    subagents: { list: vi.fn(), get: vi.fn() } as never,
    phase_workflow_store: { upsert: vi.fn().mockResolvedValue(undefined) } as never,
    bus: null,
    hitl_store: { set: vi.fn(), get: vi.fn(), delete: vi.fn() } as never,
    get_sse_broadcaster: undefined,
    render_hitl: (body, type) => `[${type}] ${body}`,
    decision_service: null,
    promise_service: null,
    ...overrides,
  };
}

// ══════════════════════════════════════════
// workspace 없음 → throw
// ══════════════════════════════════════════

describe("run_phase_loop — workspace 없음 → throw", () => {
  it("workspace 빈 문자열 → Error: workspace is required", async () => {
    const deps = make_deps({ workspace: "" });
    const req = make_req();
    await expect(run_phase_loop(deps, req, "task")).rejects.toThrow("workspace is required");
  });
});

// ══════════════════════════════════════════
// subagents=null → error_result
// ══════════════════════════════════════════

describe("run_phase_loop — subagents=null → error_result", () => {
  it("subagents 없을 때 error_result 반환", async () => {
    const deps = make_deps({ subagents: null });
    const req = make_req();
    const result = await run_phase_loop(deps, req, "task");
    expect(result.mode).toBe("phase");
    expect(result.error).toContain("phase_loop_deps_not_configured");
  });
});

// ══════════════════════════════════════════
// store=null → error_result
// ══════════════════════════════════════════

describe("run_phase_loop — phase_workflow_store=null → error_result", () => {
  it("store 없을 때 error_result 반환", async () => {
    const deps = make_deps({ phase_workflow_store: null });
    const req = make_req();
    const result = await run_phase_loop(deps, req, "task");
    expect(result.mode).toBe("phase");
    expect(result.error).toContain("phase_loop_deps_not_configured");
  });
});

// ══════════════════════════════════════════
// template not found + generate_dynamic_workflow fails
// → no_matching_workflow_template
// ══════════════════════════════════════════

describe("run_phase_loop — template 없음 + LLM 실패 → error_result", () => {
  it("매칭 템플릿 없고 LLM도 실패 → no_matching_workflow_template", async () => {
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: null }),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
    });
    const req = make_req();
    const result = await run_phase_loop(deps, req, "completely unique task xyz 123");
    expect(result.mode).toBe("phase");
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("매칭 템플릿 없고 LLM이 빈 응답 → no_matching_workflow_template", async () => {
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue(null),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
    });
    const req = make_req();
    const result = await run_phase_loop(deps, req, "another unique task abc 456");
    expect(result.mode).toBe("phase");
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("LLM이 JSON 없는 응답 → no_matching_workflow_template", async () => {
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: "Sorry, I cannot help." }),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
    });
    const req = make_req();
    const result = await run_phase_loop(deps, req, "unique unmatched task 789");
    expect(result.mode).toBe("phase");
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("LLM이 잘못된 JSON → no_matching_workflow_template", async () => {
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: '{"title":"Test","phases":null}' }),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
    });
    const req = make_req();
    const result = await run_phase_loop(deps, req, "malformed json task xyz123");
    expect(result.mode).toBe("phase");
    expect(result.error).toContain("no_matching_workflow_template");
  });
});

// ══════════════════════════════════════════
// LLM이 동적 워크플로우 반환 → preview 반환
// ══════════════════════════════════════════

describe("run_phase_loop — 동적 워크플로우 생성 성공 → preview 반환", () => {
  it("LLM이 유효한 workflow JSON 반환 → preview 텍스트 반환", async () => {
    const workflow_json = JSON.stringify({
      title: "테스트 워크플로우",
      objective: "테스트 목표",
      phases: [
        {
          phase_id: "p1",
          title: "Phase 1",
          agents: [
            {
              agent_id: "a1",
              role: "analyst",
              label: "Analyst",
              backend: "openrouter",
              system_prompt: "Analyze the task carefully and provide structured insights.",
            },
          ],
          critic: { backend: "openrouter", system_prompt: "Review the analysis", gate: true },
        },
      ],
    });

    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: workflow_json }),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
      phase_workflow_store: {
        upsert: vi.fn().mockResolvedValue(undefined),
      } as never,
    });
    const req = make_req();
    const result = await run_phase_loop(deps, req, "unique task for dynamic workflow");
    // 동적 생성 → preview 반환
    expect(result.mode).toBe("phase");
    expect(result.reply).toContain("다음 워크플로우를 생성했습니다");
    expect(result.reply).toContain("Phase 1");
  });
});
