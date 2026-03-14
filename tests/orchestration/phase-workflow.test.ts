/**
 * phase-workflow — 통합 테스트 (no mock).
 * - re-export 검증
 * - 의존성 검증 (workspace, subagents, store)
 * - 템플릿 미매칭 + LLM 동적 생성 분기
 */
import { describe, it, expect, vi } from "vitest";
import { run_phase_loop } from "@src/orchestration/execution/phase-workflow.js";
import { run_phase_loop as run_phase_loop_reexport } from "@src/orchestration/execution/index.js";
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
    render_hitl: (body: string, type: string) => `[${type}] ${body}`,
    decision_service: null,
    promise_service: null,
    ...overrides,
  };
}

// ── re-export 검증 ──────────────────────────────────────────────────

describe("phase-workflow — re-export 검증", () => {
  it("execution/index.js에서 run_phase_loop re-export", () => {
    expect(run_phase_loop_reexport).toBe(run_phase_loop);
  });
});

// ── 의존성 검증 ─────────────────────────────────────────────────────

describe("run_phase_loop — 의존성 검증", () => {
  it("workspace 빈 문자열 → Error: workspace is required", async () => {
    const deps = make_deps({ workspace: "" });
    await expect(run_phase_loop(deps, make_req(), "task")).rejects.toThrow("workspace is required");
  });

  it("subagents=null → phase_loop_deps_not_configured", async () => {
    const deps = make_deps({ subagents: null });
    const result = await run_phase_loop(deps, make_req(), "task");
    expect(result.mode).toBe("phase");
    expect(result.error).toContain("phase_loop_deps_not_configured");
  });

  it("phase_workflow_store=null → phase_loop_deps_not_configured", async () => {
    const deps = make_deps({ phase_workflow_store: null });
    const result = await run_phase_loop(deps, make_req(), "task");
    expect(result.mode).toBe("phase");
    expect(result.error).toContain("phase_loop_deps_not_configured");
  });
});

// ── 템플릿 미매칭 + LLM 동적 생성 분기 ─────────────────────────────

describe("run_phase_loop — 템플릿 미매칭 + LLM 동적 생성 분기", () => {
  it("매칭 없고 LLM content=null → no_matching_workflow_template", async () => {
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: null }),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
    });
    const result = await run_phase_loop(deps, make_req(), "completely unique task xyz 123");
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("LLM이 null 반환 → no_matching_workflow_template", async () => {
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue(null),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
    });
    const result = await run_phase_loop(deps, make_req(), "another unique task abc 456");
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("JSON 없는 응답 → no_matching_workflow_template", async () => {
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: "Sorry, I cannot help." }),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
    });
    const result = await run_phase_loop(deps, make_req(), "unique unmatched task 789");
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("잘못된 JSON (phases=null) → no_matching_workflow_template", async () => {
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: '{"title":"Test","phases":null}' }),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
    });
    const result = await run_phase_loop(deps, make_req(), "malformed json task xyz123");
    expect(result.error).toContain("no_matching_workflow_template");
  });

  it("유효한 workflow JSON → preview 반환", async () => {
    const workflow_json = JSON.stringify({
      title: "테스트 워크플로우",
      objective: "테스트 목표",
      phases: [{
        phase_id: "p1", title: "Phase 1",
        agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "Analyze the task." }],
        critic: { backend: "openrouter", system_prompt: "Review", gate: true },
      }],
    });
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: workflow_json }),
        get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
      phase_workflow_store: { upsert: vi.fn().mockResolvedValue(undefined) } as never,
    });
    const result = await run_phase_loop(deps, make_req(), "unique task for dynamic workflow");
    expect(result.mode).toBe("phase");
    expect(result.reply).toContain("다음 워크플로우를 생성했습니다");
    expect(result.reply).toContain("Phase 1");
  });

  it("SO-6b — code-fence 응답 → normalize_json_text 바인딩으로 정상 파싱 → preview 반환", async () => {
    const inner = JSON.stringify({
      title: "Fence Workflow",
      objective: "fence test",
      phases: [{
        phase_id: "p1", title: "Fenced Phase",
        agents: [{ agent_id: "a1", role: "analyst", label: "Analyst", backend: "openrouter", system_prompt: "Analyze." }],
        critic: { backend: "openrouter", system_prompt: "Review", gate: true },
      }],
    });
    const fenced_response = `\`\`\`json\n${inner}\n\`\`\``;
    const deps = make_deps({
      workspace: "/nonexistent-workspace-xyz",
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: fenced_response }),
        get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
        get_secret_vault: vi.fn().mockReturnValue({ mask_known_secrets: vi.fn().mockResolvedValue("") }),
      } as never,
      phase_workflow_store: { upsert: vi.fn().mockResolvedValue(undefined) } as never,
    });
    const result = await run_phase_loop(deps, make_req(), "unique code fence workflow task abc");
    expect(result.mode).toBe("phase");
    expect(result.reply).toContain("다음 워크플로우를 생성했습니다");
    expect(result.reply).toContain("Fenced Phase");
  });
});
