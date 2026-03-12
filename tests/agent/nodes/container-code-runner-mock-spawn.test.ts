/**
 * container-code-runner — run_oneshot / run_persistent / build_common_args 경로 보충.
 * engine="podman" mock으로 실제 컨테이너 없이 모든 실행 경로 커버.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { CodeLanguage } from "@src/agent/workflow-node.types.js";

// ── mock 호이스팅 ──────────────────────────────────────────
const { mock_spawn_sync, mock_exec_file, mock_write_file, mock_unlink, mock_rmdir, mock_mkdtemp } = vi.hoisted(() => ({
  mock_spawn_sync: vi.fn().mockImplementation((_cmd: string, args: string[]) => {
    // engine detection: podman --version → 성공
    if (args[0] === "--version") return { status: 0 };
    // run_persistent inspect: 기본값 = 미실행 (stdout="")
    if (args[0] === "inspect") return { stdout: Buffer.from(""), status: 0 };
    return { status: 0 };
  }),
  mock_exec_file: vi.fn(),
  mock_write_file: vi.fn().mockResolvedValue(undefined),
  mock_unlink: vi.fn().mockResolvedValue(undefined),
  mock_rmdir: vi.fn().mockResolvedValue(undefined),
  mock_mkdtemp: vi.fn().mockResolvedValue("/tmp/code-node-test"),
}));

vi.mock("node:child_process", () => ({
  execFile: mock_exec_file,
  spawnSync: mock_spawn_sync,
}));

vi.mock("node:fs/promises", () => ({
  writeFile: mock_write_file,
  unlink: mock_unlink,
  rmdir: mock_rmdir,
  mkdtemp: mock_mkdtemp,
}));

import { run_code_in_container, get_engine } from "@src/agent/nodes/container-code-runner.js";

// engine 캐시 워밍업: 첫 호출에 spawnSync mock이 준비되어 있어야 함
beforeAll(() => {
  get_engine();
});

// 각 테스트 전 mock 초기화 + 기본값 복원
beforeEach(() => {
  vi.clearAllMocks();
  mock_spawn_sync.mockImplementation((_cmd: string, args: string[]) => {
    if (args[0] === "--version") return { status: 0 };
    if (args[0] === "inspect") return { stdout: Buffer.from(""), status: 0 };
    return { status: 0 };
  });
  mock_write_file.mockResolvedValue(undefined);
  mock_unlink.mockResolvedValue(undefined);
  mock_rmdir.mockResolvedValue(undefined);
  mock_mkdtemp.mockResolvedValue("/tmp/code-node-test");
});

// ── 헬퍼 ──────────────────────────────────────────────────

function cb_success(stdout = "ok", stderr = "") {
  mock_exec_file.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(null, { stdout, stderr });
  });
}

function cb_fail(err: object) {
  mock_exec_file.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(Object.assign(new Error("exec failed"), err));
  });
}

// ══════════════════════════════════════════
// oneshot — exec_container 분기
// ══════════════════════════════════════════

describe("run_code_in_container — oneshot 성공", () => {
  it("stdout/stderr 정상 반환", async () => {
    cb_success("hello world", "warn");
    const r = await run_code_in_container({
      language: "python" as CodeLanguage, code: "print('hello world')", timeout_ms: 5000,
    });
    expect(r.stdout).toBe("hello world");
    expect(r.stderr).toBe("warn");
    expect(r.exit_code).toBe(0);
  });

  it("exit_code != 0 → exec 에러 반환", async () => {
    cb_fail({ stdout: "", stderr: "syntax error", status: 2 });
    const r = await run_code_in_container({
      language: "python" as CodeLanguage, code: "bad", timeout_ms: 5000,
    });
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toContain("syntax error");
  });

  it("killed=true → exit_code=124", async () => {
    cb_fail({ killed: true, stdout: "", stderr: "" });
    const r = await run_code_in_container({
      language: "python" as CodeLanguage, code: "while True: pass", timeout_ms: 100,
    });
    expect(r.exit_code).toBe(124);
    expect(r.stderr).toContain("timeout");
  });

  it("ERR_CHILD_PROCESS_STDIO_MAXBUFFER → exit_code=124 + 'buffer exceeded'", async () => {
    cb_fail({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: "partial", stderr: "" });
    const r = await run_code_in_container({
      language: "python" as CodeLanguage, code: "print('x' * 9999999)", timeout_ms: 5000,
    });
    expect(r.exit_code).toBe(124);
    expect(r.stderr).toContain("buffer exceeded");
  });
});

// ══════════════════════════════════════════
// build_common_args — 옵션별 분기
// ══════════════════════════════════════════

describe("run_code_in_container — build_common_args 옵션", () => {
  it("network_access=true → --network=none 없음", async () => {
    let captured: string[] = [];
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      captured = args;
      cb(null, { stdout: "ok", stderr: "" });
    });
    await run_code_in_container({
      language: "python" as CodeLanguage, code: "", timeout_ms: 5000, network_access: true,
    });
    expect(captured).not.toContain("--network=none");
  });

  it("network_access 미지정(기본) → --network=none 포함", async () => {
    let captured: string[] = [];
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      captured = args;
      cb(null, { stdout: "ok", stderr: "" });
    });
    await run_code_in_container({
      language: "python" as CodeLanguage, code: "", timeout_ms: 5000,
    });
    expect(captured).toContain("--network=none");
  });

  it("workspace → -v /workspace:ro 및 -w /workspace 포함", async () => {
    let captured: string[] = [];
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      captured = args;
      cb(null, { stdout: "ok", stderr: "" });
    });
    await run_code_in_container({
      language: "python" as CodeLanguage, code: "", timeout_ms: 5000, workspace: "/my/workspace",
    });
    expect(captured.some(a => a.includes("/workspace:ro"))).toBe(true);
    expect(captured).toContain("-w");
  });

  it("env → -e KEY=VAL 포함", async () => {
    let captured: string[] = [];
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      captured = args;
      cb(null, { stdout: "ok", stderr: "" });
    });
    await run_code_in_container({
      language: "python" as CodeLanguage, code: "", timeout_ms: 5000, env: { MY_VAR: "hello", OTHER: "world" },
    });
    const dash_e_indices = captured.reduce((acc: number[], v, i) => v === "-e" ? [...acc, i] : acc, []);
    expect(dash_e_indices.length).toBe(2);
    const env_pairs = dash_e_indices.map(i => captured[i + 1]);
    expect(env_pairs).toContain("MY_VAR=hello");
    expect(env_pairs).toContain("OTHER=world");
  });
});

// ══════════════════════════════════════════
// run_persistent — 컨테이너 상태별 분기
// ══════════════════════════════════════════

describe("run_code_in_container — persistent 컨테이너", () => {
  it("컨테이너 미실행 → run -d 생성 후 exec 실행 (2번 호출)", async () => {
    // inspect stdout="" → is_running = false
    mock_spawn_sync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0 };
      if (args[0] === "inspect") return { stdout: Buffer.from(""), status: 0 };
      return { status: 0 };
    });
    const exec_calls: string[][] = [];
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      exec_calls.push(args);
      cb(null, { stdout: "persistent ok", stderr: "" });
    });
    const r = await run_code_in_container({
      language: "python" as CodeLanguage, code: "print('ok')", timeout_ms: 5000,
      keep_container: true, container_name: "test-container-A",
    });
    expect(r.stdout).toBe("persistent ok");
    expect(exec_calls.length).toBe(2);
    expect(exec_calls[0]).toContain("-d");   // create
    expect(exec_calls[1]).toContain("exec"); // execute
  });

  it("컨테이너 실행 중 → exec만 1번 호출", async () => {
    // inspect stdout="true" → is_running = true
    mock_spawn_sync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0 };
      if (args[0] === "inspect") return { stdout: Buffer.from("true"), status: 0 };
      return { status: 0 };
    });
    const exec_calls: string[][] = [];
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      exec_calls.push(args);
      cb(null, { stdout: "already running ok", stderr: "" });
    });
    const r = await run_code_in_container({
      language: "python" as CodeLanguage, code: "print('ok')", timeout_ms: 5000,
      keep_container: true, container_name: "running-container-B",
    });
    expect(r.stdout).toBe("already running ok");
    expect(exec_calls.length).toBe(1);
    expect(exec_calls[0]).toContain("exec");
  });

  it("container_name 미지정 → 자동 이름 생성 후 exec 포함", async () => {
    const exec_calls: string[][] = [];
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      exec_calls.push(args);
      cb(null, { stdout: "auto-name ok", stderr: "" });
    });
    const r = await run_code_in_container({
      language: "python" as CodeLanguage, code: "", timeout_ms: 5000, keep_container: true,
    });
    expect(r.stdout).toBe("auto-name ok");
    expect(exec_calls.length).toBe(2); // create + exec (이름 자동 생성)
    expect(exec_calls[1][0]).toBe("exec");
  });
});
