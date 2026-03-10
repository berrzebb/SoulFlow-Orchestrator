/**
 * shell-runtime — L64 (as_record null) + L78 (parse_just_bash_output null) 커버리지.
 * just-bash가 JSON null 또는 배열을 출력하면 as_record가 null을 반환 → 폴백.
 */
import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";

const { mock_state, exec_fn, spawn_fn } = vi.hoisted(() => {
  const PROMISIFY_CUSTOM = Symbol.for("nodejs.util.promisify.custom");
  type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

  const state = {
    spawn_status: 0, // just-bash 있음
    exec_stdout: "null", // JSON.parse("null") = null → as_record null → L64, L78
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
  spawnSync: spawn_fn,
}));

const OPTS = { cwd: tmpdir(), timeout_ms: 5_000, max_buffer_bytes: 1024 * 1024 };

describe("shell-runtime — L64/L78: as_record null 경로", () => {
  it("just-bash stdout = 'null' → as_record(null) → L64 return null → L78 return null → raw fallback", async () => {
    // exec_stdout = "null" → JSON.parse("null") = null → as_record: !raw → return null (L64)
    // parse_just_bash_output: if (!rec) return null (L78) → use raw stdout
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    const result = await run_shell_command("echo test", OPTS);
    // parse_just_bash_output returns null → fallback to raw exec output
    expect(result.stdout).toBe("null");
  });

  it("just-bash stdout = '[1,2]' → as_record(array) → L64 Array.isArray → return null", async () => {
    mock_state.exec_stdout = '[1,2]';
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    const result = await run_shell_command("echo test", OPTS);
    expect(result.stdout).toBe('[1,2]');
  });
});
