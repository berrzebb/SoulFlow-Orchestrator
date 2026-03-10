/** CLI 에이전트(Claude Code, Codex)의 OAuth 인증 상태 확인 및 로그인 플로우 관리. */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { Logger } from "../logger.js";

// ── 타입 ───────────────────────────────────────────────────────────────────────

export type CliType = "claude" | "codex" | "gemini";

export interface CliAuthStatus {
  cli: CliType;
  authenticated: boolean;
  account?: string;
  error?: string;
}

export interface LoginProgress {
  cli: CliType;
  state: "waiting_url" | "url_ready" | "completed" | "failed";
  login_url?: string;
  error?: string;
}

// ── CLI별 로그인 커맨드 ──────────────────────────────────────────────────────────

const LOGIN_COMMANDS: Record<CliType, { cmd: string; args: string[] }> = {
  claude: { cmd: "claude", args: ["login"] },
  codex: { cmd: "codex", args: ["auth", "login"] },
  gemini: { cmd: "gemini", args: ["auth", "login"] },
};

// ── URL 추출 정규식 ────────────────────────────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/;

// ── 서비스 ─────────────────────────────────────────────────────────────────────

export interface CliAuthServiceOptions {
  logger: Logger;
}

export class CliAuthService extends EventEmitter {
  private readonly logger: Logger;
  private readonly login_processes = new Map<CliType, ChildProcess>();
  private readonly status_cache = new Map<CliType, CliAuthStatus>();
  private readonly login_progress_cache = new Map<CliType, LoginProgress>();
  private readonly oauth_ports = new Map<CliType, number>();

  constructor(opts: CliAuthServiceOptions) {
    super();
    this.logger = opts.logger;
  }

  /** CLI 인증 상태 확인. CLI별 전용 로직 분기. */
  async check(cli: CliType): Promise<CliAuthStatus> {
    const checkers: Record<CliType, () => CliAuthStatus | Promise<CliAuthStatus>> = {
      claude: () => this.check_claude(),
      codex: () => this.check_codex(),
      gemini: () => this.check_gemini(),
    };
    const status = await checkers[cli]();
    this.status_cache.set(cli, status);
    this.logger.info("auth check", { cli, authenticated: status.authenticated, account: status.account });
    return status;
  }

  /** 모든 CLI의 인증 상태를 한 번에 확인. */
  async check_all(): Promise<CliAuthStatus[]> {
    return Promise.all([this.check("claude"), this.check("codex"), this.check("gemini")]);
  }

  /** 캐시된 상태 반환 (check() 호출 전엔 미인증으로 반환). */
  get_cached(cli: CliType): CliAuthStatus {
    return this.status_cache.get(cli) ?? { cli, authenticated: false };
  }

  /** 모든 CLI의 캐시된 상태 반환. */
  get_all_cached(): CliAuthStatus[] {
    return [this.get_cached("claude"), this.get_cached("codex"), this.get_cached("gemini")];
  }

  /** 진행 중인 로그인의 최신 진행 상태 반환 (URL 폴링용). */
  get_login_progress(cli: CliType): LoginProgress | null {
    return this.login_progress_cache.get(cli) ?? null;
  }

  /** localhost OAuth 서버 포트 반환 (HTTP 프록시 라우트용). */
  get_oauth_port(cli: CliType): number | null {
    return this.oauth_ports.get(cli) ?? null;
  }

  // ── Claude Code ────────────────────────────────────────────────────────────

  /** `claude auth status` → JSON 출력 파싱. */
  private check_claude(): Promise<CliAuthStatus> {
    return new Promise<CliAuthStatus>((resolve) => {
      execFile("claude", ["auth", "status"], { timeout: 10_000 }, (error, stdout, stderr) => {
        const output = (stdout || stderr || "").trim();

        // JSON 파싱 시도: {"loggedIn":true,"authMethod":"oauth","apiProvider":"..."}
        const json = try_parse_json(output);
        if (json) {
          const logged_in = json.loggedIn === true || json.loggedin === true;
          const account = (json.email ?? json.account ?? null) as string | null;
          resolve({
            cli: "claude",
            authenticated: logged_in,
            account: account ?? undefined,
            error: logged_in ? undefined : "not logged in",
          });
          return;
        }

        // Fallback: exit code 기반
        if (error) {
          resolve({ cli: "claude", authenticated: false, error: output || error.message });
          return;
        }

        resolve({ cli: "claude", authenticated: true, account: extract_account(output) ?? undefined });
      });
    });
  }

