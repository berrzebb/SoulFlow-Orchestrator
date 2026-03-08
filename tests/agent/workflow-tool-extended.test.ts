/**
 * WorkflowTool — 미커버 경로 보충.
 * handle_models (provider_ops 있음/없음), node_types with categories,
 * create/update save 에러, export 템플릿 없음, run inline 에러.
 */
import { describe, it, expect, vi } from "vitest";
import { WorkflowTool } from "../../src/agent/tools/workflow.js";
import type { DashboardWorkflowOps, DashboardAgentProviderOps } from "../../src/dashboard/service.js";
import type { WorkflowDefinition } from "../../src/agent/phase-loop.types.js";

const SAMPLE_DEF: WorkflowDefinition = {
  title: "Test Workflow",
  objective: "test objective",
  phases: [
    {
      phase_id: "phase-1",
      title: "Phase 1",
      agents: [{ agent_id: "a1", role: "dev", label: "Dev", backend: "openrouter", system_prompt: "Do work" }],
    },
  ],
};

function make_ops(overrides: Partial<DashboardWorkflowOps> = {}): DashboardWorkflowOps {
  const templates = new Map<string, WorkflowDefinition>();
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ ok: true, workflow_id: "wf-1" })),
    cancel: vi.fn(async () => true),
    get_messages: vi.fn(async () => []),
    send_message: vi.fn(async () => ({ ok: true })),
    list_templates: vi.fn(() => [...templates.values()]),
    get_template: vi.fn((n: string) => templates.get(n) ?? null),
    save_template: vi.fn((n: string, d: WorkflowDefinition) => { templates.set(n, d); return n; }),
    delete_template: vi.fn((n: string) => templates.delete(n)),
    import_template: vi.fn(() => ({ ok: true, name: "imported" })),
    export_template: vi.fn((n: string) => templates.has(n) ? "yaml" : null),
    list_roles: vi.fn(() => []),
    resume: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function make_provider_ops(overrides: Partial<DashboardAgentProviderOps> = {}): DashboardAgentProviderOps {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ ok: true, instance_id: "p1" })),
    update: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => true),
    get_connection: vi.fn(async () => null),
    list_models: vi.fn(async () => []),
    test_connection: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

