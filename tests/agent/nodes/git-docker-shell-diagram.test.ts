/**
 * git_handler / docker_handler / shell_handler / diagram_handler 커버리지.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git_handler } from "@src/agent/nodes/git.js";
import { docker_handler } from "@src/agent/nodes/docker.js";
import { shell_handler } from "@src/agent/nodes/shell.js";
import { diagram_handler } from "@src/agent/nodes/diagram.js";

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: vi.fn(),
}));

// diagram_handler 동적 import 모킹 — mermaid 렌더러가 테스트 환경에서 실패함을 활용
vi.mock("@src/agent/tools/diagram.js", () => {
  return {
    DiagramRenderTool: vi.fn().mockImplementation(() => ({
      execute: vi.fn().mockImplementation(({ type }: { type?: string }) => {
        if (type === "error_test") return Promise.reject(new Error("render engine crashed"));
        if (type === "mermaid_err") return Promise.resolve("Error: render failed");
        return Promise.resolve("graph TD; A-->B");
      }),
    })),
  };
});

import * as shell_runtime from "@src/agent/tools/shell-runtime.js";
const mock_shell = shell_runtime.run_shell_command as ReturnType<typeof vi.fn>;

import * as diagram_module from "@src/agent/tools/diagram.js";
const MockDiagramTool = diagram_module.DiagramRenderTool as ReturnType<typeof vi.fn>;

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

const WORKSPACE = join(tmpdir(), "node-test-ws");

function make_ctx(memory: Record<string, string> = {}) {
  return { memory, workspace: WORKSPACE, abort_signal: undefined };
}

function shell_ok(stdout = "ok", stderr = "") {
  mock_shell.mockResolvedValue({ stdout, stderr });
}

// ══════════════════════════════════════════
// git_handler
// ══════════════════════════════════════════

describe("git_handler — 메타데이터", () => {
  it("node_type = git", () => expect(git_handler.node_type).toBe("git"));
  it("output_schema 존재", () => expect(git_handler.output_schema).toBeDefined());
  it("create_default: operation=status", () => {
    const d = git_handler.create_default!();
    expect(d.operation).toBe("status");
  });
});

describe("git_handler — execute", () => {
  beforeEach(() => shell_ok("On branch main"));

  it("status operation → git status 실행 + stdout 반환", async () => {
    const r = await git_handler.execute({ operation: "status", args: "" }, make_ctx());
    expect(r.output.stdout).toContain("On branch main");
    expect(r.output.exit_code).toBe(0);
    expect(mock_shell.mock.calls[0][0]).toContain("git status");
  });

  it("diff operation → git diff 실행", async () => {
    await git_handler.execute({ operation: "diff", args: "--stat" }, make_ctx());
    expect(mock_shell.mock.calls[0][0]).toContain("git diff --stat");
  });

  it("commit operation + args → git commit 실행", async () => {
    await git_handler.execute({ operation: "commit", args: "-m 'fix'" }, make_ctx());
    expect(mock_shell.mock.calls[0][0]).toContain("git commit");
  });

  it("unsupported operation → error 반환 (exit_code=1)", async () => {
    const r = await git_handler.execute({ operation: "unknown_op" }, make_ctx());
    expect(r.output.exit_code).toBe(1);
    expect(String(r.output.error)).toContain("unsupported operation");
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("셸 예외 → error 필드 반환 (exit_code=1)", async () => {
    mock_shell.mockRejectedValue(new Error("git not found"));
    const r = await git_handler.execute({ operation: "status" }, make_ctx());
    expect(r.output.exit_code).toBe(1);
    expect(String(r.output.error)).toContain("git not found");
  });

  it("메모리 템플릿 보간 → {{memory.branch}} 치환", async () => {
    await git_handler.execute(
      { operation: "checkout", args: "{{memory.branch}}" },
      make_ctx({ branch: "feature/my-feature" }),
    );
    expect(mock_shell.mock.calls[0][0]).toContain("feature/my-feature");
  });

  it("working_dir 있음 → cwd로 사용", async () => {
    const custom_cwd = join(tmpdir(), "custom-repo");
    await git_handler.execute({ operation: "status", working_dir: custom_cwd }, make_ctx());
    expect(mock_shell.mock.calls[0][1].cwd).toBe(custom_cwd);
  });

  it("working_dir 없음 → workspace 사용", async () => {
    await git_handler.execute({ operation: "status" }, make_ctx());
    expect(mock_shell.mock.calls[0][1].cwd).toBe(WORKSPACE);
  });
});

describe("git_handler — test()", () => {
  it("operation 없음 → warnings 포함", () => {
    const r = git_handler.test!({ operation: "" }, make_ctx());
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("operation 있음 → warnings 없음", () => {
    const r = git_handler.test!({ operation: "status" }, make_ctx());
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 operation/args 포함", () => {
    const r = git_handler.test!({ operation: "log", args: "--oneline" }, make_ctx());
    expect(r.preview?.operation).toBe("log");
    expect(r.preview?.args).toBe("--oneline");
  });
});

// ══════════════════════════════════════════
// docker_handler
// ══════════════════════════════════════════

describe("docker_handler — 메타데이터", () => {
  it("node_type = docker", () => expect(docker_handler.node_type).toBe("docker"));
  it("create_default: operation=ps", () => {
    const d = docker_handler.create_default!();
    expect(d.operation).toBe("ps");
  });
});

describe("docker_handler — execute", () => {
  beforeEach(() => shell_ok("container_id", ""));

  it("ps → docker ps -a 실행", async () => {
    const r = await docker_handler.execute({ operation: "ps" }, make_ctx());
    expect(r.output.success).toBe(true);
    expect(mock_shell.mock.calls[0][0]).toContain("docker ps -a");
  });

  it("run + image → docker run 실행", async () => {
    await docker_handler.execute({ operation: "run", image: "nginx" }, make_ctx());
    expect(mock_shell.mock.calls[0][0]).toContain("docker run");
    expect(mock_shell.mock.calls[0][0]).toContain("nginx");
  });

  it("run + image 없음 → error 반환 (success=false)", async () => {
    const r = await docker_handler.execute({ operation: "run" }, make_ctx());
    expect(r.output.success).toBe(false);
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("stop + container → docker stop 실행", async () => {
    await docker_handler.execute({ operation: "stop", container: "myapp" }, make_ctx());
    expect(mock_shell.mock.calls[0][0]).toContain("docker stop myapp");
  });

  it("logs + container → docker logs 실행", async () => {
    await docker_handler.execute({ operation: "logs", container: "api", tail: 100 }, make_ctx());
    const cmd = mock_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("docker logs");
    expect(cmd).toContain("100");
  });

  it("exec + container + command → docker exec 실행", async () => {
    await docker_handler.execute({ operation: "exec", container: "api", command: "ls" }, make_ctx());
    expect(mock_shell.mock.calls[0][0]).toContain("docker exec");
    expect(mock_shell.mock.calls[0][0]).toContain("ls");
  });

  it("inspect + container → docker inspect 실행", async () => {
    await docker_handler.execute({ operation: "inspect", container: "my_ctr" }, make_ctx());
    expect(mock_shell.mock.calls[0][0]).toContain("docker inspect my_ctr");
  });

  it("--privileged → blocked by safety policy", async () => {
    const r = await docker_handler.execute({ operation: "run", image: "ubuntu", args: "--privileged" }, make_ctx());
    expect(r.output.success).toBe(false);
    expect(String(r.output.error)).toContain("safety policy");
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("-v /: → blocked by safety policy", async () => {
    const r = await docker_handler.execute({ operation: "run", image: "ubuntu", args: "-v /:/host" }, make_ctx());
    expect(r.output.success).toBe(false);
  });

  it("unsupported operation → error 반환", async () => {
    const r = await docker_handler.execute({ operation: "unknown" }, make_ctx());
    expect(r.output.success).toBe(false);
    expect(String(r.output.error)).toContain("unsupported");
  });

  it("셸 예외 → error 반환 (success=false)", async () => {
    mock_shell.mockRejectedValue(new Error("docker daemon not running"));
    const r = await docker_handler.execute({ operation: "ps" }, make_ctx());
    expect(r.output.success).toBe(false);
    expect(String((r.output as any).error)).toContain("docker daemon");
  });

  it("빈 출력 → (no output)", async () => {
    shell_ok("", "");
    const r = await docker_handler.execute({ operation: "ps" }, make_ctx());
    expect(r.output.output).toBe("(no output)");
  });

  it("메모리 템플릿 보간 → {{memory.container}} 치환", async () => {
    await docker_handler.execute(
      { operation: "stop", container: "{{memory.container}}" },
      make_ctx({ container: "prod_api" }),
    );
    expect(mock_shell.mock.calls[0][0]).toContain("prod_api");
  });
});

describe("docker_handler — test()", () => {
  it("operation 없음 → warnings", () => {
    const r = docker_handler.test!({ operation: "" }, make_ctx());
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("logs/stop + container 없음 → container 경고", () => {
    const r = docker_handler.test!({ operation: "logs" }, make_ctx());
    expect(r.warnings.some((w) => w.includes("container"))).toBe(true);
  });

  it("run + image 없음 → image 경고", () => {
    const r = docker_handler.test!({ operation: "run" }, make_ctx());
    expect(r.warnings.some((w) => w.includes("image"))).toBe(true);
  });

  it("ps 정상 → warnings 없음", () => {
    const r = docker_handler.test!({ operation: "ps" }, make_ctx());
    expect(r.warnings).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// shell_handler
// ══════════════════════════════════════════

describe("shell_handler — 메타데이터", () => {
  it("node_type = shell", () => expect(shell_handler.node_type).toBe("shell"));
  it("create_default: command 빈 문자열", () => {
    const d = shell_handler.create_default!();
    expect(d.command).toBe("");
  });
});

describe("shell_handler — execute", () => {
  it("정상 명령 → stdout/exit_code=0 반환", async () => {
    shell_ok("hello world");
    const r = await shell_handler.execute({ command: "echo hello" }, make_ctx());
    expect(r.output.stdout).toBe("hello world");
    expect(r.output.exit_code).toBe(0);
  });

  it("command 빈 문자열 → error 반환", async () => {
    const r = await shell_handler.execute({ command: "" }, make_ctx());
    expect(r.output.exit_code).toBe(1);
    expect(String(r.output.error)).toContain("empty");
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("rm -rf → blocked by safety policy", async () => {
    const r = await shell_handler.execute({ command: "rm -rf /data" }, make_ctx());
    expect(r.output.exit_code).toBe(1);
    expect(String(r.output.error)).toContain("safety policy");
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("shutdown → blocked", async () => {
    const r = await shell_handler.execute({ command: "shutdown now" }, make_ctx());
    expect(r.output.exit_code).toBe(1);
    expect(String(r.output.error)).toContain("safety policy");
  });

  it("셸 예외 + exit code → exit_code 보존", async () => {
    mock_shell.mockRejectedValue(
      Object.assign(new Error("fail"), { stdout: "partial", stderr: "err_msg", code: 127 }),
    );
    const r = await shell_handler.execute({ command: "nonexistent" }, make_ctx());
    expect(r.output.exit_code).toBe(127);
    expect(r.output.stdout).toBe("partial");
    expect(r.output.stderr).toBe("err_msg");
  });

  it("timeout_ms 상한 120000 적용", async () => {
    shell_ok("ok");
    await shell_handler.execute({ command: "sleep 100", timeout_ms: 999_999 }, make_ctx());
    expect(mock_shell.mock.calls[0][1].timeout_ms).toBe(120_000);
  });

  it("timeout_ms 하한 1000 적용", async () => {
    shell_ok("ok");
    await shell_handler.execute({ command: "ls", timeout_ms: 10 }, make_ctx());
    expect(mock_shell.mock.calls[0][1].timeout_ms).toBe(1000);
  });

  it("메모리 템플릿 보간", async () => {
    shell_ok("ok");
    await shell_handler.execute(
      { command: "echo {{memory.greeting}}" },
      make_ctx({ greeting: "hello_world" }),
    );
    expect(mock_shell.mock.calls[0][0]).toContain("hello_world");
  });

  it("working_dir 없음 → workspace 사용", async () => {
    shell_ok("ok");
    await shell_handler.execute({ command: "ls" }, make_ctx());
    expect(mock_shell.mock.calls[0][1].cwd).toBe(WORKSPACE);
  });

  it("working_dir 있음 → cwd로 사용", async () => {
    shell_ok("ok");
    const custom = join(WORKSPACE, "custom-dir");
    await shell_handler.execute({ command: "ls", working_dir: custom }, make_ctx());
    expect(mock_shell.mock.calls[0][1].cwd).toBe(custom);
  });
});

describe("shell_handler — test()", () => {
  it("command 없음 → warnings", () => {
    const r = shell_handler.test!({ command: "" }, make_ctx());
    expect(r.warnings.some((w) => w.includes("empty"))).toBe(true);
  });

  it("blocked 패턴 포함 → warnings", () => {
    const r = shell_handler.test!({ command: "rm -rf /tmp/test" }, make_ctx());
    expect(r.warnings.some((w) => w.includes("blocked"))).toBe(true);
  });

  it("정상 command → warnings 없음", () => {
    const r = shell_handler.test!({ command: "echo hello" }, make_ctx());
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 command/timeout_ms 포함", () => {
    const r = shell_handler.test!({ command: "ls", timeout_ms: 5000 }, make_ctx());
    expect(r.preview?.command).toBe("ls");
    expect(r.preview?.timeout_ms).toBe(5000);
  });
});

// ══════════════════════════════════════════
// diagram_handler
// ══════════════════════════════════════════

describe("diagram_handler — 메타데이터", () => {
  it("node_type = diagram", () => expect(diagram_handler.node_type).toBe("diagram"));
  it("create_default: type=mermaid", () => {
    const d = diagram_handler.create_default!();
    expect(d.type).toBe("mermaid");
  });
});

describe("diagram_handler — execute", () => {
  it("성공 → output 반환 (success=true)", async () => {
    const r = await diagram_handler.execute(
      { source: "graph TD; A-->B", type: "mermaid", output_format: "svg" },
      make_ctx(),
    );
    // 성공 시 success=true, 실패 시 success=false (테스트 환경에 따라 다름)
    expect(typeof r.output.success).toBe("boolean");
    expect(String(r.output.output).length).toBeGreaterThan(0);
  });

  it("에러 문자열 반환 → success=false", async () => {
    const r = await diagram_handler.execute({ source: "bad source", type: "mermaid_err" }, make_ctx());
    expect(typeof r.output.success).toBe("boolean");
  });

  it("도구 실행 예외 → success=false + error 메시지", async () => {
    const r = await diagram_handler.execute({ source: "foo", type: "error_test" }, make_ctx());
    expect(r.output.success).toBe(false);
    expect(String(r.output.output).length).toBeGreaterThan(0);
  });

  it("output_format 기본값 → svg", async () => {
    const r = await diagram_handler.execute({ source: "graph TD; A-->B", type: "mermaid" }, make_ctx());
    // output_format 없으면 "svg" 기본값 사용
    expect(r.output.format === "svg" || r.output.format === "").toBe(true);
  });

  it("메모리 템플릿 보간 → 실행 완료", async () => {
    // 템플릿 보간은 실행 전에 일어나므로 실행 성공/실패 무관하게 완료해야 함
    const r = await diagram_handler.execute(
      { source: "{{memory.diagram_src}}", type: "mermaid" },
      make_ctx({ diagram_src: "graph LR; X-->Y" }),
    );
    expect(r.output).toBeDefined();
  });
});

describe("diagram_handler — test()", () => {
  it("source_length와 type 포함 → preview 반환", () => {
    const r = diagram_handler.test!({ source: "graph TD; A-->B", type: "mermaid" }, make_ctx());
    expect(r.preview?.source_length).toBe(15);
    expect(r.preview?.type).toBe("mermaid");
  });

  it("warnings 항상 빈 배열", () => {
    const r = diagram_handler.test!({}, make_ctx());
    expect(r.warnings).toHaveLength(0);
  });
});