  // ── Codex CLI ──────────────────────────────────────────────────────────────

  /** Codex는 auth status 명령이 없음. ~/.codex/ 디렉토리 내 인증 파일 존재 확인. */
  private check_codex(): CliAuthStatus {
    const home = process.env.HOME || "/root";
    const codex_dir = join(home, ".codex");

    if (!existsSync(codex_dir)) {
      return { cli: "codex", authenticated: false, error: "~/.codex/ not found" };
    }

    // auth 관련 파일 탐색 (auth.json, config.json, credentials 등)
    let files: string[];
    try { files = readdirSync(codex_dir); }
    catch { return { cli: "codex", authenticated: false, error: "cannot read ~/.codex/" }; }

    const auth_file = files.find(f =>
      f.includes("auth") || f.includes("credential") || f.includes("token"),
    );

    if (auth_file) {
      return { cli: "codex", authenticated: true, account: `~/.codex/${auth_file}` };
    }

    // config 파일이라도 있으면 인증된 것으로 간주 (API 키 기반일 수 있음)
    if (files.some(f => f.includes("config") || f.endsWith(".json"))) {
      return { cli: "codex", authenticated: true, account: "config detected" };
    }

    return { cli: "codex", authenticated: false, error: "no auth files in ~/.codex/" };
  }

  // ── Gemini CLI ──────────────────────────────────────────────────────────

  /** ~/.gemini/ 디렉토리 내 인증 파일 또는 GEMINI_API_KEY 환경변수 확인. */
  private check_gemini(): CliAuthStatus {
    // 환경변수 우선 확인
    if (process.env.GEMINI_API_KEY) {
      return { cli: "gemini", authenticated: true, account: "GEMINI_API_KEY" };
    }

    const home = process.env.HOME || "/root";
    const gemini_dir = join(home, ".gemini");

    if (!existsSync(gemini_dir)) {
      return { cli: "gemini", authenticated: false, error: "~/.gemini/ not found" };
    }

    let files: string[];
    try { files = readdirSync(gemini_dir); }
    catch { return { cli: "gemini", authenticated: false, error: "cannot read ~/.gemini/" }; }

    const auth_file = files.find(f =>
      f.includes("auth") || f.includes("credential") || f.includes("token") || f.includes("oauth"),
    );

    if (auth_file) {
      return { cli: "gemini", authenticated: true, account: `~/.gemini/${auth_file}` };
    }

    if (files.some(f => f.includes("config") || f.endsWith(".json"))) {
      return { cli: "gemini", authenticated: true, account: "config detected" };
    }

    return { cli: "gemini", authenticated: false, error: "no auth files in ~/.gemini/" };
  }

  // ── 로그인 플로우 ──────────────────────────────────────────────────────────

