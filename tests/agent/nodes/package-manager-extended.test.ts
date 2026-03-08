/**
 * package_manager_handler — execute/test/build_pkg_cmd 미커버 경로.
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
    node_id: "n1",
    node_type: "package_manager",
    operation: "list",
    manager: "npm",
    package_name: "",
    flags: "",
    ...overrides,
  } as unknown as OrcheNodeDefinition;
}

function make_ctx(memory: Record<string, unknown> = {}) {
  return { memory, workspace: "/tmp/ws", abort_signal: undefined } as any;
}

function ok(stdout = "(output)") {
  return mock_run.mockResolvedValueOnce({ stdout, stderr: "" });
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// create_default
// ══════════════════════════════════════════

describe("package_manager_handler — create_default", () => {
  it("기본값 반환", () => {
    const d = package_manager_handler.create_default!() as any;
    expect(d.operation).toBe("list");
    expect(d.manager).toBe("npm");
    expect(d.package_name).toBe("");
  });
});

// ══════════════════════════════════════════
// test — warnings
// ══════════════════════════════════════════

describe("package_manager_handler — test()", () => {
  it("operation 없음 → warning 포함", () => {
    const r = package_manager_handler.test!(make_node({ operation: "" }));
    expect(r.warnings).toContain("operation is required");
  });

  it("install + package_name 없음 → warning", () => {
    const r = package_manager_handler.test!(make_node({ operation: "install", package_name: "" }));
    expect(r.warnings).toContain("package_name required");
  });

  it("uninstall + package_name 없음 → warning", () => {
    const r = package_manager_handler.test!(make_node({ operation: "uninstall", package_name: "" }));
    expect(r.warnings).toContain("package_name required");
  });

  it("info + package_name 없음 → warning", () => {
    const r = package_manager_handler.test!(make_node({ operation: "info", package_name: "" }));
    expect(r.warnings).toContain("package_name required");
  });

  it("list + package_name 없음 → warning 없음 (패키지 불필요)", () => {
    const r = package_manager_handler.test!(make_node({ operation: "list", package_name: "" }));
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 manager/operation/package_name 포함", () => {
    const r = package_manager_handler.test!(make_node({ manager: "pip", operation: "install", package_name: "requests" }));
    expect(r.preview).toMatchObject({ manager: "pip", operation: "install", package_name: "requests" });
  });
});

// ══════════════════════════════════════════
// execute — npm 명령어
// ══════════════════════════════════════════

describe("package_manager_handler — npm execute", () => {
  it("list → npm list --depth=0", async () => {
    ok("react@18.0.0");
    const r = await package_manager_handler.execute(make_node({ operation: "list", manager: "npm" }), make_ctx());
    expect(r.output.success).toBe(true);
    expect(mock_run).toHaveBeenCalledWith("npm list --depth=0", expect.anything());
  });

  it("install 패키지명 있음", async () => {
    ok("added 1 package");
    await package_manager_handler.execute(make_node({ operation: "install", manager: "npm", package_name: "express" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("npm install express", expect.anything());
  });

  it("install 패키지명 없음 → npm install", async () => {
    ok("added 100 packages");
    await package_manager_handler.execute(make_node({ operation: "install", manager: "npm" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("npm install", expect.anything());
  });

  it("uninstall 패키지명 없음 → success: false (null cmd)", async () => {
    const r = await package_manager_handler.execute(make_node({ operation: "uninstall", manager: "npm" }), make_ctx());
    expect(r.output.success).toBe(false);
    expect(String(r.output.error)).toContain("unsupported");
    expect(mock_run).not.toHaveBeenCalled();
  });

  it("audit", async () => {
    ok("0 vulnerabilities");
    await package_manager_handler.execute(make_node({ operation: "audit", manager: "npm" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("npm audit", expect.anything());
  });

  it("outdated", async () => {
    ok("Package Current");
    await package_manager_handler.execute(make_node({ operation: "outdated", manager: "npm" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("npm outdated", expect.anything());
  });

  it("info 패키지명 있음", async () => {
    ok("express@4.18.0");
    await package_manager_handler.execute(make_node({ operation: "info", manager: "npm", package_name: "express" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("npm info express", expect.anything());
  });

  it("flags 포함 → 명령에 추가", async () => {
    ok("added 1 package");
    await package_manager_handler.execute(make_node({ operation: "install", manager: "npm", package_name: "jest", flags: "--save-dev" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("npm install jest --save-dev", expect.anything());
  });
});

// ══════════════════════════════════════════
// execute — pip 명령어
// ══════════════════════════════════════════

describe("package_manager_handler — pip execute", () => {
  it("list", async () => {
    ok("requests 2.28.0");
    await package_manager_handler.execute(make_node({ operation: "list", manager: "pip" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("pip list", expect.anything());
  });

  it("install 패키지명 없음 → success: false", async () => {
    const r = await package_manager_handler.execute(make_node({ operation: "install", manager: "pip" }), make_ctx());
    expect(r.output.success).toBe(false);
  });

  it("install 패키지명 있음", async () => {
    ok("Successfully installed requests");
    await package_manager_handler.execute(make_node({ operation: "install", manager: "pip", package_name: "requests" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("pip install requests", expect.anything());
  });

  it("audit → pip check", async () => {
    ok("No broken requirements found.");
    await package_manager_handler.execute(make_node({ operation: "audit", manager: "pip" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("pip check", expect.anything());
  });
});

// ══════════════════════════════════════════
// execute — cargo 명령어
// ══════════════════════════════════════════

describe("package_manager_handler — cargo execute", () => {
  it("list → cargo install --list", async () => {
    ok("tokio v1.0.0:");
    await package_manager_handler.execute(make_node({ operation: "list", manager: "cargo" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("cargo install --list", expect.anything());
  });

  it("install 패키지명 → cargo add", async () => {
    ok("Adding tokio");
    await package_manager_handler.execute(make_node({ operation: "install", manager: "cargo", package_name: "tokio" }), make_ctx());
    expect(mock_run).toHaveBeenCalledWith("cargo add tokio", expect.anything());
  });
});

// ══════════════════════════════════════════
// execute — 알 수 없는 매니저
// ══════════════════════════════════════════

describe("package_manager_handler — 알 수 없는 매니저", () => {
  it("pnpm → null cmd → success: false", async () => {
    const r = await package_manager_handler.execute(make_node({ operation: "list", manager: "pnpm" }), make_ctx());
    expect(r.output.success).toBe(false);
    expect(mock_run).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// execute — 에러 처리
// ══════════════════════════════════════════

describe("package_manager_handler — execute 에러", () => {
  it("shell 실행 예외 → success: false", async () => {
    mock_run.mockRejectedValueOnce(new Error("command not found: npm"));
    const r = await package_manager_handler.execute(make_node({ operation: "list", manager: "npm" }), make_ctx());
    expect(r.output.success).toBe(false);
    expect(String(r.output.output)).toContain("command not found");
  });

  it("stdout 없음 → (no output)", async () => {
    mock_run.mockResolvedValueOnce({ stdout: "", stderr: "" });
    const r = await package_manager_handler.execute(make_node({ operation: "list", manager: "npm" }), make_ctx());
    expect(r.output.success).toBe(true);
    expect(r.output.output).toBe("(no output)");
  });
});
