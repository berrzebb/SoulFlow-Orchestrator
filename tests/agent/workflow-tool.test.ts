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
      agents: [{ agent_id: "agent-1", role: "dev", label: "Dev", backend: "openrouter", system_prompt: "Do work" }],
    },
  ],
  orche_nodes: [
    { node_id: "http-1", node_type: "http", title: "Fetch Data", url: "https://example.com", method: "GET" },
  ],
};

function make_mock_ops(overrides: Partial<DashboardWorkflowOps> = {}): DashboardWorkflowOps {
  const templates = new Map<string, WorkflowDefinition>();
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    create: vi.fn(async (input) => ({ ok: true, workflow_id: "wf-123" })),
    cancel: vi.fn(async () => true),
    get_messages: vi.fn(async () => []),
    send_message: vi.fn(async () => ({ ok: true })),
    list_templates: vi.fn(() => [...templates.values()]),
    get_template: vi.fn((name: string) => templates.get(name) || null),
    save_template: vi.fn((name: string, def: WorkflowDefinition) => {
      templates.set(name, def);
      return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }),
    delete_template: vi.fn((name: string) => templates.delete(name) || false),
    import_template: vi.fn(() => ({ ok: true, name: "imported" })),
    export_template: vi.fn((name: string) => templates.has(name) ? "title: test" : null),
    list_roles: vi.fn(() => []),
    resume: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

type RunFn = (p: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<string>;
function get_run(tool: WorkflowTool): RunFn {
  return (tool as unknown as { run: RunFn }).run.bind(tool);
}

describe("WorkflowTool", () => {
  // ── create ──

  it("create: definition을 normalize한 뒤 저장하고 slug를 반환한다", async () => {
    const ops = make_mock_ops();
    const run = get_run(new WorkflowTool(ops));

    const result = await run({ action: "create", name: "My Flow", definition: SAMPLE_DEF });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.slug).toBe("my-flow");
    expect(parsed.action).toBe("created");
    expect(ops.save_template).toHaveBeenCalledWith("My Flow", expect.objectContaining({ title: "Test Workflow" }));
  });

  it("create: name 없으면 에러 메시지를 반환한다", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "create", definition: SAMPLE_DEF });
    expect(result).toContain("Error");
    expect(result).toContain("name is required");
  });

  it("create: definition 없으면 에러 메시지를 반환한다", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "create", name: "test" });
    expect(result).toContain("Error");
    expect(result).toContain("definition");
  });

  it("create: 잘못된 definition(phases 없음)은 검증 에러를 반환한다", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "create", name: "test", definition: { title: "No Phases" } });
    expect(result).toContain("Error");
    expect(result).toContain("invalid definition");
  });

  // ── update ──

  it("update: 기존 템플릿을 덮어쓴다", async () => {
    const ops = make_mock_ops({
      get_template: vi.fn(() => SAMPLE_DEF),
    });
    const run = get_run(new WorkflowTool(ops));

    const updated_def = { ...SAMPLE_DEF, objective: "updated objective" };
    const result = await run({ action: "update", name: "my-flow", definition: updated_def });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("updated");
    expect(ops.save_template).toHaveBeenCalled();
  });

  it("update: 존재하지 않는 템플릿은 에러를 반환한다", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "update", name: "nonexistent", definition: SAMPLE_DEF });
    expect(result).toContain("Error");
    expect(result).toContain("not found");
    expect(result).toContain("create");
  });

  // ── list ──

  it("list: 템플릿 목록을 요약하여 반환한다", async () => {
    const ops = make_mock_ops({
      list_templates: vi.fn(() => [
        { ...SAMPLE_DEF, title: "Daily RSS" },
        { ...SAMPLE_DEF, title: "Weekly Report", trigger_nodes: [{ id: "__cron__", trigger_type: "cron", schedule: "0 0 * * 1" }] },
      ]),
    });
    const run = get_run(new WorkflowTool(ops));

    const result = await run({ action: "list" });
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>;

    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("Daily RSS");
    expect(parsed[0].slug).toBe("daily-rss");
    expect(parsed[1].trigger_nodes).toEqual([{ id: "__cron__", trigger_type: "cron", schedule: "0 0 * * 1" }]);
  });

  // ── get ──

  it("get: 존재하는 템플릿을 반환한다", async () => {
    const ops = make_mock_ops({ get_template: vi.fn(() => SAMPLE_DEF) });
    const run = get_run(new WorkflowTool(ops));

    const result = await run({ action: "get", name: "daily-rss" });
    const parsed = JSON.parse(result);

    expect(parsed.title).toBe("Test Workflow");
    expect(parsed.orche_nodes).toHaveLength(1);
  });

  it("get: 존재하지 않는 템플릿은 에러를 반환한다", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "get", name: "nonexistent" });
    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  // ── run ──

  it("run: 이름으로 워크플로우를 실행하고 workflow_id를 반환한다", async () => {
    const ops = make_mock_ops({ get_template: vi.fn(() => SAMPLE_DEF) });
    const run = get_run(new WorkflowTool(ops));

    const result = await run({ action: "run", name: "daily-rss" }, { channel: "slack", chat_id: "C123" });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.workflow_id).toBe("wf-123");
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({
      template_name: "daily-rss",
      title: "Test Workflow",
      channel: "slack",
      chat_id: "C123",
    }));
  });

  it("run: 존재하지 않는 템플릿은 에러를 반환한다", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "run", name: "nonexistent" });
    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  it("run: context 없으면 기본 channel/chat_id를 사용한다", async () => {
    const ops = make_mock_ops({ get_template: vi.fn(() => SAMPLE_DEF) });
    const run = get_run(new WorkflowTool(ops));

    await run({ action: "run", name: "test" });
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({
      channel: "dashboard",
      chat_id: "web",
    }));
  });

  it("run: inline definition으로 직접 실행할 수 있다", async () => {
    const ops = make_mock_ops();
    const run = get_run(new WorkflowTool(ops));

    const result = await run({ action: "run", definition: SAMPLE_DEF });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({
      title: "Test Workflow",
      objective: "test objective",
      phases: SAMPLE_DEF.phases,
      orche_nodes: SAMPLE_DEF.orche_nodes,
    }));
  });

  it("run: inline definition에 field_mappings가 포함되면 전달한다", async () => {
    const ops = make_mock_ops();
    const run = get_run(new WorkflowTool(ops));
    const mappings = [{ from_node: "a", from_field: "out", to_node: "b", to_field: "in" }];

    await run({ action: "run", definition: { ...SAMPLE_DEF, field_mappings: mappings } });
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({ field_mappings: mappings }));
  });

  // ── delete ──

  it("delete: 템플릿을 삭제한다", async () => {
    const ops = make_mock_ops({ delete_template: vi.fn(() => true) });
    const run = get_run(new WorkflowTool(ops));

    const result = await run({ action: "delete", name: "old-flow" });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(ops.delete_template).toHaveBeenCalledWith("old-flow");
  });

  // ── export ──

  it("export: YAML 문자열을 반환한다", async () => {
    const ops = make_mock_ops({ export_template: vi.fn(() => "title: My Flow\nobjective: test") });
    const run = get_run(new WorkflowTool(ops));

    const result = await run({ action: "export", name: "my-flow" });
    expect(result).toContain("title: My Flow");
    expect(result).not.toContain("Error");
  });

  // ── node_types ──

  it("node_types: 노드 카탈로그를 반환한다", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "node_types" });

    expect(result).toContain("Available Workflow Node Types");
  });

  it("node_types: 반복 호출 시 캐시를 사용한다", async () => {
    const tool = new WorkflowTool(make_mock_ops());
    const run = get_run(tool);

    const first = await run({ action: "node_types" });
    const second = await run({ action: "node_types" });
    expect(first).toBe(second);
  });

  // ── description ──

  it("description에 카탈로그가 포함되지 않는다 (node_types action으로 분리)", () => {
    const tool = new WorkflowTool(make_mock_ops());
    expect(tool.description).not.toContain("Available Workflow Node Types");
    expect(tool.description).toContain("node_types");
  });

  // ── unsupported action ──

  it("지원하지 않는 action은 에러를 반환한다", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "invalid_action" });
    expect(result).toContain("unsupported action");
  });
});

