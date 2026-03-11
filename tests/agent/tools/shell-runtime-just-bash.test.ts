/**
 * shell-runtime — just-bash 경로 mock 테스트.
 * spawnSync/execFile을 mock하여 just-bash 설치 시 동작 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tmpdir } from "node:os";

// ── mock 초기화 ────────────────────────────────────────────
// vi.hoisted()로 mock 상태를 factory 실행 전에 생성

const { mock_state, exec_fn, spawn_fn } = vi.hoisted(() => {
  const PROMISIFY_CUSTOM = Symbol.for("nodejs.util.promisify.custom");

  type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

  const state = {
    spawn_status: 0,       // spawnSync 반환 상태 (0=성공)
    exec_stdout: "",       // execFile stdout
    exec_stderr: "",       // execFile stderr
    exec_should_throw: false as boolean,
    exec_throw_msg: "",
  };

  const custom_fn = async () => {
    if (state.exec_should_throw) {
      throw Object.assign(new Error(state.exec_throw_msg), { stderr: state.exec_stderr, stdout: state.exec_stdout });
    }
    return { stdout: state.exec_stdout, stderr: state.exec_stderr };
  };

  const exec_fn = Object.assign(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
      if (state.exec_should_throw) cb(new Error(state.exec_throw_msg), "", state.exec_stderr);
      else cb(null, state.exec_stdout, state.exec_stderr);
    },
    { [PROMISIFY_CUSTOM]: custom_fn },
  );

  const spawn_fn = () => ({ status: state.spawn_status, stdout: null, stderr: null, pid: 1, signal: null, output: null, error: undefined });

  return { mock_state: state, exec_fn, spawn_fn };
});

vi.mock("node:child_process", () => ({
  execFile: exec_fn,
  exec: exec_fn,   // NO_JUST_BASH 환경에서 exec 폴백 경로도 커버
  spawnSync: spawn_fn,
}));

// CI에서 NO_JUST_BASH=1이 설정돼 있을 수 있음 — just-bash mock 경로 테스트 전에 해제
delete process.env.NO_JUST_BASH;

// ── 헬퍼 ──────────────────────────────────────────────────

function set_just_bash_available(stdout: string): void {
  mock_state.spawn_status = 0;
  mock_state.exec_stdout = stdout;
  mock_state.exec_stderr = "";
  mock_state.exec_should_throw = false;
}

function set_just_bash_unavailable(): void {
  mock_state.spawn_status = 1;
}

function set_exec_throw(msg: string, stderr = ""): void {
  mock_state.exec_should_throw = true;
  mock_state.exec_throw_msg = msg;
  mock_state.exec_stderr = stderr;
}

const OPTS = { cwd: tmpdir(), timeout_ms: 5_000, max_buffer_bytes: 1024 * 1024 };

// just-bash 없음 경로는 실제 shell 사용 → 별도 테스트 (shell-runtime.test.ts)
// 여기서는 parse_just_bash_output의 다양한 JSON 출력 포맷과
// 오류 처리 경로를 run_shell_command를 통해 간접 테스트.

describe("shell-runtime — parse_just_bash_output (just-bash 경로 via mock)", () => {
  beforeEach(() => {
    // 기본: just-bash가 설치된 환경으로 초기화
    mock_state.spawn_status = 0;
    mock_state.exec_should_throw = false;
  });

  it("just-bash JSON 출력 → stdout/stderr 파싱", async () => {
    set_just_bash_available(
      'some prefix line\n{"stdout":"hello world","stderr":"","exitCode":0}',
    );
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    const result = await run_shell_command("echo hello", OPTS);
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("");
  });

  it("just-bash JSON exit_code 키 → 파싱", async () => {
    set_just_bash_available('{"stdout":"ok","stderr":"warn","exit_code":0}');
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    const result = await run_shell_command("echo ok", OPTS);
    expect(result.stdout).toBe("ok");
  });

  it("just-bash 비정상 종료 (exit_code≠0) → 에러 throw", async () => {
    set_just_bash_available('{"stdout":"","stderr":"permission denied","exitCode":1}');
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    await expect(run_shell_command("fail", OPTS)).rejects.toThrow("permission denied");
  });

  it("just-bash stdout: stderr 없으면 stdout으로 에러 메시지", async () => {
    set_just_bash_available('{"stdout":"cmd not found","stderr":"","exitCode":127}');
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    await expect(run_shell_command("bad_cmd", OPTS)).rejects.toThrow("cmd not found");
  });

  it("just-bash JSON 파싱 실패 → raw stdout 반환", async () => {
    set_just_bash_available("plain text output (not JSON)");
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    const result = await run_shell_command("echo test", OPTS);
    expect(result.stdout).toBe("plain text output (not JSON)");
  });

  it("just-bash 빈 출력 → raw 빈 문자열 반환", async () => {
    set_just_bash_available("");
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    const result = await run_shell_command("echo test", OPTS);
    expect(result.stdout).toBe("");
  });

  it("just-bash execFile throw → 예외 전파", async () => {
    mock_state.spawn_status = 0; // just-bash 있음
    set_exec_throw("timeout exceeded");
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    await expect(run_shell_command("sleep 100", OPTS)).rejects.toThrow();
  });
});

describe("shell-runtime — can_run_runner / find_just_bash_runner (spawnSync mock)", () => {
  it("spawnSync status=1 → just-bash 미검출, 폴백 경로 실행", async () => {
    set_just_bash_unavailable();
    mock_state.exec_should_throw = false;
    // 폴백 경로에서 node:child_process의 exec를 사용하므로
    // exec_fn이 호출됨. 이 mock은 node:child_process를 모킹하므로
    // 폴백 경로도 mock을 탐.
    // 폴백에서 exec를 동적 import해 사용하므로 mock이 작동함.
    mock_state.exec_stdout = "fallback result";
    const { run_shell_command } = await import("@src/agent/tools/shell-runtime.js");
    // 폴백 경로 동작 검증
    const result = await run_shell_command("echo fallback", OPTS);
    expect(typeof result.stdout).toBe("string");
  });
});
