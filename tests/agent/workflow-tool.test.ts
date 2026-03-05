import { describe, it, expect, vi } from "vitest";
import { WorkflowTool } from "../../src/agent/tools/workflow.js";
import type { DashboardWorkflowOps } from "../../src/dashboard/service.js";
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
        { ...SAMPLE_DEF, title: "Weekly Report", trigger: { type: "cron" as const, schedule: "0 0 * * 1" } },
      ]),
    });
    const run = get_run(new WorkflowTool(ops));

    const result = await run({ action: "list" });
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>;

    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("Daily RSS");
    expect(parsed[0].slug).toBe("daily-rss");
    expect(parsed[1].trigger).toEqual({ type: "cron", schedule: "0 0 * * 1" });
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
    expect(result).toContain("Workflow Definition Structure");
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