// ══════════════════════════════════════════
// Extended: handle_models, node_types categories, save/export/run errors
// ══════════════════════════════════════════

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

describe("WorkflowTool — handle_models", () => {
  it("provider_ops 없음 → error 반환", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "models" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("unavailable");
    expect(parsed.backends).toEqual([]);
  });

  it("provider_ops 있음 + 빈 목록 → backends=[]", async () => {
    const provider_ops = make_provider_ops({ list: vi.fn(async () => []) });
    const run = get_run(new WorkflowTool(make_mock_ops(), provider_ops));
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
    const run = get_run(new WorkflowTool(make_mock_ops(), provider_ops));
    const result = await run({ action: "models" });
    const parsed = JSON.parse(result);
    expect(parsed.backends.length).toBe(1);
    expect(parsed.backends[0].backend).toBe("p1");
  });

  it("list_models 실패 → 모델 목록 빈 배열 (에러 무시)", async () => {
    const provider_ops = make_provider_ops({
      list: vi.fn(async () => [
        { instance_id: "p4", label: "P4", provider_type: "openai", enabled: true, available: true, settings: {}, connection_id: null },
      ]),
      list_models: vi.fn(async () => { throw new Error("API error"); }),
    });
    const run = get_run(new WorkflowTool(make_mock_ops(), provider_ops));
    const result = await run({ action: "models" });
    const parsed = JSON.parse(result);
    expect(parsed.backends[0].models).toEqual([]);
  });
});