  /** OAuth 로그인 프로세스를 시작. stdout에서 로그인 URL을 파싱하여 반환. */
  start_login(cli: CliType): Promise<LoginProgress> {
    if (this.login_processes.has(cli)) {
      return Promise.resolve({
        cli,
        state: "failed",
        error: "Login already in progress",
      });
    }

    const { cmd, args } = LOGIN_COMMANDS[cli];
    this.logger.info("starting CLI login", { cli });

    return new Promise<LoginProgress>((resolve) => {
      const proc = spawn(cmd, args, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
      });

      this.login_processes.set(cli, proc);
      let url_resolved = false;
      let stdout_buf = "";
      let stderr_buf = "";

      const emit_progress = (p: LoginProgress) => {
        this.login_progress_cache.set(cli, p);
        this.emit("login_progress", p);
      };

      const try_extract_url = (buf: string): string | null => {
        const m = buf.match(URL_PATTERN);
        return m ? m[0] : null;
      };

      /** 출력에서 "Enter 입력 대기" 패턴을 감지하면 stdin에 \n 전송. */
      const try_send_enter = (buf: string) => {
        const ENTER_PATTERNS = /press\s+enter|hit\s+enter|press\s+return|\[enter\]|\(enter\)/i;
        if (ENTER_PATTERNS.test(buf)) {
          proc.stdin?.write("\n");
        }
      };

      // 비-TTY 환경에서도 초기 프롬프트를 넘기기 위해 1초 후 Enter 전송
      const initial_enter_timer = setTimeout(() => {
        if (!url_resolved) proc.stdin?.write("\n");
      }, 1_000);

      const on_url_found = (raw_url: string) => {
        url_resolved = true;
        clearTimeout(initial_enter_timer);
        // localhost URL이면 포트 저장 (OAuth 프록시 라우트에서 사용)
        const local_match = raw_url.match(/https?:\/\/(localhost|127\.0\.0\.1):(\d+)/);
        if (local_match) this.oauth_ports.set(cli, parseInt(local_match[2]));
        const p: LoginProgress = { cli, state: "url_ready", login_url: raw_url };
        emit_progress(p);
        resolve(p);
      };

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout_buf += chunk.toString();
        if (!url_resolved) {
          try_send_enter(stdout_buf);
          const u = try_extract_url(stdout_buf);
          if (u) on_url_found(u);
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr_buf += chunk.toString();
        if (!url_resolved) {
          try_send_enter(stderr_buf);
          const u = try_extract_url(stderr_buf);
          if (u) on_url_found(u);
        }
      });

      proc.on("close", async (code) => {
        clearTimeout(initial_enter_timer);
        this.login_processes.delete(cli);
        if (code === 0) {
          const status = await this.check(cli);
          const p: LoginProgress = {
            cli,
            state: status.authenticated ? "completed" : "failed",
            error: status.authenticated ? undefined : "Login completed but auth check failed",
          };
          emit_progress(p);
          if (!url_resolved) resolve(p);
        } else {
          const p: LoginProgress = {
            cli,
            state: "failed",
            error: stderr_buf.trim() || `Process exited with code ${code}`,
          };
          emit_progress(p);
          if (!url_resolved) resolve(p);
        }
        this.login_progress_cache.delete(cli);
      });

      proc.on("error", (err) => {
        clearTimeout(initial_enter_timer);
        this.login_processes.delete(cli);
        const p: LoginProgress = { cli, state: "failed", error: err.message };
        emit_progress(p);
        this.login_progress_cache.delete(cli);
        if (!url_resolved) resolve(p);
      });

      // URL이 10초 내에 안 나오면 waiting_url 상태로 반환 (프로세스는 계속 실행)
      setTimeout(() => {
        if (!url_resolved) {
          url_resolved = true;
          const p: LoginProgress = { cli, state: "waiting_url" };
          this.login_progress_cache.set(cli, p);
          resolve(p);
        }
      }, 10_000);
    });
  }

  /** 진행 중인 로그인 프로세스 취소. */
  cancel_login(cli: CliType): boolean {
    const proc = this.login_processes.get(cli);
    if (!proc) return false;

    proc.kill("SIGTERM");
    this.login_processes.delete(cli);
    this.login_progress_cache.delete(cli);
    this.oauth_ports.delete(cli);
    this.logger.info("login cancelled", { cli });
    return true;
  }

  /** 진행 중인 모든 로그인 프로세스 정리. */
  dispose(): void {
    for (const [cli, proc] of this.login_processes) {
      proc.kill("SIGTERM");
      this.logger.debug("disposing login process", { cli });
    }
    this.login_processes.clear();
    this.login_progress_cache.clear();
    this.oauth_ports.clear();
  }
}

// ── 헬퍼 ───────────────────────────────────────────────────────────────────────

function try_parse_json(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { return null; }
}

/** stdout에서 계정 정보(이메일 등) 추출 시도. */
function extract_account(output: string): string | null {
  const email_match = output.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (email_match) return email_match[0];

  const first_line = output.split("\n")[0]?.trim();
  if (first_line && first_line.length < 100) return first_line;

  return null;
}
