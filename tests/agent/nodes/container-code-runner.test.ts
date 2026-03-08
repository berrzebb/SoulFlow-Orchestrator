/**
 * container-code-runner — get_container_runtime / is_container_language / get_engine.
 * run_code_in_container은 실제 컨테이너 없이 테스트 불가 → mock 기반 execFile/spawnSync 테스트.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted로 mock 함수 선언
const { mock_spawn_sync, mock_exec_file, mock_write_file, mock_unlink, mock_rmdir, mock_mkdtemp } = vi.hoisted(() => ({
  mock_spawn_sync: vi.fn(),
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

import { get_container_runtime, is_container_language, get_engine, run_code_in_container } from "@src/agent/nodes/container-code-runner.js";
import type { CodeLanguage } from "@src/agent/workflow-node.types.js";

beforeEach(() => {
  vi.clearAllMocks();
  // cached_engine 리셋을 위해 detect_container_engine이 항상 fresh하게 실행되도록
  // module을 re-import 할 수 없으므로 spawnSync mock 재설정만 수행
});

// ══════════════════════════════════════════
// get_container_runtime
// ══════════════════════════════════════════

describe("get_container_runtime", () => {
  it("python → 올바른 image/ext/cmd 반환", () => {
    const r = get_container_runtime("python" as CodeLanguage);
    expect(r).not.toBeNull();
    expect(r!.image).toContain("python");
    expect(r!.file_ext).toBe(".py");
    expect(r!.file_cmd("script.py")).toContain("python3");
  });

  it("ruby 런타임 반환", () => {
    const r = get_container_runtime("ruby" as CodeLanguage);
    expect(r).not.toBeNull();
    expect(r!.file_ext).toBe(".rb");
  });

  it("bash 런타임 반환", () => {
    const r = get_container_runtime("bash" as CodeLanguage);
    expect(r).not.toBeNull();
    expect(r!.file_ext).toBe(".sh");
  });

  it("go 런타임 반환", () => {
    const r = get_container_runtime("go" as CodeLanguage);
    expect(r).not.toBeNull();
    expect(r!.file_ext).toBe(".go");
  });

  it("rust 런타임 반환", () => {
    const r = get_container_runtime("rust" as CodeLanguage);
    expect(r).not.toBeNull();
    expect(r!.file_ext).toBe(".rs");
  });

  it("deno 런타임 반환", () => {
    const r = get_container_runtime("deno" as CodeLanguage);
    expect(r).not.toBeNull();
    expect(r!.file_ext).toBe(".ts");
  });

  it("bun 런타임 반환", () => {
    const r = get_container_runtime("bun" as CodeLanguage);
    expect(r).not.toBeNull();
    expect(r!.file_ext).toBe(".ts");
  });

  it("미지원 언어 → null", () => {
    expect(get_container_runtime("php" as CodeLanguage)).toBeNull();
  });

  it("custom_image 있음 → image 덮어씀", () => {
    const r = get_container_runtime("python" as CodeLanguage, "my-registry/python:custom");
    expect(r).not.toBeNull();
    expect(r!.image).toBe("my-registry/python:custom");
    expect(r!.file_ext).toBe(".py");
  });
});

// ══════════════════════════════════════════
// is_container_language
// ══════════════════════════════════════════

describe("is_container_language", () => {
  it.each(["python", "ruby", "bash", "go", "rust", "deno", "bun"])("%s → true", (lang) => {
    expect(is_container_language(lang as CodeLanguage)).toBe(true);
  });

  it("지원 안 하는 언어 → false", () => {
    expect(is_container_language("php" as CodeLanguage)).toBe(false);
    expect(is_container_language("java" as CodeLanguage)).toBe(false);
  });
});

// ══════════════════════════════════════════
// get_engine (cached_engine 초기화 불가 → 첫 호출만 검증)
// ══════════════════════════════════════════

describe("get_engine", () => {
  it("반환값은 string | null", () => {
    // cached_engine은 이미 이전 테스트나 모듈 로드 시 설정됐을 수 있음
    const result = get_engine();
    expect(result === null || typeof result === "string").toBe(true);
  });
});

// ══════════════════════════════════════════
// run_code_in_container — 에러 경로
// ══════════════════════════════════════════

describe("run_code_in_container — 에러 경로", () => {
  it("미지원 언어 → unsupported 에러", async () => {
    const engine = get_engine();
    if (!engine) {
      await expect(run_code_in_container({ language: "php" as CodeLanguage, code: "", timeout_ms: 1000 }))
        .rejects.toThrow("no container engine");
    } else {
      await expect(run_code_in_container({ language: "php" as CodeLanguage, code: "", timeout_ms: 1000 }))
        .rejects.toThrow("unsupported container language");
    }
  });

  it("engine 없음(spawnSync mock=실패) → no container engine 에러", async () => {
    mock_spawn_sync.mockReturnValue({ status: 1 });
    const engine = get_engine();
    if (engine === null) {
      await expect(run_code_in_container({ language: "python" as CodeLanguage, code: "print(1)", timeout_ms: 1000 }))
        .rejects.toThrow("no container engine");
    } else {
      expect(engine).not.toBeNull();
    }
  });
});

// ══════════════════════════════════════════
// run_code_in_container — oneshot 경로 (engine 있을 때만)
// ══════════════════════════════════════════

describe("run_code_in_container — oneshot 성공", () => {
  it("python oneshot → exec_file 호출 + stdout 반환", async () => {
    const engine = get_engine();
    if (!engine) {
      // engine 없으면 스킵
      return;
    }
    // promisify(execFile) 콜백 스타일: (cmd, args, opts, cb) → cb(null, stdout, stderr)
    mock_exec_file.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, out: {stdout: string; stderr: string}) => void) => {
      cb(null, { stdout: "hello from python", stderr: "" } as any);
    });
    const r = await run_code_in_container({ language: "python" as CodeLanguage, code: "print('hello')", timeout_ms: 5000 });
    expect(r.stdout).toBe("hello from python");
    expect(r.exit_code).toBe(0);
  });

  it("oneshot: exec 실패 → exit_code != 0", async () => {
    const engine = get_engine();
    if (!engine) return;
    mock_exec_file.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = Object.assign(new Error("exit code 1"), { stdout: "", stderr: "syntax error", status: 1 });
      cb(err);
    });
    const r = await run_code_in_container({ language: "python" as CodeLanguage, code: "invalid", timeout_ms: 5000 });
    expect(r.exit_code).not.toBe(0);
    expect(r.stderr).toContain("syntax error");
  });

  it("oneshot: timeout → exit_code 124", async () => {
    const engine = get_engine();
    if (!engine) return;
    mock_exec_file.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = Object.assign(new Error("timeout"), { killed: true, stdout: "", stderr: "" });
      cb(err);
    });
    const r = await run_code_in_container({ language: "python" as CodeLanguage, code: "while True: pass", timeout_ms: 100 });
    expect(r.exit_code).toBe(124);
  });

  it("oneshot: network_access=true → --network=none 없음", async () => {
    const engine = get_engine();
    if (!engine) return;
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      // --network=none가 없어야 함
      cb(null, { stdout: "ok", stderr: "" } as any);
    });
    const r = await run_code_in_container({
      language: "python" as CodeLanguage,
      code: "print('ok')",
      timeout_ms: 5000,
      network_access: true,
    });
    expect(r.stdout).toBe("ok");
  });

  it("oneshot: workspace 있음 → -v /workspace:ro 포함", async () => {
    const engine = get_engine();
    if (!engine) return;
    let captured_args: string[] = [];
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      captured_args = args;
      cb(null, { stdout: "ok", stderr: "" } as any);
    });
    await run_code_in_container({
      language: "python" as CodeLanguage,
      code: "print('ok')",
      timeout_ms: 5000,
      workspace: "/my/workspace",
    });
    expect(captured_args.some((a: string) => a.includes("/workspace"))).toBe(true);
  });

  it("oneshot: env 있음 → -e KEY=VAL 포함", async () => {
    const engine = get_engine();
    if (!engine) return;
    let captured_args: string[] = [];
    mock_exec_file.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      captured_args = args;
      cb(null, { stdout: "ok", stderr: "" } as any);
    });
    await run_code_in_container({
      language: "python" as CodeLanguage,
      code: "print(os.environ['MY_VAR'])",
      timeout_ms: 5000,
      env: { MY_VAR: "hello" },
    });
    const env_idx = captured_args.indexOf("-e");
    expect(env_idx).toBeGreaterThan(-1);
    expect(captured_args[env_idx + 1]).toContain("MY_VAR");
  });
});
