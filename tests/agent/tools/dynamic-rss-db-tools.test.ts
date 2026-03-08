/**
 * DynamicShellTool 커버리지 — shell_escape / interpolate / requires_approval / 실행.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { DynamicShellTool } from "@src/agent/tools/dynamic.js";
import type { DynamicToolManifestEntry } from "@src/agent/tools/dynamic.js";

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

// run_shell_command 모킹
vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: vi.fn(),
}));

import * as shell_runtime from "@src/agent/tools/shell-runtime.js";
const mock_shell = shell_runtime.run_shell_command as ReturnType<typeof vi.fn>;

// secret-vault 모킹 — resolve_placeholders는 그대로 반환
vi.mock("@src/security/secret-vault-factory.js", () => ({
  get_shared_secret_vault: vi.fn().mockReturnValue({
    resolve_placeholders: vi.fn().mockImplementation((s: string) => Promise.resolve(s)),
    mask_known_secrets: vi.fn().mockImplementation((s: string) => Promise.resolve(s)),
  }),
}));

function make_entry(overrides?: Partial<DynamicToolManifestEntry>): DynamicToolManifestEntry {
  return {
    name: "my_tool",
    description: "Test dynamic tool",
    enabled: true,
    kind: "shell",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    command_template: "echo {{query}}",
    ...overrides,
  };
}

describe("DynamicShellTool — 메타데이터", () => {
  it("name은 entry.name", () => {
    const tool = new DynamicShellTool(make_entry({ name: "custom_search" }), "/tmp");
    expect(tool.name).toBe("custom_search");
  });
  it("category = external", () => {
    expect(new DynamicShellTool(make_entry(), "/tmp").category).toBe("external");
  });
  it("to_schema: function 형식", () => {
    expect(new DynamicShellTool(make_entry(), "/tmp").to_schema().type).toBe("function");
  });
});

describe("DynamicShellTool — requires_approval", () => {
  it("requires_approval=true + __approved 없음 → approval_required 반환", async () => {
    const tool = new DynamicShellTool(make_entry({ requires_approval: true }), "/tmp");
    const r = await tool.execute({ query: "test" });
    expect(r).toContain("approval_required");
    expect(r).toContain("__approved=true");
  });

  it("requires_approval=true + __approved=true → 실행됨", async () => {
    mock_shell.mockResolvedValue({ stdout: "done", stderr: "" });
    const tool = new DynamicShellTool(make_entry({ requires_approval: true }), "/tmp");
    const r = await tool.execute({ query: "test", __approved: true });
    expect(r).toBe("done");
  });
});

describe("DynamicShellTool — AbortSignal", () => {
  it("signal aborted → aborted 반환", async () => {
    const controller = new AbortController();
    controller.abort();
    const tool = new DynamicShellTool(make_entry(), "/tmp");
    const r = await tool.execute({ query: "test" }, { signal: controller.signal });
    expect(r).toContain("aborted");
  });
});

describe("DynamicShellTool — 실행 성공", () => {
  it("stdout만 있음 → stdout 반환", async () => {
    mock_shell.mockResolvedValue({ stdout: "hello world", stderr: "" });
    const tool = new DynamicShellTool(make_entry(), "/tmp");
    const r = await tool.execute({ query: "hello" });
    expect(r).toBe("hello world");
  });

  it("stdout 없음 → ok 반환", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const tool = new DynamicShellTool(make_entry(), "/tmp");
    const r = await tool.execute({ query: "" });
    expect(r).toBe("ok");
  });

  it("stderr만 있음 → stderr 반환", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "some warning" });
    const tool = new DynamicShellTool(make_entry(), "/tmp");
    const r = await tool.execute({ query: "test" });
    expect(r).toContain("stderr:");
    expect(r).toContain("some warning");
  });

  it("stdout + stderr → 둘 다 포함", async () => {
    mock_shell.mockResolvedValue({ stdout: "result", stderr: "warning" });
    const tool = new DynamicShellTool(make_entry(), "/tmp");
    const r = await tool.execute({ query: "test" });
    expect(r).toContain("result");
    expect(r).toContain("stderr:");
    expect(r).toContain("warning");
  });

  it("파라미터 보간 → command에 반영됨", async () => {
    mock_shell.mockResolvedValue({ stdout: "interpolated", stderr: "" });
    const tool = new DynamicShellTool(
      make_entry({ command_template: "grep '{{pattern}}' {{file}}" }),
      "/tmp",
    );
    await tool.execute({ pattern: "error", file: "/var/log/app.log" });
    const cmd = mock_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("error");
    expect(cmd).toContain("/var/log/app.log");
  });

  it("값 없는 파라미터 → 빈 문자열로 대체", async () => {
    mock_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    const tool = new DynamicShellTool(make_entry({ command_template: "cmd {{missing}}" }), "/tmp");
    await tool.execute({});
    const cmd = mock_shell.mock.calls[0][0] as string;
    expect(cmd).toBe("cmd ");
  });

  it("특수문자 포함 파라미터 → shell_escape 적용", async () => {
    mock_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    const tool = new DynamicShellTool(make_entry({ command_template: "echo {{text}}" }), "/tmp");
    await tool.execute({ text: "hello world; rm -rf" });
    const cmd = mock_shell.mock.calls[0][0] as string;
    // 따옴표로 감싸져야 함
    expect(cmd).toContain("'hello world; rm -rf'");
  });

  it("숫자 파라미터 → JSON 문자열로 변환", async () => {
    mock_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    const tool = new DynamicShellTool(make_entry({ command_template: "limit {{n}}" }), "/tmp");
    await tool.execute({ n: 42 });
    const cmd = mock_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("42");
  });

  it("안전한 문자열 파라미터 → 따옴표 없이 그대로", async () => {
    mock_shell.mockResolvedValue({ stdout: "ok", stderr: "" });
    const tool = new DynamicShellTool(make_entry({ command_template: "run {{path}}" }), "/tmp");
    await tool.execute({ path: "usr/local/bin" });
    const cmd = mock_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("usr/local/bin");
    expect(cmd).not.toContain("'");
  });
});
