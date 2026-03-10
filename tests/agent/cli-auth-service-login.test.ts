/**
 * CliAuthService — start_login / cancel_login / check_gemini 추가 경로:
 * - check_gemini: readdirSync 에러, config_only, no_auth_files
 * - start_login: 이미 진행 중, stdout URL, stderr URL, close code=0, close code!=0, error, timeout
 * - cancel_login: proc 있음, proc 없음
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { CliAuthService } from "@src/agent/cli-auth.service.js";

vi.useFakeTimers();

function make_logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

function make_service() {
  return new CliAuthService({ logger: make_logger() });
}

/** spawn이 반환하는 EventEmitter 기반 mock 프로세스 */
function make_proc() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GEMINI_API_KEY;
  // claude check 기본 mock (start_login 테스트가 check를 호출하지 않도록)
  vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
    callback(null, JSON.stringify({ loggedIn: true }), "");
    return {} as any;
  });
});

afterEach(() => {
  vi.clearAllTimers();
});

// ══════════════════════════════════════════════════════════
// check_gemini 추가 경로
// ══════════════════════════════════════════════════════════

describe("CliAuthService — check_gemini 추가 경로", () => {
  it("readdirSync 에러 → authenticated=false, cannot read", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation((p: any) => {
      if (String(p).includes("gemini")) throw new Error("permission denied");
      return [] as any;
    });

    const svc = make_service();
    const status = await svc.check("gemini");
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain("cannot read");
  });

  it("config 파일만 있음 → config detected", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation((p: any) => {
      if (String(p).includes("gemini")) return ["settings.json"] as any;
      return [] as any;
    });

    const svc = make_service();
    const status = await svc.check("gemini");
    expect(status.authenticated).toBe(true);
    expect(status.account).toBe("config detected");
  });

  it("빈 디렉토리 → no auth files", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation((p: any) => {
      if (String(p).includes("gemini")) return [] as any;
      return [] as any;
    });

    const svc = make_service();
    const status = await svc.check("gemini");
    expect(status.authenticated).toBe(false);
    expect(status.error).toContain("no auth files");
  });
});

// ══════════════════════════════════════════════════════════
// start_login
// ══════════════════════════════════════════════════════════

describe("CliAuthService — start_login", () => {
  it("이미 진행 중 → failed 반환 (spawn 미호출)", async () => {
    const proc = make_proc();
    vi.mocked(spawn).mockReturnValue(proc);

    const svc = make_service();
    // 첫 번째 호출 — timeout 전에 두 번째 호출
    const p1 = svc.start_login("claude");
    const result2 = await svc.start_login("claude");

    expect(result2.state).toBe("failed");
    expect(result2.error).toBe("Login already in progress");

    // 정리
    await vi.advanceTimersByTimeAsync(10_001);
    await p1;
  });

  it("stdout에서 URL 발견 → url_ready 반환", async () => {
    const proc = make_proc();
    vi.mocked(spawn).mockReturnValue(proc);

    const svc = make_service();
    const p = svc.start_login("claude");

    // stdout에 URL 포함 data 이벤트
    proc.stdout.emit("data", Buffer.from("Please open: https://auth.example.com/login?code=abc\n"));
    const result = await p;

    expect(result.state).toBe("url_ready");
    expect(result.login_url).toContain("https://auth.example.com");
  });

  it("stderr에서 URL 발견 → url_ready 반환", async () => {
    const proc = make_proc();
    vi.mocked(spawn).mockReturnValue(proc);

    const svc = make_service();
    const p = svc.start_login("claude");

    proc.stderr.emit("data", Buffer.from("Login at: https://auth.example.com/oauth?state=xyz\n"));
    const result = await p;

    expect(result.state).toBe("url_ready");
    expect(result.login_url).toContain("https://auth.example.com");
  });

  it("close code=0 + auth 성공 → completed", async () => {
    const proc = make_proc();
    vi.mocked(spawn).mockReturnValue(proc);
    // close 후 check("claude") 호출 → authenticated=true
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const p = svc.start_login("claude");

    // URL 없이 close
    await vi.advanceTimersByTimeAsync(0); // allow microtasks
    proc.emit("close", 0);
    await vi.runAllTicks();

    const result = await p;
    expect(result.state).toBe("completed");
  });

  it("close code!=0 → failed 반환", async () => {
    const proc = make_proc();
    vi.mocked(spawn).mockReturnValue(proc);

    const svc = make_service();
    const p = svc.start_login("claude");

    proc.stderr.emit("data", Buffer.from("Authentication failed\n"));
    await vi.advanceTimersByTimeAsync(0);
    proc.emit("close", 1);
    await vi.runAllTicks();

    const result = await p;
    expect(result.state).toBe("failed");
    expect(result.error).toContain("Authentication failed");
  });

  it("process error → failed 반환", async () => {
    const proc = make_proc();
    vi.mocked(spawn).mockReturnValue(proc);

    const svc = make_service();
    const p = svc.start_login("claude");

    proc.emit("error", new Error("ENOENT: claude not found"));
    await vi.runAllTicks();

    const result = await p;
    expect(result.state).toBe("failed");
    expect(result.error).toContain("ENOENT");
  });

  it("10초 timeout → waiting_url 반환", async () => {
    const proc = make_proc();
    vi.mocked(spawn).mockReturnValue(proc);

    const svc = make_service();
    const p = svc.start_login("claude");

    await vi.advanceTimersByTimeAsync(10_001);
    const result = await p;

    expect(result.state).toBe("waiting_url");
  });
});

// ══════════════════════════════════════════════════════════
// cancel_login
// ══════════════════════════════════════════════════════════

describe("CliAuthService — cancel_login", () => {
  it("진행 중인 로그인 취소 → true 반환 + kill 호출", async () => {
    const proc = make_proc();
    vi.mocked(spawn).mockReturnValue(proc);

    const svc = make_service();
    void svc.start_login("claude"); // 시작만, await 안 함

    const cancelled = svc.cancel_login("claude");
    expect(cancelled).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(10_001);
  });

  it("진행 중인 로그인 없음 → false 반환", () => {
    const svc = make_service();
    const cancelled = svc.cancel_login("claude");
    expect(cancelled).toBe(false);
  });
});