type RunFn = (p: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<string>;
function get_run(tool: WorkflowTool): RunFn {
  return (tool as unknown as { run: RunFn }).run.bind(tool);
}

// ══════════════════════════════════════════
// handle_models
// ══════════════════════════════════════════

describe("WorkflowTool — handle_models", () => {
  it("provider_ops 없음 → error 반환", async () => {
    const run = get_run(new WorkflowTool(make_ops()));
    const result = await run({ action: "models" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("unavailable");
    expect(parsed.backends).toEqual([]);
  });

  it("provider_ops 있음 + 빈 목록 → backends=[]", async () => {
    const provider_ops = make_provider_ops({ list: vi.fn(async () => []) });
    const run = get_run(new WorkflowTool(make_ops(), provider_ops));
    const result = await run({ action: "models" });
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed.backends)).toBe(true);
    expect(parsed.backends.length).toBe(0);
  });

  it("enabled 프로바이더 → backends에 포함", async () => {
    const provider_ops = make_provider_ops({
      list: vi.fn(async () => [
        { instance_id: "p1", label: "Provider1", provider_type: "openai", enabled: true, available: true, settings: {}, connection_id: null },
        { instance_id: "p2", label: "Provider2", provider_type: "claude", enabled: false, available: false, settings: {}, connection_id: null },
      ]),
      list_models: vi.fn(async () => [{ id: "gpt-4o", name: "GPT-4o", purpose: "chat" }]),
    });
    const run = get_run(new WorkflowTool(make_ops(), provider_ops));
    const result = await run({ action: "models" });
    const parsed = JSON.parse(result);
    // enabled=true인 p1만 포함
    expect(parsed.backends.length).toBe(1);
    expect(parsed.backends[0].backend).toBe("p1");
    expect(parsed.backends[0].models.length).toBe(1);
  });

  it("connection_id 있음 → get_connection 호출 (api_base 오버라이드)", async () => {
    const get_connection = vi.fn(async () => ({ api_base: "https://custom.api" }));
    const list_models = vi.fn(async () => []);
    const provider_ops = make_provider_ops({
      list: vi.fn(async () => [
        { instance_id: "p3", label: "P3", provider_type: "openai", enabled: true, available: true, settings: { api_base: "https://default.api" }, connection_id: "conn-1" },
      ]),
      get_connection,
      list_models,
    });
    const run = get_run(new WorkflowTool(make_ops(), provider_ops));
    await run({ action: "models" });
    expect(get_connection).toHaveBeenCalledWith("conn-1");
    expect(list_models).toHaveBeenCalledWith("openai", expect.objectContaining({ api_base: "https://custom.api" }));
  });

  it("list_models 실패 → 모델 목록 빈 배열 (에러 무시)", async () => {
    const provider_ops = make_provider_ops({
      list: vi.fn(async () => [
        { instance_id: "p4", label: "P4", provider_type: "openai", enabled: true, available: true, settings: {}, connection_id: null },
      ]),
      list_models: vi.fn(async () => { throw new Error("API error"); }),
    });
    const run = get_run(new WorkflowTool(make_ops(), provider_ops));
    const result = await run({ action: "models" });
    const parsed = JSON.parse(result);
    expect(parsed.backends[0].models).toEqual([]);
  });
});

// ══════════════════════════════════════════
// node_types with categories
// ══════════════════════════════════════════

describe("WorkflowTool — node_types with categories", () => {
  it("node_categories 지정 → 카탈로그 반환", async () => {
    const run = get_run(new WorkflowTool(make_ops()));
    const result = await run({ action: "node_types", node_categories: ["flow", "data"] });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("빈 node_categories → 캐시된 전체 카탈로그 반환", async () => {
    const run = get_run(new WorkflowTool(make_ops()));
    const r1 = await run({ action: "node_types", node_categories: [] });
    const r2 = await run({ action: "node_types" });
    // 둘 다 전체 카탈로그 반환 (캐시 사용)
    expect(r1).toBe(r2);
  });
});

// ══════════════════════════════════════════
// create/update 에러 경로
// ══════════════════════════════════════════

describe("WorkflowTool — save 에러 경로", () => {
  it("create: save_template 예외 → Error 반환", async () => {
    const ops = make_ops({ save_template: vi.fn(() => { throw new Error("disk full"); }) });
    const run = get_run(new WorkflowTool(ops));
    const result = await run({ action: "create", name: "test", definition: SAMPLE_DEF });
    expect(result).toContain("Error");
    expect(result).toContain("disk full");
  });

  it("update: save_template 예외 → Error 반환", async () => {
    const ops = make_ops({
      get_template: vi.fn(() => SAMPLE_DEF),
      save_template: vi.fn(() => { throw new Error("write error"); }),
    });
    const run = get_run(new WorkflowTool(ops));
    const result = await run({ action: "update", name: "test", definition: SAMPLE_DEF });
    expect(result).toContain("Error");
    expect(result).toContain("write error");
  });
});

// ══════════════════════════════════════════
// export 에러 경로
// ══════════════════════════════════════════

describe("WorkflowTool — export 에러 경로", () => {
  it("export: 템플릿 없음 → Error 반환", async () => {
    const ops = make_ops({ export_template: vi.fn(() => null) });
    const run = get_run(new WorkflowTool(ops));
    const result = await run({ action: "export", name: "nonexistent" });
    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  it("export: name 없음 → Error 반환", async () => {
    const run = get_run(new WorkflowTool(make_ops()));
    const result = await run({ action: "export" });
    expect(result).toContain("Error");
    expect(result).toContain("name is required");
  });
});

// ══════════════════════════════════════════
// run inline — 에러 경로
// ══════════════════════════════════════════

describe("WorkflowTool — run inline 에러 경로", () => {
  it("run: name 없음 + definition 없음 → Error 반환", async () => {
    const run = get_run(new WorkflowTool(make_ops()));
    const result = await run({ action: "run" });
    expect(result).toContain("Error");
    expect(result).toContain("name or definition is required");
  });

  it("run: variables 있으면 create에 전달", async () => {
    const ops = make_ops({ get_template: vi.fn(() => SAMPLE_DEF) });
    const run = get_run(new WorkflowTool(ops));
    const vars = { env: "prod" };
    await run({ action: "run", name: "test", variables: vars });
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({ variables: vars }));
  });
});
