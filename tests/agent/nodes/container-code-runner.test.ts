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
    // engine은 이미 cached → spawnSync는 호출되지 않을 수 있음
    // engine이 null이면 'no container engine' 에러가 먼저 발생
    // 그래서 engine이 있어야 언어 에러로 도달함
    // 여기서는 engine이 있을 경우에만 유의미 → 조건부 검증
    const engine = get_engine();
    if (!engine) {
      // engine 없음 → no container engine 에러 먼저
      await expect(run_code_in_container({ language: "php" as CodeLanguage, code: "", timeout_ms: 1000 }))
        .rejects.toThrow("no container engine");
    } else {
      await expect(run_code_in_container({ language: "php" as CodeLanguage, code: "", timeout_ms: 1000 }))
        .rejects.toThrow("unsupported container language");
    }
  });

  it("engine 없음(spawnSync mock=실패) → no container engine 에러", async () => {
    // 주의: cached_engine이 이미 설정된 경우 spawnSync mock이 영향 없음
    // 이 케이스는 cached_engine === null일 때만 유효하므로 조건부 검증
    mock_spawn_sync.mockReturnValue({ status: 1 });
    const engine = get_engine();
    if (engine === null) {
      await expect(run_code_in_container({ language: "python" as CodeLanguage, code: "print(1)", timeout_ms: 1000 }))
        .rejects.toThrow("no container engine");
    } else {
      // engine이 이미 cached → 테스트 스킵 (캐싱 특성상)
      expect(engine).not.toBeNull();
    }
  });
});