describe("WorkflowTool — node_types with categories", () => {
  it("node_categories 지정 → 카탈로그 반환", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "node_types", node_categories: ["flow", "data"] });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("WorkflowTool — save 에러 경로", () => {
  it("create: save_template 예외 → Error 반환", async () => {
    const ops = make_mock_ops({ save_template: vi.fn(() => { throw new Error("disk full"); }) });
    const run = get_run(new WorkflowTool(ops));
    const result = await run({ action: "create", name: "test", definition: SAMPLE_DEF });
    expect(result).toContain("Error");
    expect(result).toContain("disk full");
  });

  it("update: save_template 예외 → Error 반환", async () => {
    const ops = make_mock_ops({
      get_template: vi.fn(() => SAMPLE_DEF),
      save_template: vi.fn(() => { throw new Error("write error"); }),
    });
    const run = get_run(new WorkflowTool(ops));
    const result = await run({ action: "update", name: "test", definition: SAMPLE_DEF });
    expect(result).toContain("Error");
    expect(result).toContain("write error");
  });
});

describe("WorkflowTool — export 에러 경로", () => {
  it("export: 템플릿 없음 → Error 반환", async () => {
    const ops = make_mock_ops({ export_template: vi.fn(() => null) });
    const run = get_run(new WorkflowTool(ops));
    const result = await run({ action: "export", name: "nonexistent" });
    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  it("export: name 없음 → Error 반환", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "export" });
    expect(result).toContain("Error");
    expect(result).toContain("name is required");
  });
});

describe("WorkflowTool — run inline 에러 경로", () => {
  it("run: name 없음 + definition 없음 → Error 반환", async () => {
    const run = get_run(new WorkflowTool(make_mock_ops()));
    const result = await run({ action: "run" });
    expect(result).toContain("Error");
    expect(result).toContain("name or definition is required");
  });

  it("run: variables 있으면 create에 전달", async () => {
    const ops = make_mock_ops({ get_template: vi.fn(() => SAMPLE_DEF) });
    const run = get_run(new WorkflowTool(ops));
    const vars = { env: "prod" };
    await run({ action: "run", name: "test", variables: vars });
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({ variables: vars }));
  });
});
