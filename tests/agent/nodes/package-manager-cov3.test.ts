/**
 * package_manager_handler — 미커버 분기 보충.
 * npm default, pip uninstall/outdated/info/default, cargo uninstall/audit/outdated/info/default.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mock_run } = vi.hoisted(() => ({ mock_run: vi.fn() }));

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: mock_run,
}));

import { package_manager_handler } from "@src/agent/nodes/package-manager.js";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";

function make_node(overrides: Record<string, unknown> = {}): OrcheNodeDefinition {
  return {
    node_id: "n1", node_type: "package_manager",
    operation: "list", manager: "npm", package_name: "", flags: "",
    ...overrides,
  } as unknown as OrcheNodeDefinition;
}

function make_ctx() {
  return { memory: {}, workspace: "/tmp/ws", abort_signal: undefined } as any;
}

function ok(stdout = "output") {
  return mock_run.mockResolvedValueOnce({ stdout, stderr: "" });
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// npm — default (unknown op) → L70
// ══════════════════════════════════════════

describe("package_manager_handler — npm default (L70)", () => {
  it("npm + 알 수 없는 operation → success: false (null cmd)", async () => {
    const r = await package_manager_handler.execute(make_node({ operation: "unknown_op", manager: "npm" }), make_ctx());
    expect(r.output.success).toBe(false);
    expect(mock_run).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// pip — 미커버 경로 (L77, L79-81)
// ══════════════════════════════════════════

describe("package_manager_handler — pip 미커버 (L77,L79-81)", () => {
  it("pip uninstall + 패키지명 있음 → pip uninstall -y pkg (L77)", async () => {
    ok("Successfully uninstalled requests");
    await package_manager_handler.execute(make_node({ operation: "uninstall", manager: "pip", package_name: "requests" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("pip uninstall -y requests", expect.anything());
  });

  it("pip outdated → pip list --outdated (L79)", async () => {
    ok("Package Version Latest");
    await package_manager_handler.execute(make_node({ operation: "outdated", manager: "pip" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("pip list --outdated", expect.anything());
  });

  it("pip info + 패키지명 있음 → pip show pkg (L80)", async () => {
    ok("Name: requests\nVersion: 2.28.0");
    await package_manager_handler.execute(make_node({ operation: "info", manager: "pip", package_name: "requests" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("pip show requests", expect.anything());
  });

  it("pip + 알 수 없는 operation → success: false (L81)", async () => {
    const r = await package_manager_handler.execute(make_node({ operation: "unknown_op", manager: "pip" }), make_ctx());
    expect(r.output.success).toBe(false);
    expect(mock_run).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// cargo — 미커버 경로 (L88-92)
// ══════════════════════════════════════════

describe("package_manager_handler — cargo 미커버 (L88-92)", () => {
  it("cargo uninstall + 패키지명 있음 → cargo remove pkg (L88)", async () => {
    ok("Removing tokio");
    await package_manager_handler.execute(make_node({ operation: "uninstall", manager: "cargo", package_name: "tokio" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("cargo remove tokio", expect.anything());
  });

  it("cargo audit → cargo audit (L89)", async () => {
    ok("0 vulnerabilities found");
    await package_manager_handler.execute(make_node({ operation: "audit", manager: "cargo" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("cargo audit", expect.anything());
  });

  it("cargo outdated → cargo outdated (L90)", async () => {
    ok("Name  Outdated");
    await package_manager_handler.execute(make_node({ operation: "outdated", manager: "cargo" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("cargo outdated", expect.anything());
  });

  it("cargo info + 패키지명 있음 → cargo search --limit 5 (L91)", async () => {
    ok("tokio = \"1.0.0\"");
    await package_manager_handler.execute(make_node({ operation: "info", manager: "cargo", package_name: "tokio" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("cargo search tokio --limit 5", expect.anything());
  });

  it("cargo + 알 수 없는 operation → success: false (L92)", async () => {
    const r = await package_manager_handler.execute(make_node({ operation: "unknown_op", manager: "cargo" }), make_ctx());
    expect(r.output.success).toBe(false);
    expect(mock_run).not.toHaveBeenCalled();
  });
});


// ══════════════════════════════════════════
// DEP_OPS 분기 (L34-53)
// ══════════════════════════════════════════

describe("package_manager_handler — DEP_OPS DependencyTool 위임", () => {
  const ctx = { memory: {}, workspace: "/tmp", abort_signal: undefined };

  it("operation=parse_deps → DependencyTool 위임 (L34-51)", async () => {
    const r = await package_manager_handler.execute({ node_id: "n1", node_type: "package_manager", operation: "parse_deps", dep_input: '{"dependencies":{"react":"^18"}}' } as any, ctx);
    expect(r.output).toBeDefined();
    expect((r.output as any).success).toBe(true);
  });

  it("operation=dep_tree → DependencyTool 위임", async () => {
    const r = await package_manager_handler.execute({ node_id: "n1", node_type: "package_manager", operation: "dep_tree", dep_input: '{"dependencies":{"a":"1"}}' } as any, ctx);
    expect(r.output).toBeDefined();
  });
});
