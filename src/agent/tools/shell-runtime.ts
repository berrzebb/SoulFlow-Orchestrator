import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const exec_file_async = promisify(execFile);

export type ShellRunOptions = {
  cwd: string;
  timeout_ms: number;
  max_buffer_bytes: number;
  signal?: AbortSignal;
};

type JsonRecord = Record<string, unknown>;

type JustBashRunner = {
  command: string;
  prefix_args: string[];
};

const JUST_BASH_BINARY = "just-bash";
const JUST_BASH_CACHE_TTL_MS = 60_000;
let cached_just_bash_runner: { checked_at: number; runner: JustBashRunner | null } | null = null;

function command_exists(command: string): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  const check = spawnSync(checker, [command], {
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  return check.status === 0;
}

function can_run_runner(candidate: JustBashRunner): boolean {
  if (!command_exists(candidate.command)) return false;
  const probe = spawnSync(candidate.command, [...candidate.prefix_args, "--help"], {
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  return probe.status === 0;
}

function find_just_bash_runner(): JustBashRunner | null {
  // NO_JUST_BASH=1 설정 시 시스템 셸 폴백 강제 (테스트·CI 환경용)
  if (process.env.NO_JUST_BASH) return null;
  const now = Date.now();
  if (cached_just_bash_runner && now - cached_just_bash_runner.checked_at < JUST_BASH_CACHE_TTL_MS) {
    return cached_just_bash_runner.runner;
  }
  const candidates: JustBashRunner[] = [
    { command: JUST_BASH_BINARY, prefix_args: [] },
    { command: process.platform === "win32" ? "npx.cmd" : "npx", prefix_args: ["--yes", JUST_BASH_BINARY] },
  ];
  for (const candidate of candidates) {
    if (can_run_runner(candidate)) {
      cached_just_bash_runner = { checked_at: now, runner: candidate };
      return candidate;
    }
  }
  cached_just_bash_runner = { checked_at: now, runner: null };
  return null;
}

function as_record(raw: unknown): JsonRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as JsonRecord;
}

function parse_just_bash_output(stdout: string): { stdout: string; stderr: string; exit_code: number | null } | null {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const tail = lines[lines.length - 1];
  try {
    const parsed = JSON.parse(tail) as unknown;
    const rec = as_record(parsed);
    if (!rec) return null;
    const out = String(rec.stdout || "");
    const err = String(rec.stderr || "");
    const exit_raw = rec.exitCode ?? rec.exit_code;
    const exit_num = Number(exit_raw);
    return {
      stdout: out,
      stderr: err,
      exit_code: Number.isFinite(exit_num) ? Math.round(exit_num) : null,
    };
  } catch {
    return null;
  }
}

/**
 * shell 없이 argv 배열로 프로세스를 실행한다.
 * 문자열 보간을 거치지 않으므로 shell injection이 원천 차단된다.
 * archive, ssh 등 신뢰할 수 없는 인자를 받는 도구에 사용한다.
 */
export async function run_command_argv(
  cmd: string,
  args: string[],
  options: ShellRunOptions,
): Promise<{ stdout: string; stderr: string }> {
  const result = await exec_file_async(cmd, args, {
    cwd: options.cwd,
    timeout: options.timeout_ms,
    maxBuffer: options.max_buffer_bytes,
    signal: options.signal,
    windowsHide: true,
    shell: false,
  });
  return { stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
}

/**
 * exec 도구의 셸 실행.
 * - just-bash 사용 가능 → 샌드박스 실행 (토큰 절약, 파일 탐색용)
 * - just-bash 미설치 → 시스템 기본 셸 폴백
 * - 시스템 바이너리(python, curl 등) 실행은 SDK Bash 도구를 사용할 것.
 */
export async function run_shell_command(command: string, options: ShellRunOptions): Promise<{ stdout: string; stderr: string }> {
  // 1. just-bash 샌드박스
  const runner = find_just_bash_runner();
  if (runner) {
    const result = await exec_file_async(
      runner.command,
      [...runner.prefix_args, "-c", command, "--root", options.cwd, "--json"],
      {
        cwd: options.cwd,
        timeout: options.timeout_ms,
        maxBuffer: options.max_buffer_bytes,
        signal: options.signal,
        windowsHide: true,
      },
    );
    const parsed = parse_just_bash_output(String(result.stdout || ""));
    if (parsed) {
      if (parsed.exit_code !== null && parsed.exit_code !== 0) {
        const reason = parsed.stderr || parsed.stdout || `just_bash_exit_${parsed.exit_code}`;
        throw new Error(reason);
      }
      return { stdout: parsed.stdout, stderr: parsed.stderr };
    }
    return { stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
  }

  // 2. 폴백: 시스템 기본 셸
  const { exec } = await import("node:child_process");
  const exec_async = promisify(exec);
  const result = await exec_async(command, {
    cwd: options.cwd,
    timeout: options.timeout_ms,
    maxBuffer: options.max_buffer_bytes,
    signal: options.signal,
    windowsHide: true,
  });
  return { stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
}
