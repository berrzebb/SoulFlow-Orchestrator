/** LocalPty — child_process 기반 Pty 구현. Docker 없이 동일 인터페이스. */

import { spawn, type ChildProcess } from "node:child_process";
import type { Pty, PtySpawnOptions, PtyFactory, Disposable } from "./types.js";

export class LocalPty implements Pty {
  readonly pid: string;
  private readonly proc: ChildProcess;
  private readonly data_listeners = new Set<(data: string) => void>();
  private readonly exit_listeners = new Set<(e: { exitCode: number }) => void>();
  private exited = false;

  constructor(file: string, args: string[], options: PtySpawnOptions) {
    this.proc = spawn(file, args, {
      cwd: options.cwd,
      env: strip_nesting_env({ ...process.env, ...options.env }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.pid = String(this.proc.pid ?? `local-${Date.now()}`);

    this.proc.stdout?.setEncoding("utf8");
    this.proc.stdout?.on("data", (chunk: string) => {
      for (const cb of this.data_listeners) cb(chunk);
    });

    // stderr → stdout로 합류 (CLI의 에러 출력도 수신)
    this.proc.stderr?.setEncoding("utf8");
    this.proc.stderr?.on("data", (chunk: string) => {
      for (const cb of this.data_listeners) cb(chunk);
    });

    this.proc.on("exit", (code) => {
      this.exited = true;
      const exitCode = code ?? 1;
      for (const cb of this.exit_listeners) cb({ exitCode });
    });
  }

  write(data: string): void {
    if (this.exited || !this.proc.stdin?.writable) return;
    this.proc.stdin.write(data);
  }

  end(data?: string): void {
    if (this.exited || !this.proc.stdin?.writable) return;
    if (data) this.proc.stdin.write(data);
    this.proc.stdin.end();
  }

  onData(cb: (data: string) => void): Disposable {
    this.data_listeners.add(cb);
    return { dispose: () => { this.data_listeners.delete(cb); } };
  }

  onExit(cb: (e: { exitCode: number }) => void): Disposable {
    if (this.exited) {
      cb({ exitCode: this.proc.exitCode ?? 1 });
      return { dispose: () => {} };
    }
    this.exit_listeners.add(cb);
    return { dispose: () => { this.exit_listeners.delete(cb); } };
  }

  kill(): void {
    if (this.exited) return;
    this.proc.kill("SIGTERM");
    setTimeout(() => {
      if (!this.exited) this.proc.kill("SIGKILL");
    }, 3000);
  }

  resize(): void {
    // headless CLI — no-op
  }
}

export const local_pty_factory: PtyFactory = (file, args, options) =>
  new LocalPty(file, args, options);

/**
 * CLI가 nested session을 감지하는 환경변수를 제거.
 * CLAUDECODE: Claude Code가 설정 → 하위 Claude CLI 실행 차단.
 */
const NESTING_ENV_KEYS = ["CLAUDECODE"];

function strip_nesting_env(env: Record<string, string | undefined>): Record<string, string | undefined> {
  for (const key of NESTING_ENV_KEYS) delete env[key];
  return env;
}
