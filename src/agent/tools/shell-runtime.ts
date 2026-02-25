import { exec, execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const exec_async = promisify(exec);
const exec_file_async = promisify(execFile);

type ShellRunOptions = {
  cwd: string;
  timeout_ms: number;
  max_buffer_bytes: number;
  signal?: AbortSignal;
};

type JsonRecord = Record<string, unknown>;

let cached_just_bash_binary: string | null | undefined;
const JUST_BASH_BINARY = "just-bash";

function find_just_bash_binary(): string | null {
  if (cached_just_bash_binary !== undefined) return cached_just_bash_binary;
  const checker = process.platform === "win32" ? "where" : "which";
  const check = spawnSync(checker, [JUST_BASH_BINARY], {
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  cached_just_bash_binary = check.status === 0 ? JUST_BASH_BINARY : null;
  return cached_just_bash_binary;
}

function should_use_just_bash(): boolean {
  return Boolean(find_just_bash_binary());
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

export async function run_shell_command(command: string, options: ShellRunOptions): Promise<{ stdout: string; stderr: string }> {
  if (should_use_just_bash()) {
    const just_bash = find_just_bash_binary() || JUST_BASH_BINARY;
    const result = await exec_file_async(
      just_bash,
      ["-c", command, "--root", options.cwd, "--json"],
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

  const result = await exec_async(command, {
    cwd: options.cwd,
    timeout: options.timeout_ms,
    maxBuffer: options.max_buffer_bytes,
    signal: options.signal,
  });
  return { stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
}
