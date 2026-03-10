/**
 * CliAuthService — 미커버 분기 (cov2):
 * - L144: check_gemini() — readdirSync throw → "cannot read ~/.gemini/"
 * - L154-155: check_gemini() — config/json 파일만 있음 → "config detected"
 * - L158: check_gemini() — 파일 없음 → "no auth files"
 * - L174-175: extract_account() — 이메일 없음 + 짧은 첫 줄 → 첫 줄 반환
 * - L177: extract_account() — 이메일 없음 + 빈 출력 → null
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

function make_service() {
  return new CliAuthService({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GEMINI_API_KEY;
  // claude execFile 기본 mock
  vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
    callback(null, JSON.stringify({ loggedIn: true }), "");
    return {} as any;
  });
});

// ── check_gemini — readdirSync throw (L144) ─────────────────────────────

describe("check_gemini — readdirSync 실패 (L144)", () => {
  it("readdirSync throw → cannot read ~/.gemini/", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation(() => { throw new Error("permission denied"); });

    const svc = make_service();
    const status = await svc.check("gemini");

    expect(status.authenticated).toBe(false);
    expect(status.error).toContain("cannot read");
  });
});

// ── check_gemini — config 파일만 있음 (L154-155) ───────────────────────

describe("check_gemini — config 파일만 (L154-155)", () => {
  it("config 포함 파일 → config detected", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(["config.yaml", "settings.json"] as any);

    const svc = make_service();
    const status = await svc.check("gemini");

    expect(status.authenticated).toBe(true);
    expect(status.account).toBe("config detected");
  });

  it(".json 확장자 파일 → config detected", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(["preferences.json"] as any);

    const svc = make_service();
    const status = await svc.check("gemini");

    expect(status.authenticated).toBe(true);
    expect(status.account).toBe("config detected");
  });
});

// ── check_gemini — 파일 없음 (L158) ─────────────────────────────────────

describe("check_gemini — 인증 파일 없음 (L158)", () => {
  it("빈 디렉토리 → no auth files", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const svc = make_service();
    const status = await svc.check("gemini");

    expect(status.authenticated).toBe(false);
    expect(status.error).toContain("no auth files");
  });

  it("이름에 auth/credential/token/oauth/config/json 없는 파일들 → no auth files", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(["readme.txt", "notes.md"] as any);

    const svc = make_service();
    const status = await svc.check("gemini");

    expect(status.authenticated).toBe(false);
    expect(status.error).toContain("no auth files");
  });
});

// ── extract_account via check_claude — L174-177 ──────────────────────────

describe("check_claude — extract_account 분기 (L174-177)", () => {
  it("이메일 없음 + 짧은 텍스트 첫 줄 → 첫 줄 반환 (L174-175)", async () => {
    // JSON 아니고 error 없는 출력 → extract_account 호출
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, "Logged in as: testuser", "");
      return {} as any;
    });

    const svc = make_service();
    const status = await svc.check("claude");

    expect(status.authenticated).toBe(true);
    expect(status.account).toBe("Logged in as: testuser");
  });

  it("이메일 없음 + 빈 출력 → account undefined (L177 null 반환)", async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, "", "");
      return {} as any;
    });

    const svc = make_service();
    const status = await svc.check("claude");

    expect(status.authenticated).toBe(true);
    expect(status.account).toBeUndefined();
  });

  it("이메일 없음 + 100자 이상 첫 줄 → account undefined (L177 null 반환)", async () => {
    const long_line = "x".repeat(101);
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, long_line, "");
      return {} as any;
    });

    const svc = make_service();
    const status = await svc.check("claude");

    expect(status.authenticated).toBe(true);
    expect(status.account).toBeUndefined();
  });
});
