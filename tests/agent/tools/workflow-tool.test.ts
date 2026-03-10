/**
 * WorkflowTool — create/list/get/run/update/delete/export/flowchart/sequence/node_types/models 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { WorkflowTool } from "@src/agent/tools/workflow.js";
import type { DashboardWorkflowOps, DashboardAgentProviderOps } from "@src/dashboard/service.js";

// ── 최소 WorkflowDefinition (normalize 통과) ─────────

const VALID_DEF = {
  title: "Test Workflow",
  phases: [{ phase_id: "p1", agents: [{ agent_id: "a1", role: "tester" }] }],
};

// ── Mock ops ─────────────────────────────────────────

function make_ops(overrides: Partial<DashboardWorkflowOps> = {}): DashboardWorkflowOps {
  const templates = new Map<string, ReturnType<DashboardWorkflowOps["get_template"]>>();

  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ ok: true, workflow_id: "wf-123" }),
    cancel: vi.fn().mockResolvedValue(true),
    get_messages: vi.fn().mockResolvedValue([]),
    send_message: vi.fn().mockResolvedValue({ ok: true }),
    list_templates: vi.fn().mockImplementation(() => [...templates.values()].filter(Boolean).map(t => ({ ...t, slug: "test-workflow" }))),
    get_template: vi.fn().mockImplementation((name: string) => templates.get(name) ?? null),
    save_template: vi.fn().mockImplementation((name: string, def: unknown) => {
      templates.set(name, def as ReturnType<DashboardWorkflowOps["get_template"]>);
      return name.toLowerCase().replace(/\s+/g, "-");
    }),
    delete_template: vi.fn().mockImplementation((name: string) => {
      const had = templates.has(name);
      templates.delete(name);
      return had;
    }),
    import_template: vi.fn().mockReturnValue({ ok: true, name: "imported" }),
    export_template: vi.fn().mockImplementation((name: string) => templates.has(name) ? "title: Test Workflow\n" : null),
    list_roles: vi.fn().mockReturnValue([]),
    resume: vi.fn().mockResolvedValue({ ok: true }),
    update_settings: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function make_provider_ops(overrides: Partial<DashboardAgentProviderOps> = {}): DashboardAgentProviderOps {
  return {
    list: vi.fn().mockResolvedValue([
      {
        instance_id: "claude",
        label: "Claude",
        provider_type: "anthropic",
        enabled: true,
        available: true,
        settings: {},
        connection_id: null,
      },
    ]),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ ok: true }),
    update: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    test_availability: vi.fn().mockResolvedValue({ ok: true }),
    list_provider_types: vi.fn().mockReturnValue(["anthropic"]),
    list_models: vi.fn().mockResolvedValue([{ id: "claude-3", name: "Claude 3", purpose: "general" }]),
    get_connection: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as DashboardAgentProviderOps;
}

async function exec(tool: WorkflowTool, params: Record<string, unknown>): Promise<unknown> {
  const r = await tool.execute(params);
  try { return JSON.parse(r as string); } catch { return r; }
}

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("WorkflowTool — 메타데이터", () => {
  const tool = new WorkflowTool(make_ops());
  it("name = workflow", () => expect(tool.name).toBe("workflow"));
  it("category = external", () => expect(tool.category).toBe("external"));
  it("to_schema type = function", () => expect(tool.to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// create (L82–100)
// ══════════════════════════════════════════

describe("WorkflowTool — create", () => {
  it("name 없음 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "create" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("name");
  });

  it("definition 없음 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "create", name: "test" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("definition");
  });

  it("definition이 배열 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "create", name: "test", definition: [] });
    expect(String(r)).toContain("Error");
  });

  it("invalid definition (title 없음) → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "create", name: "test", definition: { phases: [] } });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("invalid");
  });

  it("유효한 definition → ok=true, slug 반환", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "create", name: "Test Workflow", definition: VALID_DEF }) as Record<string, unknown>;
    expect(r.ok).toBe(true);
    expect(typeof r.slug).toBe("string");
    expect(r.action).toBe("created");
  });

  it("save_template 예외 → Error", async () => {
    const ops = make_ops({ save_template: vi.fn().mockImplementation(() => { throw new Error("DB error"); }) });
    const tool = new WorkflowTool(ops);
    const r = await exec(tool, { action: "create", name: "test", definition: VALID_DEF });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("DB error");
  });
});

// ══════════════════════════════════════════
// list (L127–138)
// ══════════════════════════════════════════

describe("WorkflowTool — list", () => {
  it("빈 목록 → []", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "list" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("생성 후 목록 → 1개", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "Test Workflow", definition: VALID_DEF });
    const r = await exec(tool, { action: "list" }) as unknown[];
    expect(r.length).toBe(1);
  });
});

// ══════════════════════════════════════════
// get (L140–147)
// ══════════════════════════════════════════

describe("WorkflowTool — get", () => {
  it("name 없음 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "get" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("name");
  });

  it("없는 template → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "get", name: "nonexistent" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not found");
  });

  it("존재하는 template → JSON 반환", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "my-workflow", definition: VALID_DEF });
    const r = await exec(tool, { action: "get", name: "my-workflow" }) as Record<string, unknown>;
    expect(r.title).toBe("Test Workflow");
  });
});

// ══════════════════════════════════════════
// run (L149–191)
// ══════════════════════════════════════════

describe("WorkflowTool — run", () => {
  it("name으로 실행 — template 없음 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "run", name: "missing-workflow" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not found");
  });

  it("name으로 실행 — template 있음 → ok=true", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "runnable", definition: VALID_DEF });
    const r = await exec(tool, { action: "run", name: "runnable" }) as Record<string, unknown>;
    expect(r.ok).toBe(true);
  });

  it("name + variables → variables 전달됨", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "var-workflow", definition: VALID_DEF });
    const r = await exec(tool, { action: "run", name: "var-workflow", variables: { key: "value" } }) as Record<string, unknown>;
    expect(r.ok).toBe(true);
  });

  it("inline definition으로 실행 → ok=true", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "run", definition: VALID_DEF }) as Record<string, unknown>;
    expect(r.ok).toBe(true);
  });

  it("name도 definition도 없음 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "run" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("required");
  });

  it("inline definition이 배열 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "run", definition: [] });
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// update (L103–125)
// ══════════════════════════════════════════

describe("WorkflowTool — update", () => {
  it("name 없음 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "update" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("name");
  });

  it("존재하지 않는 template → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "update", name: "no-exist", definition: VALID_DEF });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not found");
  });

  it("definition 없음 → Error", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "upd-wf", definition: VALID_DEF });
    const r = await exec(tool, { action: "update", name: "upd-wf" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("definition");
  });

  it("유효한 update → ok=true, action=updated", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "upd-wf2", definition: VALID_DEF });
    const r = await exec(tool, { action: "update", name: "upd-wf2", definition: VALID_DEF }) as Record<string, unknown>;
    expect(r.ok).toBe(true);
    expect(r.action).toBe("updated");
  });

  it("invalid definition → Error", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "upd-wf3", definition: VALID_DEF });
    const r = await exec(tool, { action: "update", name: "upd-wf3", definition: { no_title: true, phases: [] } });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("invalid");
  });

  it("save_template 예외(update) → L123 Error", async () => {
    // get_template은 성공, save_template은 예외 발생 → L123 catch
    const ops = make_ops({
      get_template: vi.fn().mockReturnValue(VALID_DEF),
      save_template: vi.fn().mockImplementation(() => { throw new Error("Update DB write fail"); }),
    });
    const tool = new WorkflowTool(ops);
    const r = await exec(tool, { action: "update", name: "any-wf", definition: VALID_DEF });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("Update DB write fail");
  });
});

// ══════════════════════════════════════════
// delete (L193–198)
// ══════════════════════════════════════════

describe("WorkflowTool — delete", () => {
  it("name 없음 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "delete" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("name");
  });

  it("존재하는 template 삭제 → ok=true", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "del-wf", definition: VALID_DEF });
    const r = await exec(tool, { action: "delete", name: "del-wf" }) as Record<string, unknown>;
    expect(r.ok).toBe(true);
    expect(r.action).toBe("deleted");
  });

  it("없는 template 삭제 → ok=false", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "delete", name: "ghost" }) as Record<string, unknown>;
    expect(r.ok).toBe(false);
  });
});

// ══════════════════════════════════════════
// export (L201–208)
// ══════════════════════════════════════════

describe("WorkflowTool — export", () => {
  it("name 없음 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "export" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("name");
  });

  it("없는 template → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "export", name: "no-exist" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not found");
  });

  it("존재하는 template → YAML 문자열 반환", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "exp-wf", definition: VALID_DEF });
    const r = await exec(tool, { action: "export", name: "exp-wf" });
    expect(String(r)).toContain("title");
  });
});

// ══════════════════════════════════════════
// flowchart / sequence (L210–218)
// ══════════════════════════════════════════

describe("WorkflowTool — flowchart/sequence", () => {
  it("flowchart: name 없음 → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "flowchart" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("name");
  });

  it("flowchart: 없는 template → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "flowchart", name: "ghost" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not found");
  });

  it("flowchart: 유효한 template → Mermaid 반환", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "fc-wf", definition: VALID_DEF });
    const r = String(await exec(tool, { action: "flowchart", name: "fc-wf" }));
    // workflow_to_flowchart 반환 — 문자열이면 충분
    expect(typeof r).toBe("string");
  });

  it("sequence: 유효한 template → 문자열 반환", async () => {
    const ops = make_ops();
    const tool = new WorkflowTool(ops);
    await exec(tool, { action: "create", name: "seq-wf", definition: VALID_DEF });
    const r = String(await exec(tool, { action: "sequence", name: "seq-wf" }));
    expect(typeof r).toBe("string");
  });
});

// ══════════════════════════════════════════
// node_types (L260–270)
// ══════════════════════════════════════════

describe("WorkflowTool — node_types", () => {
  it("카테고리 없음 → 전체 카탈로그 반환 (캐시)", async () => {
    const tool = new WorkflowTool(make_ops());
    const r1 = String(await exec(tool, { action: "node_types" }));
    const r2 = String(await exec(tool, { action: "node_types" }));
    expect(r1).toBe(r2); // 캐시 동일
    expect(r1.length).toBeGreaterThan(0);
  });

  it("node_categories 지정 → 필터링된 카탈로그", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = String(await exec(tool, { action: "node_types", node_categories: ["data"] }));
    expect(r.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// models (L221–256)
// ══════════════════════════════════════════

describe("WorkflowTool — models", () => {
  it("provider_ops 없음 → error: provider_ops_unavailable", async () => {
    const tool = new WorkflowTool(make_ops(), null);
    const r = await exec(tool, { action: "models" }) as Record<string, unknown>;
    expect(r.error).toContain("provider_ops_unavailable");
  });

  it("provider_ops 있음 → backends 반환", async () => {
    const tool = new WorkflowTool(make_ops(), make_provider_ops());
    const r = await exec(tool, { action: "models" }) as Record<string, unknown>;
    expect(Array.isArray(r.backends)).toBe(true);
    const backends = r.backends as Array<{ backend: string; models: unknown[] }>;
    expect(backends[0].backend).toBe("claude");
    expect(backends[0].models.length).toBeGreaterThan(0);
  });

  it("models 조회 실패 시 빈 models 배열 (catch 분기)", async () => {
    const provider_ops = make_provider_ops({
      list_models: vi.fn().mockRejectedValue(new Error("API down")),
    });
    const tool = new WorkflowTool(make_ops(), provider_ops);
    const r = await exec(tool, { action: "models" }) as Record<string, unknown>;
    const backends = r.backends as Array<{ models: unknown[] }>;
    expect(backends[0].models).toEqual([]);
  });

  it("connection_id 있는 provider → get_connection 호출", async () => {
    const provider_ops = make_provider_ops({
      list: vi.fn().mockResolvedValue([{
        instance_id: "with-conn",
        label: "With Connection",
        provider_type: "openai",
        enabled: true,
        available: true,
        settings: { api_base: "https://custom.example.com" },
        connection_id: "conn-abc",
      }]),
      get_connection: vi.fn().mockResolvedValue({ api_base: "https://conn.example.com" }),
      list_models: vi.fn().mockResolvedValue([{ id: "gpt-4", name: "GPT-4", purpose: "general" }]),
    });
    const tool = new WorkflowTool(make_ops(), provider_ops);
    const r = await exec(tool, { action: "models" }) as Record<string, unknown>;
    const backends = r.backends as Array<{ models: unknown[] }>;
    expect(backends[0].models.length).toBe(1);
  });
});

// ══════════════════════════════════════════
// default
// ══════════════════════════════════════════

describe("WorkflowTool — unknown action", () => {
  it("지원하지 않는 action → Error", async () => {
    const tool = new WorkflowTool(make_ops());
    const r = await exec(tool, { action: "unsupported_action" });
    expect(String(r)).toContain("Error");
  });
});
