/**
 * 컨테이너 기반 코드 실행기 — 언어 불문 one-shot 샌드박스.
 * podman/docker run 으로 코드를 실행하고 stdout/stderr를 수집.
 */

import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, rmdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodeLanguage } from "../workflow-node.types.js";
import { error_message } from "../../utils/common.js";

const exec_file_async = promisify(execFile);

// ── 언어별 런타임 정의 ──────────────────────────────

export type ContainerRuntime = {
  image: string;
  file_ext: string;
  file_cmd: (filename: string) => string[];
};

const RUNTIMES: Record<string, ContainerRuntime> = {
  python:  { image: "python:3.12-slim",   file_ext: ".py",  file_cmd: (f) => ["python3", f] },
  ruby:    { image: "ruby:3.3-slim",      file_ext: ".rb",  file_cmd: (f) => ["ruby", f] },
  bash:    { image: "bash:5",             file_ext: ".sh",  file_cmd: (f) => ["bash", f] },
  go:      { image: "golang:1.22-alpine", file_ext: ".go",  file_cmd: (f) => ["go", "run", f] },
  rust:    { image: "rust:1.77-slim",     file_ext: ".rs",  file_cmd: (f) => ["bash", "-c", `rustc ${f} -o /tmp/out && /tmp/out`] },
  deno:    { image: "denoland/deno:2.0",  file_ext: ".ts",  file_cmd: (f) => ["deno", "run", "--allow-all", f] },
  bun:     { image: "oven/bun:1",         file_ext: ".ts",  file_cmd: (f) => ["bun", "run", f] },
};

export function get_container_runtime(language: CodeLanguage, custom_image?: string): ContainerRuntime | null {
  const runtime = RUNTIMES[language];
  if (!runtime) return null;
  if (custom_image) return { ...runtime, image: custom_image };
  return runtime;
}

export function is_container_language(language: CodeLanguage): boolean {
  return language in RUNTIMES;
}

// ── 컨테이너 런타임 감지 ────────────────────────────

let cached_engine: string | null | undefined;

function detect_container_engine(): string | null {
  if (cached_engine !== undefined) return cached_engine;
  for (const engine of ["podman", "docker"]) {
    try {
      const result = spawnSync(engine, ["--version"], {
        stdio: "ignore", windowsHide: true, shell: false, timeout: 5000,
      });
      if (result.status === 0) { cached_engine = engine; return engine; }
    } catch { /* skip */ }
  }
  cached_engine = null;
  return null;
}

export function get_engine(): string | null {
  return detect_container_engine();
}

// ── 실행 ────────────────────────────────────────────

export type ContainerCodeResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
};

export type ContainerCodeOptions = {
  language: CodeLanguage;
  code: string;
  timeout_ms: number;
  custom_image?: string;
  signal?: AbortSignal;
  /** 코드에서 접근 가능한 환경변수. */
  env?: Record<string, string>;
  /** 읽기 전용 마운트할 워크스페이스 경로. */
  workspace?: string;
  /** 네트워크 허용. false(기본) = --network=none. */
  network_access?: boolean;
  /** 컨테이너 유지. false(기본) = --rm. true = 재사용 가능한 named 컨테이너. */
  keep_container?: boolean;
  /** keep_container=true 시 컨테이너 이름. 미지정 시 자동 생성. */
  container_name?: string;
};

/**
 * 컨테이너에서 코드를 실행하고 결과를 반환.
 * - keep_container=false: `run --rm` (one-shot)
 * - keep_container=true: `create` + `start` + `logs` (재사용 가능)
 */
