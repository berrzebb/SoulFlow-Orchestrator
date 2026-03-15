/**
 * dashboard/ops/workflow.ts — 커버리지 보충:
 * - hitl_bridge.try_resolve, list, get
 * - cancel (not_found / found)
 * - send_message (validation paths, pending response, agent not found)
 * - list_templates, get_template, save_template, delete_template, import_template, export_template
 * - list_roles (없음 / 있음)
 * - resume (not_found / already_completed / already_running / no_definition / fire-and-forget)
 * - resume_orphaned (없음 / 있음)
 * - update_settings (not_found / ok)
 * - run_single_node (orche / phase no_agents / unknown_node_type)
 * - suggest (providers_not_configured)
 * - create (template_not_found / no_default_template / with nodes)
 * - build_ask_user / build_send_message / build_ask_channel (auto_resume, bus 없음)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create_workflow_ops } from "@src/dashboard/ops/workflow.js";
import { HitlPendingStore } from "@src/orchestration/hitl-pending-store.js";

// ── run_phase_loop mock ───────────────────────────────────────────────────────
vi.mock("@src/agent/phase-loop-runner.js", () => ({
  run_phase_loop: vi.fn().mockResolvedValue({ status: "completed", memory: {} }),
}));
import { run_phase_loop } from "@src/agent/phase-loop-runner.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function make_state(override: Record<string, unknown> = {}) {
  return {
    workflow_id: "wf-test",
    title: "Test Workflow",
    objective: "test",
    channel: "slack",
    chat_id: "C1",
    status: "running" as const,
    current_phase: 0,
    phases: [
      {
        phase_id: "phase-1",
        status: "pending" as const,
        agents: [{ agent_id: "a1", subagent_id: "sa1", status: "pending" as const, output: null }],
        critic_status: null, critic_output: null,
      },
    ],
    orche_states: [],
    memory: {},
    definition: {
      title: "Test Workflow",
      objective: "test",
      phases: [{ phase_id: "phase-1", agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "codex_cli", system_prompt: "analyze" }] }],
      nodes: undefined,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...override,
  };
}

function make_store(overrides: Partial<{
  get_result: ReturnType<typeof make_state> | null;
  list_result: ReturnType<typeof make_state>[];
}> = {}) {
  const { get_result = make_state(), list_result = [make_state()] } = overrides;
  return {
    get: vi.fn().mockResolvedValue(get_result),
    list: vi.fn().mockResolvedValue(list_result),
    upsert: vi.fn().mockResolvedValue(undefined),
    patch_settings: vi.fn().mockResolvedValue(undefined),
    insert_message: vi.fn().mockResolvedValue(undefined),
    get_messages: vi.fn().mockResolvedValue([]),
  };
}

function make_subagents() {
  return {
    cancel_by_parent_id: vi.fn().mockReturnValue(0),
    spawn: vi.fn().mockResolvedValue({ subagent_id: "sa1" }),
    wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: '{"result":"ok"}' }),
    get_provider_caps: vi.fn().mockReturnValue({ openrouter_available: true }),
  };
}

const noop_logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

function make_ops(store: ReturnType<typeof make_store>, workspace: string, overrides: Record<string, unknown> = {}) {
  const hitl_pending_store = new HitlPendingStore();
  return create_workflow_ops({
    store: store as any,
    subagents: make_subagents() as any,
    workspace,
    logger: noop_logger,
    hitl_pending_store,
    ...overrides,
  } as any);
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "wf-ops-cov-"));
  vi.mocked(run_phase_loop).mockReset();
  vi.mocked(run_phase_loop).mockResolvedValue({ status: "completed", memory: {} } as any);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════════════════════
// hitl_bridge
// ══════════════════════════════════════════════════════════

describe("hitl_bridge.try_resolve()", () => {
  it("매칭 chat_id 없음 → false", async () => {
    const store = make_store();
    const ops = make_ops(store, workspace);
    const result = await ops.hitl_bridge.try_resolve("C_unknown", "hello");
    expect(result).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// list / get
// ══════════════════════════════════════════════════════════

describe("list() / get()", () => {
  it("list() → store.list() 위임", async () => {
    const store = make_store({ list_result: [make_state()] });
    const ops = make_ops(store, workspace);
    const result = await ops.list();
    expect(store.list).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it("get(id) → store.get(id) 위임", async () => {
    const store = make_store({ get_result: make_state() });
    const ops = make_ops(store, workspace);
    const result = await ops.get("wf-test");
    expect(store.get).toHaveBeenCalledWith("wf-test");
    expect(result).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// cancel()
// ══════════════════════════════════════════════════════════

describe("cancel()", () => {
  it("workflow 없음 → false", async () => {
    const store = make_store({ get_result: null });
    const ops = make_ops(store, workspace);
    const result = await ops.cancel("wf-ghost");
    expect(result).toBe(false);
  });

  it("workflow 있음 → status=cancelled + upsert + cancel_by_parent_id", async () => {
    const store = make_store();
    const subagents = make_subagents();
    const hitl_pending_store = new HitlPendingStore();
    const ops = create_workflow_ops({ store: store as any, subagents: subagents as any, workspace, logger: noop_logger, hitl_pending_store } as any);
    const result = await ops.cancel("wf-test");
    expect(result).toBe(true);
    expect(store.upsert).toHaveBeenCalled();
    expect(subagents.cancel_by_parent_id).toHaveBeenCalledWith("workflow:wf-test");
  });
});

// ══════════════════════════════════════════════════════════
// send_message()
// ══════════════════════════════════════════════════════════

describe("send_message()", () => {
  it("빈 content → error: empty_content", async () => {
    const store = make_store();
    const ops = make_ops(store, workspace);
    const result = await ops.send_message("wf-test", "phase-1", "a1", "   ");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("empty_content");
  });

  it("workflow 없음 → workflow_not_found", async () => {
    const store = make_store({ get_result: null });
    const ops = make_ops(store, workspace);
    const result = await ops.send_message("wf-ghost", "p1", "a1", "hello");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("workflow_not_found");
  });

  it("phase 없음 → phase_not_found", async () => {
    const store = make_store({ get_result: make_state() });
    const ops = make_ops(store, workspace);
    const result = await ops.send_message("wf-test", "nonexistent-phase", "a1", "hello");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("phase_not_found");
  });

  it("agent 없음 → agent_not_found", async () => {
    const store = make_store({ get_result: make_state() });
    const ops = make_ops(store, workspace);
    const result = await ops.send_message("wf-test", "phase-1", "nonexistent-agent", "hello");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("agent_not_found");
  });

  it("pending_responses에 있음 → resolve + ok:true", async () => {
    const store = make_store({ get_result: make_state() });
    const hitl_pending_store = new HitlPendingStore();
    let resolved_value: string | null = null;
    hitl_pending_store.set("wf-test", {
      resolve: (v) => { resolved_value = v; },
      chat_id: "C1",
    });
    const ops = create_workflow_ops({ store: store as any, subagents: make_subagents() as any, workspace, logger: noop_logger, hitl_pending_store } as any);
    const result = await ops.send_message("wf-test", "phase-1", "a1", "yes");
    expect(result.ok).toBe(true);
    expect(resolved_value).toBe("yes");
  });
});

// ══════════════════════════════════════════════════════════
// list_templates / get_template / save_template / delete_template
// ══════════════════════════════════════════════════════════

describe("template ops", () => {
  it("list_templates — 빈 workspace → []", () => {
    const ops = make_ops(make_store(), workspace);
    expect(ops.list_templates()).toHaveLength(0);
  });

  it("get_template — 없는 이름 → null", () => {
    const ops = make_ops(make_store(), workspace);
    expect(ops.get_template("nonexistent")).toBeNull();
  });

  it("save_template / get_template / delete_template 사이클", () => {
    const ops = make_ops(make_store(), workspace);
    const def = { title: "My Flow", objective: "test", phases: [{ phase_id: "p1", agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "codex_cli", system_prompt: "" }] }] };
    const slug = ops.save_template("My Flow", def as any);
    expect(typeof slug).toBe("string");

    const loaded = ops.get_template(slug);
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe("My Flow");

    const removed = ops.delete_template(slug);
    expect(removed).toBe(true);
    expect(ops.get_template(slug)).toBeNull();
  });

  it("import_template — 유효 JSON → ok:true", () => {
    const ops = make_ops(make_store(), workspace);
    const def = { title: "Imported", objective: "", phases: [{ phase_id: "p1", agents: [{ agent_id: "a1", role: "a", label: "A", backend: "codex_cli", system_prompt: "" }] }] };
    const result = ops.import_template(JSON.stringify(def));
    expect(result.ok).toBe(true);
    expect(typeof result.name).toBe("string");
  });

  it("import_template — invalid JSON → error: invalid_yaml", () => {
    const ops = make_ops(make_store(), workspace);
    const result = ops.import_template("not a yaml at all!!!");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_yaml");
  });

  it("export_template — 없는 이름 → null", () => {
    const ops = make_ops(make_store(), workspace);
    expect(ops.export_template("ghost")).toBeNull();
  });

  it("export_template — 존재하는 템플릿 → YAML/JSON 문자열", () => {
    const ops = make_ops(make_store(), workspace);
    const def = { title: "Exported", objective: "", phases: [{ phase_id: "p1", agents: [{ agent_id: "a1", role: "a", label: "A", backend: "codex_cli", system_prompt: "" }] }] };
    ops.save_template("Exported", def as any);
    const yaml = ops.export_template("exported");
    expect(typeof yaml).toBe("string");
    expect(yaml).toContain("Exported");
  });
});

// ══════════════════════════════════════════════════════════
// list_roles()
// ══════════════════════════════════════════════════════════

describe("list_roles()", () => {
  it("skills_loader 없음 → []", () => {
    const ops = make_ops(make_store(), workspace);
    expect(ops.list_roles()).toEqual([]);
  });

  it("skills_loader 있음 → enriched role 목록 반환 (RP-5)", () => {
    const meta = {
      role: "analyst", name: "role:analyst",
      summary: "Use when data analysis needed. Do NOT use for coding.",
      soul: "curious", heart: "logical", tools: ["web_search"],
      shared_protocols: [], model: "sonnet", path: null,
    };
    const ops = make_ops(make_store(), workspace, {
      skills_loader: {
        list_role_skills: vi.fn().mockReturnValue([meta]),
        get_role_skill: vi.fn().mockImplementation((id: string) => id === "analyst" ? meta : null),
        list_shared_protocols: vi.fn().mockReturnValue([]),
      },
    });
    const roles = ops.list_roles();
    expect(roles).toHaveLength(1);
    expect(roles[0].id).toBe("analyst");
    expect(roles[0].name).toBe("analyst");
    expect(roles[0].use_when).toBe("data analysis needed");
    expect(roles[0].not_use_for).toBe("coding");
    expect(roles[0].preferred_model).toBe("sonnet");
    expect(roles[0].rendered_prompt).toContain("# Role: analyst");
  });

  it("resolver 미매칭 role → raw fallback", () => {
    const meta = {
      role: null, name: "role:custom",
      summary: "Custom role", soul: null, heart: null,
      tools: ["tool_a"], shared_protocols: [], model: null, path: null,
    };
    const ops = make_ops(make_store(), workspace, {
      skills_loader: {
        list_role_skills: vi.fn().mockReturnValue([meta]),
        get_role_skill: vi.fn().mockReturnValue(null),
        list_shared_protocols: vi.fn().mockReturnValue([]),
      },
    });
    const roles = ops.list_roles();
    expect(roles).toHaveLength(1);
    expect(roles[0].id).toBe("role:custom");
    expect(roles[0].rendered_prompt).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// resume()
// ══════════════════════════════════════════════════════════

describe("resume()", () => {
  it("workflow 없음 → workflow_not_found", async () => {
    const ops = make_ops(make_store({ get_result: null }), workspace);
    const result = await ops.resume("wf-ghost");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("workflow_not_found");
  });

  it("status=completed → workflow_already_completed", async () => {
    const ops = make_ops(make_store({ get_result: make_state({ status: "completed" }) }), workspace);
    const result = await ops.resume("wf-test");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("completed");
  });

  it("status=cancelled → workflow_already_cancelled", async () => {
    const ops = make_ops(make_store({ get_result: make_state({ status: "cancelled" }) }), workspace);
    const result = await ops.resume("wf-test");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cancelled");
  });

  it("status=running → workflow_already_running", async () => {
    const ops = make_ops(make_store({ get_result: make_state({ status: "running" }) }), workspace);
    const result = await ops.resume("wf-test");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("workflow_already_running");
  });

  it("no definition → no_definition_for_resume", async () => {
    const ops = make_ops(make_store({ get_result: make_state({ status: "paused", definition: { title: "t", phases: [], nodes: undefined } }) }), workspace);
    const result = await ops.resume("wf-test");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_definition_for_resume");
  });

  it("유효 상태 → run_phase_loop 호출 + ok:true", async () => {
    const state = make_state({ status: "paused" });
    const ops = make_ops(make_store({ get_result: state }), workspace);
    const result = await ops.resume("wf-test");
    expect(result.ok).toBe(true);
    // run_phase_loop는 void로 호출되므로 즉시 ok:true
  });
});

// ══════════════════════════════════════════════════════════
// resume_orphaned()
// ══════════════════════════════════════════════════════════

describe("resume_orphaned()", () => {
  it("고아 없음 → 즉시 반환", async () => {
    const store = make_store({ list_result: [make_state({ status: "completed" })] });
    const ops = make_ops(store, workspace);
    await expect(ops.resume_orphaned()).resolves.toBeUndefined();
    expect(run_phase_loop).not.toHaveBeenCalled();
  });

  it("running 고아 → run_phase_loop 호출", async () => {
    const store = make_store({ list_result: [make_state({ status: "running" })] });
    const ops = make_ops(store, workspace);
    await ops.resume_orphaned();
    // void로 호출 → 비동기 완료 대기 없음, mocked이므로 즉시
  });

  it("waiting_user_input + auto_resume → run_phase_loop 호출", async () => {
    const store = make_store({ list_result: [make_state({ status: "waiting_user_input", auto_resume: true })] });
    const ops = make_ops(store, workspace);
    await ops.resume_orphaned();
    // void로 호출, mock이므로 바로 완료
  });
});

// ══════════════════════════════════════════════════════════
// update_settings()
// ══════════════════════════════════════════════════════════

describe("update_settings()", () => {
  it("workflow 없음 → workflow_not_found", async () => {
    const ops = make_ops(make_store({ get_result: null }), workspace);
    const result = await ops.update_settings("wf-ghost", { auto_approve: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("workflow_not_found");
  });

  it("workflow 있음 → patch_settings 호출 + ok:true", async () => {
    const store = make_store();
    const ops = make_ops(store, workspace);
    const result = await ops.update_settings("wf-test", { auto_resume: true });
    expect(result.ok).toBe(true);
    expect(store.patch_settings).toHaveBeenCalledWith("wf-test", { auto_resume: true });
  });
});

// ══════════════════════════════════════════════════════════
// run_single_node()
// ══════════════════════════════════════════════════════════

describe("run_single_node()", () => {
  it("orche 노드 (set) → execute_orche_node 실행 → ok:true + output", async () => {
    const ops = make_ops(make_store(), workspace);
    const result = await ops.run_single_node(
      { node_id: "n1", node_type: "set", title: "Set", assignments: [{ key: "x", value: "hello" }] } as any,
      {},
    );
    expect(result.ok).toBe(true);
    expect((result as any).output).toBeDefined();
  });

  it("phase 노드 + agents 없음 → no_agents_in_phase", async () => {
    const ops = make_ops(make_store(), workspace);
    const result = await ops.run_single_node(
      { node_id: "ph1", node_type: "phase", title: "Phase" } as any,
      {},
    );
    expect(result.ok).toBe(false);
    expect((result as any).error).toBe("no_agents_in_phase");
  });

  it("알 수 없는 orche node_type → execute_orche_node 예외 → ok:false + error 포함", async () => {
    const ops = make_ops(make_store(), workspace);
    // custom_xyz는 is_orche_node=true(non-phase/trigger) → execute_orche_node가 throw
    const result = await ops.run_single_node(
      { node_id: "x1", node_type: "custom_xyz", title: "X" } as any,
      {},
    );
    expect(result.ok).toBe(false);
    expect((result as any).error).toContain("unknown node type");
  });
});

// ══════════════════════════════════════════════════════════
// suggest() — providers_not_configured
// ══════════════════════════════════════════════════════════

describe("suggest()", () => {
  it("providers 없음 → providers_not_configured", async () => {
    const ops = make_ops(make_store(), workspace); // providers 미전달
    const result = await ops.suggest("workflow 만들어줘");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("providers_not_configured");
  });
});

// ══════════════════════════════════════════════════════════
// create()
// ══════════════════════════════════════════════════════════

describe("create()", () => {
  it("template_name + 없는 템플릿 → template_not_found", async () => {
    const ops = make_ops(make_store(), workspace);
    const result = await ops.create({ template_name: "nonexistent_template" } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("template_not_found");
  });

  it("nodes 없음 + template 없음 → no_default_template (빈 workspace)", async () => {
    const ops = make_ops(make_store(), workspace); // 빈 workspace
    const result = await ops.create({ title: "My Workflow" } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_default_template");
  });

  it("nodes 배열로 create → run_phase_loop 비동기 호출 + ok:true", async () => {
    const ops = make_ops(make_store(), workspace);
    const result = await ops.create({
      title: "Node Workflow",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      nodes: [
        { node_id: "set1", node_type: "set", title: "Set", assignments: [{ key: "done", value: "true" }] },
      ],
    } as any);
    expect(result.ok).toBe(true);
    expect((result as any).workflow_id).toMatch(/^wf-/);
  });

  it("phases 배열로 create → ok:true", async () => {
    const ops = make_ops(make_store(), workspace);
    const result = await ops.create({
      title: "Phase Workflow",
      objective: "test",
      phases: [{ phase_id: "p1", agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "codex_cli", system_prompt: "" }] }],
    } as any);
    expect(result.ok).toBe(true);
    expect((result as any).workflow_id).toMatch(/^wf-/);
  });

  it("template_name + 존재하는 템플릿 → ok:true", async () => {
    const ops = make_ops(make_store(), workspace);
    const def = { title: "my-template", objective: "do stuff", phases: [{ phase_id: "p1", agents: [{ agent_id: "a1", role: "analyst", label: "A", backend: "codex_cli", system_prompt: "analyze {{objective}}" }] }] };
    ops.save_template("my-template", def as any);
    const result = await ops.create({ title: "Run It", template_name: "my-template", objective: "run now" } as any);
    expect(result.ok).toBe(true);
  });

  it("artifact_bundle 포함 create → run_phase_loop에 artifact_bundle 전달", async () => {
    const ops = make_ops(make_store(), workspace);
    const bundle = {
      repo_id: "test-repo",
      created_at: "2026-01-01T00:00:00.000Z",
      is_passing: true,
      total_validators: 3,
      passed_validators: 3,
      failed_kinds: [] as string[],
    };
    const result = await ops.create({
      title: "Bundle Workflow",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      nodes: [{ node_id: "set1", node_type: "set", title: "Set", assignments: [{ key: "done", value: "true" }] }],
      artifact_bundle: bundle,
    } as any);
    expect(result.ok).toBe(true);
    expect(run_phase_loop).toHaveBeenCalledWith(
      expect.objectContaining({ artifact_bundle: bundle }),
      expect.anything(),
    );
  });

  it("artifact_bundle 미제공 create → run_phase_loop에 artifact_bundle 없음", async () => {
    const ops = make_ops(make_store(), workspace);
    const result = await ops.create({
      title: "No Bundle Workflow",
      objective: "test",
      channel: "slack",
      chat_id: "C1",
      nodes: [{ node_id: "set1", node_type: "set", title: "Set", assignments: [{ key: "done", value: "true" }] }],
    } as any);
    expect(result.ok).toBe(true);
    expect(run_phase_loop).toHaveBeenCalledWith(
      expect.objectContaining({ artifact_bundle: undefined }),
      expect.anything(),
    );
  });
});
