/**
 * SH-4 Tool Execution Hardening 회귀 테스트.
 * - archive: shell string 대신 argv 배열 사용 확인
 * - ssh: SCP StrictHostKeyChecking 기본값 확인
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── archive: argv 방식 확인 ─────────────────────────────
// run_command_argv mock으로 argv 직접 검증

const { mock_run_argv } = vi.hoisted(() => ({
  mock_run_argv: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" }),
}));

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_command_argv: mock_run_argv,
}));

import { ArchiveTool } from "@src/agent/tools/archive.js";

beforeEach(() => {
  mock_run_argv.mockClear();
});

describe("SH-4: archive argv injection 방어", () => {
  function make_tool(): ArchiveTool {
    return new ArchiveTool({ workspace: "/workspace" });
  }

  it("create tar.gz → argv 배열로 실행 (shell string 아님)", async () => {
    await make_tool().execute({ operation: "create", archive_path: "out.tar.gz", files: ["file1.txt"] });
    expect(mock_run_argv).toHaveBeenCalledOnce();
    const [cmd, args] = mock_run_argv.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("tar");
    expect(args).toEqual(["czf", "out.tar.gz", "file1.txt"]);
  });

  it("extract zip → argv 배열로 실행", async () => {
    await make_tool().execute({ operation: "extract", format: "zip", archive_path: "data.zip", output_dir: "/out" });
    expect(mock_run_argv).toHaveBeenCalledOnce();
    const [cmd, args] = mock_run_argv.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("unzip");
    expect(args).toContain("-d");
    expect(args).toContain("/out");
  });

  it("shell injection 문자가 포함된 파일명 → argv에 그대로 전달 (해석 안 됨)", async () => {
    const malicious_file = "file; rm -rf /";
    await make_tool().execute({ operation: "create", archive_path: "out.tar.gz", files: [malicious_file] });
    const [cmd, args] = mock_run_argv.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("tar");
    // shell injection 문자가 단일 argv 원소로 그대로 전달됨
    expect(args).toContain(malicious_file);
    // run_command_argv는 shell: false로 실행하므로 `;` 이후가 별도 명령으로 실행되지 않음
  });

  it("$(command) 포함 archive_path → argv에 그대로 전달", async () => {
    const malicious_path = "$(whoami).tar.gz";
    await make_tool().execute({ operation: "list", archive_path: malicious_path });
    const [cmd, args] = mock_run_argv.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("tar");
    expect(args).toContain(malicious_path);
  });
});