export async function run_code_in_container(options: ContainerCodeOptions): Promise<ContainerCodeResult> {
  const engine = detect_container_engine();
  if (!engine) throw new Error("no container engine (podman/docker) available");

  const runtime = get_container_runtime(options.language, options.custom_image);
  if (!runtime) throw new Error(`unsupported container language: ${options.language}`);

  const tmp_dir = await mkdtemp(join(tmpdir(), "code-node-"));
  const code_file = `script${runtime.file_ext}`;
  const code_path = join(tmp_dir, code_file);

  try {
    await writeFile(code_path, options.code, "utf-8");

    const container_code_dir = "/code";
    const container_code_path = `${container_code_dir}/${code_file}`;

    if (options.keep_container) {
      return await run_persistent(engine, runtime, options, tmp_dir, container_code_path);
    }
    return await run_oneshot(engine, runtime, options, tmp_dir, container_code_path);
  } finally {
    await unlink(code_path).catch(() => {});
    await rmdir(tmp_dir).catch(() => {});
  }
}

/** one-shot: `run --rm` — 실행 후 컨테이너 자동 삭제. */
async function run_oneshot(
  engine: string, runtime: ContainerRuntime,
  options: ContainerCodeOptions, tmp_dir: string, code_path: string,
): Promise<ContainerCodeResult> {
  const args = build_common_args(options, tmp_dir);
  args.unshift("run", "--rm");
  args.push(runtime.image, ...runtime.file_cmd(code_path));
  return exec_container(engine, args, options);
}

/** persistent: named 컨테이너 생성 → exec로 코드 실행. */
async function run_persistent(
  engine: string, runtime: ContainerRuntime,
  options: ContainerCodeOptions, tmp_dir: string, code_path: string,
): Promise<ContainerCodeResult> {
  const name = options.container_name || `code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 컨테이너가 이미 실행 중인지 확인
  const inspect = spawnSync(engine, ["inspect", "--format", "{{.State.Running}}", name], {
    stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 5000,
  });
  const is_running = String(inspect.stdout || "").trim() === "true";

  if (!is_running) {
    // 새 컨테이너 생성 + 시작
    const create_args = build_common_args(options, tmp_dir);
    create_args.unshift("run", "-d", "--name", name);
    create_args.push(runtime.image, "sleep", "3600");
    await exec_file_async(engine, create_args, { timeout: 30_000, windowsHide: true });
  }

  // exec로 코드 실행
  const exec_args = ["exec", name, ...runtime.file_cmd(code_path)];
  return exec_container(engine, exec_args, options);
}

/** 공통 컨테이너 옵션 구성. */
function build_common_args(options: ContainerCodeOptions, tmp_dir: string): string[] {
  const args: string[] = [];
  const container_code_dir = "/code";

  if (!options.network_access) args.push("--network=none");
  args.push("--memory=256m", "--cpus=1");
  args.push("--read-only", "--tmpfs=/tmp:rw,size=64m");
  args.push("-v", `${tmp_dir}:${container_code_dir}:ro`);

  if (options.workspace) {
    args.push("-v", `${options.workspace}:/workspace:ro`);
    args.push("-w", "/workspace");
  }

  if (options.env) {
    for (const [k, v] of Object.entries(options.env)) {
      args.push("-e", `${k}=${v}`);
    }
  }

  return args;
}

/** execFile 래퍼 — 성공/실패 모두 ContainerCodeResult로 정규화. */
async function exec_container(
  engine: string, args: string[], options: ContainerCodeOptions,
): Promise<ContainerCodeResult> {
  try {
    const result = await exec_file_async(engine, args, {
      timeout: options.timeout_ms,
      maxBuffer: 1024 * 512,
      signal: options.signal,
      windowsHide: true,
    });
    return { stdout: String(result.stdout || ""), stderr: String(result.stderr || ""), exit_code: 0 };
  } catch (e: unknown) {
    const err = e as { code?: string; killed?: boolean; stdout?: string; stderr?: string; status?: number };
    if (err.killed || err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return { stdout: String(err.stdout || ""), stderr: String(err.stderr || "timeout or buffer exceeded"), exit_code: 124 };
    }
    return { stdout: String(err.stdout || ""), stderr: String(err.stderr || error_message(e)), exit_code: err.status || 1 };
  }
}
