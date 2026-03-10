/**
 * CliAuthService — fs/execFile mock 기반 커버리지:
 * - check_claude: JSON 파싱 (loggedIn), fallback (exit code), error 분기
 * - check_codex: ~/.codex 없음, auth 파일, config 파일, 파일 없음
 * - check_gemini: GEMINI_API_KEY, ~/.gemini 파일 탐색
 * - check_all, get_cached, get_all_cached
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { CliAuthService } from "@src/agent/cli-auth.service.js";

function make_logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

function make_service() {
  return new CliAuthService({ logger: make_logger() });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 환경변수 초기화
  delete process.env.GEMINI_API_KEY;
});

// ══════════════════════════════════════════════════════════
// check_claude
// ══════════════════════════════════════════════════════════

describe("CliAuthService — check_claude", () => {
  it("JSON 출력 + loggedIn=true → authenticated=true", async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, JSON.stringify({ loggedIn: true, email: "test@example.com" }), "");
      return {} as any;
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const status = await svc.check("claude");

    expect(status.cli).toBe("claude");
    expect(status.authenticated).toBe(true);
    expect(status.account).toBe("test@example.com");
  });

  it("JSON 출력 + loggedIn=false → authenticated=false", async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, JSON.stringify({ loggedIn: false }), "");
      return {} as any;
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const status = await svc.check("claude");

    expect(status.authenticated).toBe(false);
    expect(status.error).toBe("not logged in");
  });

  it("execFile 에러 → authenticated=false", async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(new Error("command not found"), "", "");
      return {} as any;
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const status = await svc.check("claude");

    expect(status.authenticated).toBe(false);
  });

  it("JSON 파싱 실패 + 에러 없음 → fallback authenticated=true", async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, "Logged in as user@test.com", "");
      return {} as any;
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const status = await svc.check("claude");

    expect(status.authenticated).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// check_codex
// ══════════════════════════════════════════════════════════

describe("CliAuthService — check_codex", () => {
  beforeEach(() => {
    // Claude는 항상 성공으로 mock
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, JSON.stringify({ loggedIn: true }), "");
      return {} as any;
    });
  });

  it("~/.codex 없음 → authenticated=false", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const svc = make_service();
    const status = await svc.check("codex");

    expect(status.authenticated).toBe(false);
    expect(status.error).toContain("not found");
  });

  it("~/.codex 있음 + auth 파일 → authenticated=true", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(["auth.json", "config.json"] as any);

    const svc = make_service();
    const status = await svc.check("codex");

    expect(status.authenticated).toBe(true);
    expect(status.account).toContain("auth.json");
  });

  it("~/.codex 있음 + config 파일만 → authenticated=true (config detected)", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(["settings.json"] as any);

    const svc = make_service();
    const status = await svc.check("codex");

    expect(status.authenticated).toBe(true);
    expect(status.account).toBe("config detected");
  });

  it("~/.codex 있음 + 빈 디렉토리 → authenticated=false", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const status = await svc.check("codex");

    expect(status.authenticated).toBe(false);
    expect(status.error).toContain("no auth files");
  });

  it("readdirSync 에러 → authenticated=false", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation(() => { throw new Error("permission denied"); });

    const svc = make_service();
    const status = await svc.check("codex");

    expect(status.authenticated).toBe(false);
    expect(status.error).toContain("cannot read");
  });
});

// ══════════════════════════════════════════════════════════
// check_gemini
// ══════════════════════════════════════════════════════════

describe("CliAuthService — check_gemini", () => {
  beforeEach(() => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, JSON.stringify({ loggedIn: true }), "");
      return {} as any;
    });
  });

  it("GEMINI_API_KEY 환경변수 있음 → authenticated=true", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const status = await svc.check("gemini");

    expect(status.authenticated).toBe(true);
    expect(status.account).toBe("GEMINI_API_KEY");
  });

  it("~/.gemini 없음 → authenticated=false", async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => !String(p).includes("gemini"));
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const status = await svc.check("gemini");

    expect(status.authenticated).toBe(false);
  });

  it("~/.gemini + oauth 파일 → authenticated=true", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(["oauth_creds.json", "config.json"] as any);

    const svc = make_service();
    const status = await svc.check("gemini");

    expect(status.authenticated).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// get_cached / get_all_cached / check_all
// ══════════════════════════════════════════════════════════

describe("CliAuthService — get_cached / check_all", () => {
  it("check 전 get_cached → authenticated=false", () => {
    const svc = make_service();
    const status = svc.get_cached("claude");
    expect(status.authenticated).toBe(false);
  });

  it("check 후 get_cached → 캐시 반환", async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, JSON.stringify({ loggedIn: true, email: "a@b.com" }), "");
      return {} as any;
    });
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    await svc.check("claude");
    const cached = svc.get_cached("claude");
    expect(cached.authenticated).toBe(true);
  });

  it("get_all_cached → 3개 CLI 상태 반환", () => {
    const svc = make_service();
    const all = svc.get_all_cached();
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.cli)).toEqual(["claude", "codex", "gemini"]);
  });

  it("check_all → 3개 모두 체크", async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, JSON.stringify({ loggedIn: false }), "");
      return {} as any;
    });
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const results = await svc.check_all();
    expect(results).toHaveLength(3);
  });
});
