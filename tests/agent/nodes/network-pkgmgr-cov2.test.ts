/**
 * network_handler / package_manager_handler — 미커버 분기 커버리지.
 * - build_net_cmd unsupported op → null
 * - build_pkg_cmd null 반환 (pkg 없는 uninstall 등)
 * - test() 경고 메시지
 * - shell 오류 catch 분기
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── shell-runtime mock ──────────────────────────────────────────────────────

const mock_run_shell = vi.hoisted(() => vi.fn());

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: mock_run_shell,
}));

// ─── resolve_templates mock (identity) ───────────────────────────────────────

vi.mock("@src/agent/orche-node-executor.js", () => ({
  resolve_templates: (s: string) => s,
}));

import { network_handler } from "@src/agent/nodes/network.js";
import { package_manager_handler } from "@src/agent/nodes/package-manager.js";

// ─── 공통 context ─────────────────────────────────────────────────────────────

const make_ctx = () => ({
  memory: {},
  workspace: "/tmp/ws",
  abort_signal: undefined as any,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock_run_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
});

// ══════════════════════════════════════════════════════════════
// network_handler — execute
// ══════════════════════════════════════════════════════════════

describe("network_handler — execute", () => {
  it("ping 성공 → success=true", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "PING ok", stderr: "" });
    const r = await network_handler.execute!(
      { node_type: "network", operation: "ping", host: "example.com", port: 0, count: 1 } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
    expect((r.output as any).output).toContain("PING");
  });

  it("dns 성공 → success=true", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "1.2.3.4", stderr: "" });
    const r = await network_handler.execute!(
      { node_type: "network", operation: "dns", host: "example.com", port: 0, count: 3 } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
  });

  it("netstat 성공 → no-output fallback", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await network_handler.execute!(
      { node_type: "network", operation: "netstat", host: "", port: 0, count: 3 } as any,
      make_ctx() as any,
    );
    expect((r.output as any).output).toBe("(no output)");
    expect((r.output as any).success).toBe(true);
  });

  it("http_head — host가 https로 시작 → 그대로 사용", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "HTTP/1.1 200", stderr: "" });
    const r = await network_handler.execute!(
      { node_type: "network", operation: "http_head", host: "https://example.com", port: 0, count: 3 } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
    expect(mock_run_shell).toHaveBeenCalledWith(
      expect.stringContaining("https://example.com"),
      expect.anything(),
    );
  });

  it("http_head — host가 http 없음 → https:// 접두사 추가", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "200", stderr: "" });
    await network_handler.execute!(
      { node_type: "network", operation: "http_head", host: "example.com", port: 0, count: 3 } as any,
      make_ctx() as any,
    );
    expect(mock_run_shell).toHaveBeenCalledWith(
      expect.stringContaining("https://example.com"),
      expect.anything(),
    );
  });

  it("unsupported operation → success=false, error 포함", async () => {
    const r = await network_handler.execute!(
      { node_type: "network", operation: "traceroute", host: "x", port: 0, count: 3 } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
    expect((r.output as any).error).toContain("unsupported");
    expect(mock_run_shell).not.toHaveBeenCalled();
  });

  it("ping host 없음 → null cmd → success=false", async () => {
    const r = await network_handler.execute!(
      { node_type: "network", operation: "ping", host: "", port: 0, count: 3 } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });

  it("port_check host/port 없음 → null cmd → success=false", async () => {
    const r = await network_handler.execute!(
      { node_type: "network", operation: "port_check", host: "", port: 0, count: 3 } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });

  it("shell 오류 → success=false, error_message 반환", async () => {
    mock_run_shell.mockRejectedValue(new Error("timeout"));
    const r = await network_handler.execute!(
      { node_type: "network", operation: "ping", host: "host", port: 0, count: 3 } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
    expect((r.output as any).output).toContain("timeout");
  });

  it("host에 위험 문자 → 제거됨", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    await network_handler.execute!(
      { node_type: "network", operation: "ping", host: "ex;ample.com", port: 0, count: 3 } as any,
      make_ctx() as any,
    );
    const cmd: string = mock_run_shell.mock.calls[0][0];
    expect(cmd).not.toContain(";");
  });

  it("count 클램프: undefined → 기본값 3, 100 → 10", async () => {
    // count=undefined → n.count || 3 = 3 → Math.max(1,Math.min(10,3)) = 3
    mock_run_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    await network_handler.execute!(
      { node_type: "network", operation: "ping", host: "h", port: 0 } as any,
      make_ctx() as any,
    );
    expect(mock_run_shell.mock.calls[0][0]).toContain("-c 3");

    // count=100 → Math.min(10, 100) = 10
    mock_run_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    await network_handler.execute!(
      { node_type: "network", operation: "ping", host: "h", port: 0, count: 100 } as any,
      make_ctx() as any,
    );
    expect(mock_run_shell.mock.calls[1][0]).toContain("-c 10");
  });
});

// ══════════════════════════════════════════════════════════════
// network_handler — test()
// ══════════════════════════════════════════════════════════════

describe("network_handler — test()", () => {
  it("operation 없음 → 경고", () => {
    const r = network_handler.test!(
      { node_type: "network", operation: "", host: "", port: 0 } as any,
    );
    expect(r.warnings).toContain("operation is required");
  });

  it("ping host 없음 → 경고", () => {
    const r = network_handler.test!(
      { node_type: "network", operation: "ping", host: "", port: 0 } as any,
    );
    expect(r.warnings).toContain("host is required");
  });

  it("dns host 없음 → 경고", () => {
    const r = network_handler.test!(
      { node_type: "network", operation: "dns", host: "", port: 0 } as any,
    );
    expect(r.warnings).toContain("host is required");
  });

  it("http_head host 없음 → 경고", () => {
    const r = network_handler.test!(
      { node_type: "network", operation: "http_head", host: "", port: 0 } as any,
    );
    expect(r.warnings).toContain("host is required");
  });

  it("port_check host 없음 → host + port 경고", () => {
    const r = network_handler.test!(
      { node_type: "network", operation: "port_check", host: "", port: 0 } as any,
    );
    expect(r.warnings).toContain("host is required");
    expect(r.warnings).toContain("port is required");
  });

  it("port_check port 없음 → port 경고만", () => {
    const r = network_handler.test!(
      { node_type: "network", operation: "port_check", host: "example.com", port: 0 } as any,
    );
    expect(r.warnings).toContain("port is required");
    expect(r.warnings).not.toContain("host is required");
  });

  it("netstat → 경고 없음", () => {
    const r = network_handler.test!(
      { node_type: "network", operation: "netstat", host: "", port: 0 } as any,
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("모든 값 정상 → 경고 없음", () => {
    const r = network_handler.test!(
      { node_type: "network", operation: "ping", host: "example.com", port: 0 } as any,
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 operation/host/port 포함", () => {
    const r = network_handler.test!(
      { node_type: "network", operation: "ping", host: "myhost", port: 80 } as any,
    );
    expect((r.preview as any).operation).toBe("ping");
    expect((r.preview as any).host).toBe("myhost");
  });
});

// ══════════════════════════════════════════════════════════════
// package_manager_handler — execute
// ══════════════════════════════════════════════════════════════

describe("package_manager_handler — execute (npm)", () => {
  it("npm list → 성공", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "package@1.0.0", stderr: "" });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "list", manager: "npm", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
  });

  it("npm install — pkg 있음 → 성공", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "added", stderr: "" });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "install", manager: "npm", package_name: "lodash", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
    expect(mock_run_shell.mock.calls[0][0]).toContain("npm install lodash");
  });

  it("npm install — pkg 없음 → npm install (전체 설치)", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "install", manager: "npm", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect(mock_run_shell.mock.calls[0][0]).toBe("npm install");
  });

  it("npm uninstall — pkg 없음 → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "uninstall", manager: "npm", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
    expect(mock_run_shell).not.toHaveBeenCalled();
  });

  it("npm info — pkg 없음 → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "info", manager: "npm", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });

  it("npm audit → 성공", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "found 0 vulnerabilities", stderr: "" });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "audit", manager: "npm", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
  });

  it("npm outdated → 성공", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "Package Current", stderr: "" });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "outdated", manager: "npm", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
  });

  it("npm — unsupported op → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "freeze", manager: "npm", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });
});

describe("package_manager_handler — execute (pip)", () => {
  it("pip list → 성공", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "Package Version", stderr: "" });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "list", manager: "pip", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
  });

  it("pip install — pkg 없음 → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "install", manager: "pip", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });

  it("pip install — pkg 있음 → 성공", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "install", manager: "pip", package_name: "requests", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
    expect(mock_run_shell.mock.calls[0][0]).toContain("pip install requests");
  });

  it("pip uninstall — pkg 없음 → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "uninstall", manager: "pip", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });

  it("pip info — pkg 없음 → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "info", manager: "pip", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });

  it("pip audit (pip check) → 성공", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "No broken requirements found.", stderr: "" });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "audit", manager: "pip", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
  });
});

describe("package_manager_handler — execute (cargo)", () => {
  it("cargo list → 성공", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "serde v1.0.0", stderr: "" });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "list", manager: "cargo", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
  });

  it("cargo install — pkg 없음 → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "install", manager: "cargo", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });

  it("cargo uninstall — pkg 없음 → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "uninstall", manager: "cargo", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });

  it("cargo info — pkg 없음 → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "info", manager: "cargo", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
  });

  it("cargo info — pkg 있음 → 성공", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "serde = \"1.0\"", stderr: "" });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "info", manager: "cargo", package_name: "serde", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(true);
  });
});

describe("package_manager_handler — execute (미지원 manager)", () => {
  it("yarn → null cmd → success=false", async () => {
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "list", manager: "yarn", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
    expect((r.output as any).error).toContain("unsupported");
  });
});

describe("package_manager_handler — execute (shell 오류)", () => {
  it("run_shell_command throw → success=false, error_message 반환", async () => {
    mock_run_shell.mockRejectedValue(new Error("command not found"));
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "list", manager: "npm", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).success).toBe(false);
    expect((r.output as any).output).toContain("command not found");
  });

  it("stdout/stderr 공백 → (no output)", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "   ", stderr: "   " });
    const r = await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "list", manager: "npm", package_name: "", flags: "" } as any,
      make_ctx() as any,
    );
    expect((r.output as any).output).toBe("(no output)");
  });

  it("flags 적용 → cmd에 포함", async () => {
    mock_run_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    await package_manager_handler.execute!(
      { node_type: "package_manager", operation: "list", manager: "npm", package_name: "", flags: "--json" } as any,
      make_ctx() as any,
    );
    expect(mock_run_shell.mock.calls[0][0]).toContain("--json");
  });
});

// ══════════════════════════════════════════════════════════════
// package_manager_handler — test()
// ══════════════════════════════════════════════════════════════

describe("package_manager_handler — test()", () => {
  it("operation 없음 → 경고", () => {
    const r = package_manager_handler.test!(
      { node_type: "package_manager", operation: "", manager: "npm", package_name: "" } as any,
    );
    expect(r.warnings).toContain("operation is required");
  });

  it("install + pkg 없음 → package_name required", () => {
    const r = package_manager_handler.test!(
      { node_type: "package_manager", operation: "install", manager: "npm", package_name: "" } as any,
    );
    expect(r.warnings).toContain("package_name required");
  });

  it("uninstall + pkg 없음 → package_name required", () => {
    const r = package_manager_handler.test!(
      { node_type: "package_manager", operation: "uninstall", manager: "npm", package_name: "" } as any,
    );
    expect(r.warnings).toContain("package_name required");
  });

  it("info + pkg 없음 → package_name required", () => {
    const r = package_manager_handler.test!(
      { node_type: "package_manager", operation: "info", manager: "npm", package_name: "" } as any,
    );
    expect(r.warnings).toContain("package_name required");
  });

  it("list → 경고 없음", () => {
    const r = package_manager_handler.test!(
      { node_type: "package_manager", operation: "list", manager: "npm", package_name: "" } as any,
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("audit → 경고 없음", () => {
    const r = package_manager_handler.test!(
      { node_type: "package_manager", operation: "audit", manager: "npm", package_name: "" } as any,
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 manager/operation/package_name 포함", () => {
    const r = package_manager_handler.test!(
      { node_type: "package_manager", operation: "install", manager: "pip", package_name: "requests" } as any,
    );
    expect((r.preview as any).manager).toBe("pip");
    expect((r.preview as any).operation).toBe("install");
    expect((r.preview as any).package_name).toBe("requests");
  });
});
