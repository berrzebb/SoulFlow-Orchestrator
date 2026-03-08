/**
 * PackageManagerTool — shell-runtime mock 기반 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mock_run } = vi.hoisted(() => ({
  mock_run: vi.fn(),
}));

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: mock_run,
}));

// fs.existsSync mock — detect_manager 제어
const { mock_exists } = vi.hoisted(() => ({
  mock_exists: vi.fn().mockReturnValue(false),
}));

vi.mock("node:fs", () => ({
  existsSync: mock_exists,
}));

import { PackageManagerTool } from "@src/agent/tools/package-manager.js";

const WS = "/tmp/workspace";
function make_tool() { return new PackageManagerTool({ workspace: WS }); }

function ok(stdout: string) {
  return mock_run.mockResolvedValueOnce({ stdout, stderr: "" });
}

function err(msg: string) {
  return mock_run.mockResolvedValueOnce({ stdout: "", stderr: msg });
}

beforeEach(() => {
  vi.clearAllMocks();
  mock_exists.mockReturnValue(false); // 기본: package.json 없음
});

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("PackageManagerTool — 메타데이터", () => {
  it("name = package_manager", () => expect(make_tool().name).toBe("package_manager"));
  it("category = shell", () => expect(make_tool().category).toBe("shell"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// detect_manager — 자동 감지
// ══════════════════════════════════════════

describe("PackageManagerTool — 패키지 매니저 자동 감지", () => {
  it("package.json 있음 → npm", async () => {
    mock_exists.mockImplementation((p: string) => p.endsWith("package.json"));
    ok("react@18.0.0");
    const r = await make_tool().execute({ operation: "list" });
    expect(mock_run).toHaveBeenCalledWith(
      expect.stringContaining("npm"),
      expect.anything(),
    );
  });

  it("requirements.txt 있음 → pip", async () => {
    mock_exists.mockImplementation((p: string) => p.endsWith("requirements.txt"));
    ok("requests==2.28.0");
    const r = await make_tool().execute({ operation: "list" });
    expect(mock_run).toHaveBeenCalledWith(
      expect.stringContaining("pip"),
      expect.anything(),
    );
  });

  it("Cargo.toml 있음 → cargo", async () => {
    mock_exists.mockImplementation((p: string) => p.endsWith("Cargo.toml"));
    ok("tokio v1.0.0");
    const r = await make_tool().execute({ operation: "list" });
    expect(mock_run).toHaveBeenCalledWith(
      expect.stringContaining("cargo"),
      expect.anything(),
    );
  });

  it("아무 파일도 없음 → npm 기본", async () => {
    ok("(no output)");
    await make_tool().execute({ operation: "list" });
    expect(mock_run).toHaveBeenCalledWith(
      expect.stringContaining("npm"),
      expect.anything(),
    );
  });
});

// ══════════════════════════════════════════
// npm 명령어
// ══════════════════════════════════════════

describe("PackageManagerTool — npm 명령어", () => {
  it("list → npm list --depth=0", async () => {
    ok("react@18.0.0\nlodash@4.17.21");
    const r = await make_tool().execute({ operation: "list", manager: "npm" });
    expect(r).toContain("react");
    expect(mock_run).toHaveBeenCalledWith("npm list --depth=0", expect.anything());
  });

  it("install 패키지명 있음", async () => {
    ok("added 1 package");
    await make_tool().execute({ operation: "install", manager: "npm", package_name: "express" });
    expect(mock_run).toHaveBeenCalledWith("npm install express", expect.anything());
  });

  it("install 패키지명 없음 → npm install", async () => {
    ok("added 100 packages");
    await make_tool().execute({ operation: "install", manager: "npm" });
    expect(mock_run).toHaveBeenCalledWith("npm install", expect.anything());
  });

  it("uninstall 패키지명 없음 → 에러 (null cmd)", async () => {
    const r = await make_tool().execute({ operation: "uninstall", manager: "npm" });
    expect(r).toContain("Error");
    expect(mock_run).not.toHaveBeenCalled();
  });

  it("uninstall 패키지명 있음", async () => {
    ok("removed 1 package");
    await make_tool().execute({ operation: "uninstall", manager: "npm", package_name: "lodash" });
    expect(mock_run).toHaveBeenCalledWith("npm uninstall lodash", expect.anything());
  });

  it("audit", async () => {
    ok("found 0 vulnerabilities");
    await make_tool().execute({ operation: "audit", manager: "npm" });
    expect(mock_run).toHaveBeenCalledWith("npm audit", expect.anything());
  });

  it("outdated", async () => {
    ok("Package  Current  Wanted");
    await make_tool().execute({ operation: "outdated", manager: "npm" });
    expect(mock_run).toHaveBeenCalledWith("npm outdated", expect.anything());
  });

  it("info 패키지명 있음", async () => {
    ok("express@4.18.0 — Fast web framework");
    await make_tool().execute({ operation: "info", manager: "npm", package_name: "express" });
    expect(mock_run).toHaveBeenCalledWith("npm info express", expect.anything());
  });

  it("flags 포함", async () => {
    ok("added 1 package");
    await make_tool().execute({ operation: "install", manager: "npm", package_name: "jest", flags: "--save-dev" });
    expect(mock_run).toHaveBeenCalledWith("npm install jest --save-dev", expect.anything());
  });
});

// ══════════════════════════════════════════
// pip 명령어
// ══════════════════════════════════════════

describe("PackageManagerTool — pip 명령어", () => {
  it("list", async () => {
    ok("requests 2.28.0");
    await make_tool().execute({ operation: "list", manager: "pip" });
    expect(mock_run).toHaveBeenCalledWith("pip list", expect.anything());
  });

  it("install 패키지명 없음 → Error", async () => {
    const r = await make_tool().execute({ operation: "install", manager: "pip" });
    expect(r).toContain("Error");
  });

  it("install 패키지명 있음", async () => {
    ok("Successfully installed requests-2.28.0");
    await make_tool().execute({ operation: "install", manager: "pip", package_name: "requests" });
    expect(mock_run).toHaveBeenCalledWith("pip install requests", expect.anything());
  });

  it("uninstall", async () => {
    ok("Successfully uninstalled requests-2.28.0");
    await make_tool().execute({ operation: "uninstall", manager: "pip", package_name: "requests" });
    expect(mock_run).toHaveBeenCalledWith("pip uninstall -y requests", expect.anything());
  });

  it("audit → pip check", async () => {
    ok("No broken requirements found.");
    await make_tool().execute({ operation: "audit", manager: "pip" });
    expect(mock_run).toHaveBeenCalledWith("pip check", expect.anything());
  });

  it("outdated → pip list --outdated", async () => {
    ok("requests  2.28.0  2.30.0");
    await make_tool().execute({ operation: "outdated", manager: "pip" });
    expect(mock_run).toHaveBeenCalledWith("pip list --outdated", expect.anything());
  });

  it("info", async () => {
    ok("Name: requests\nVersion: 2.28.0");
    await make_tool().execute({ operation: "info", manager: "pip", package_name: "requests" });
    expect(mock_run).toHaveBeenCalledWith("pip show requests", expect.anything());
  });
});

// ══════════════════════════════════════════
// cargo 명령어
// ══════════════════════════════════════════

describe("PackageManagerTool — cargo 명령어", () => {
  it("list → cargo install --list", async () => {
    ok("tokio v1.0.0:");
    await make_tool().execute({ operation: "list", manager: "cargo" });
    expect(mock_run).toHaveBeenCalledWith("cargo install --list", expect.anything());
  });

  it("install → cargo add", async () => {
    ok("Adding tokio v1.28.0");
    await make_tool().execute({ operation: "install", manager: "cargo", package_name: "tokio" });
    expect(mock_run).toHaveBeenCalledWith("cargo add tokio", expect.anything());
  });

  it("uninstall → cargo remove", async () => {
    ok("Removing tokio");
    await make_tool().execute({ operation: "uninstall", manager: "cargo", package_name: "tokio" });
    expect(mock_run).toHaveBeenCalledWith("cargo remove tokio", expect.anything());
  });

  it("audit → cargo audit", async () => {
    ok("0 vulnerabilities found");
    await make_tool().execute({ operation: "audit", manager: "cargo" });
    expect(mock_run).toHaveBeenCalledWith("cargo audit", expect.anything());
  });

  it("outdated → cargo outdated", async () => {
    ok("tokio  1.0.0  1.28.0");
    await make_tool().execute({ operation: "outdated", manager: "cargo" });
    expect(mock_run).toHaveBeenCalledWith("cargo outdated", expect.anything());
  });

  it("info → cargo search", async () => {
    ok("tokio = \"1.28.0\"");
    await make_tool().execute({ operation: "info", manager: "cargo", package_name: "tokio" });
    expect(mock_run).toHaveBeenCalledWith("cargo search tokio --limit 5", expect.anything());
  });
});

// ══════════════════════════════════════════
// 에러 처리
// ══════════════════════════════════════════

describe("PackageManagerTool — 에러 처리", () => {
  it("shell 실행 실패 → Error 반환", async () => {
    mock_run.mockRejectedValueOnce(new Error("command not found: npm"));
    const r = await make_tool().execute({ operation: "list", manager: "npm" });
    expect(r).toContain("Error");
    expect(r).toContain("command not found");
  });

  it("stderr 있을 때 STDERR 포함", async () => {
    mock_run.mockResolvedValueOnce({ stdout: "some output", stderr: "npm WARN deprecated" });
    const r = await make_tool().execute({ operation: "list", manager: "npm" });
    expect(r).toContain("some output");
    expect(r).toContain("STDERR");
    expect(r).toContain("npm WARN deprecated");
  });

  it("출력 없을 때 (no output) 반환", async () => {
    mock_run.mockResolvedValueOnce({ stdout: "", stderr: "" });
    const r = await make_tool().execute({ operation: "list", manager: "npm" });
    expect(r).toBe("(no output)");
  });

  it("출력 20000자 초과 → truncated", async () => {
    const long = "x".repeat(25_000);
    mock_run.mockResolvedValueOnce({ stdout: long, stderr: "" });
    const r = await make_tool().execute({ operation: "list", manager: "npm" });
    expect(r).toContain("truncated");
    expect(r.length).toBeLessThan(25_000);
  });

  it("signal aborted → Error: cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await make_tool().execute({ operation: "list", manager: "npm" }, { signal: ctrl.signal } as any);
    expect(r).toBe("Error: cancelled");
    expect(mock_run).not.toHaveBeenCalled();
  });
});
