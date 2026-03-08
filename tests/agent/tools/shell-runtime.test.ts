/**
 * shell-runtime 커버리지 — run_shell_command (시스템 셸 폴백).
 * just-bash가 없는 환경에서 시스템 셸을 통해 실행.
 */
import { describe, it, expect } from "vitest";
import { run_shell_command } from "@src/agent/tools/shell-runtime.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const cwd = mkdtempSync(join(tmpdir(), "shell-runtime-test-"));

describe("run_shell_command — 기본 실행", () => {
  it("echo 명령 실행 → stdout 반환", async () => {
    const { stdout } = await run_shell_command("echo hello", {
      cwd,
      timeout_ms: 10_000,
      max_buffer_bytes: 1024 * 1024,
    });
    expect(stdout.trim()).toBe("hello");
  });

  it("멀티라인 출력", async () => {
    const { stdout } = await run_shell_command("echo line1 && echo line2", {
      cwd,
      timeout_ms: 10_000,
      max_buffer_bytes: 1024 * 1024,
    });
    expect(stdout).toContain("line1");
    expect(stdout).toContain("line2");
  });

  it("stderr 캡처", async () => {
    // stderr에 출력 (2>&1 없이)
    const result = await run_shell_command("echo errtext 1>&2", {
      cwd,
      timeout_ms: 10_000,
      max_buffer_bytes: 1024 * 1024,
    });
    // stderr 또는 stdout에 텍스트 있음
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("errtext");
  });

  it("존재하지 않는 명령 → 예외 발생", async () => {
    await expect(
      run_shell_command("nonexistent_command_xyz_abc", {
        cwd,
        timeout_ms: 10_000,
        max_buffer_bytes: 1024 * 1024,
      }),
    ).rejects.toThrow();
  });

  it("cwd 옵션 적용 → pwd 출력에 cwd 포함", async () => {
    const { stdout } = await run_shell_command("pwd", {
      cwd,
      timeout_ms: 10_000,
      max_buffer_bytes: 1024 * 1024,
    });
    // 경로 구분자 정규화 (Windows/Linux 호환)
    expect(stdout.toLowerCase().replace(/\\/g, "/")).toContain(
      cwd.toLowerCase().replace(/\\/g, "/").split("/").pop()!
    );
  });

  it("exit code 0 → 정상 반환", async () => {
    const { stdout } = await run_shell_command("exit 0", {
      cwd,
      timeout_ms: 10_000,
      max_buffer_bytes: 1024 * 1024,
    });
    expect(typeof stdout).toBe("string");
  });

  it("AbortSignal already aborted → 예외 발생", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      run_shell_command("echo test", {
        cwd,
        timeout_ms: 10_000,
        max_buffer_bytes: 1024 * 1024,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

// cleanup
import { afterAll } from "vitest";
afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});
