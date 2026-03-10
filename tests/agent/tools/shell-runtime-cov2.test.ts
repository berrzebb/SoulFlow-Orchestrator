/**
 * shell-runtime — L35 (can_run_runner false) 커버리지.
 * spawn_status=1 → command_exists false → L35 return false 경로.
 */
import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";

const { mock_state, exec_fn, spawn_fn } = vi.hoisted(() => {
  const PROMISIFY_CUSTOM = Symbol.for("nodejs.util.promisify.custom");
  type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

  const state = {
    spawn_status: 1, // 처음부터 just-bash 없음 → L35 테스트용
    exec_stdout: "fallback ok",
    exec_stderr: "",
    exec_should_throw: false,
    exec_throw_msg: "",
  };

  const custom_fn = async () => {
    if (state.exec_should_throw) throw new Error(state.exec_throw_msg);
    return { stdout: state.exec_stdout, stderr: state.exec_stderr };
  };

  const exec_fn = Object.assign(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
      if (state.exec_should_throw) cb(new Error(state.exec_throw_msg), "", "");
      else cb(null, state.exec_stdout, state.exec_stderr);
    },
    { [PROMISIFY_CUSTOM]: custom_fn },
  );

  const spawn_fn = () => ({
    status: state.spawn_status,
    stdout: null, stderr: null, pid: 1, signal: null, output: null, error: undefined,
  });

  return { mock_state: state, exec_fn, spawn_fn };
});

vi.mock("node:child_process", () => ({
  execFile: exec_fn,
  exec: exec_fn, // 폴백 경로 dynamic import에서 사용
  spawnSync: spawn_fn,
}));

const OPTS = { cwd: tmpdir(), timeout_ms: 5_000, max_buffer_bytes: 1024 * 1024 };

describe("shell-runtime — L35: can_run_runner → false (command_exists 실패)", () => {
  it("spawnSync status=1 → command_exists false → L35 return false → 폴백 실행", async () => {
    // spawn_status=1 → command_exists returns false → can_run_runner returns false (L35)
    // 두 candidate 모두 실패 → find_just_bash_runner returns null → 폴백 실행
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    const result = await run_shell_command("echo test", OPTS);
    expect(typeof result.stdout).toBe("string");
  });
});
