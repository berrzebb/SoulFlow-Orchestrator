/**
 * WebAuthTool — agent-browser-client mock 기반 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type RunResult = { ok: boolean; stdout: string; stderr: string };

const { mock_run_ab } = vi.hoisted(() => ({
  mock_run_ab: vi.fn<() => Promise<RunResult>>(),
}));

vi.mock("@src/agent/tools/agent-browser-client.js", () => ({
  run_agent_browser: mock_run_ab,
}));

import { WebAuthTool } from "@src/agent/tools/web-auth.js";

function make_tool() { return new WebAuthTool(); }

const BASE_PARAMS = {
  login_url: "https://example.com/login",
  username_selector: "#username",
  password_selector: "#password",
  submit_selector: "#submit",
  username: "user@example.com",
  password: "secret123",
};

function ok_result(stdout = ""): RunResult {
  return { ok: true, stdout, stderr: "" };
}

function fail_result(msg = "error"): RunResult {
  return { ok: false, stdout: "", stderr: msg };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("WebAuthTool — 메타데이터", () => {
  it("name = web_auth", () => expect(make_tool().name).toBe("web_auth"));
  it("category = web", () => expect(make_tool().category).toBe("web"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// 파라미터 검증
// ══════════════════════════════════════════

describe("WebAuthTool — 파라미터 검증", () => {
  it("login_url 없음 → Error", async () => {
    const r = await make_tool().execute({ ...BASE_PARAMS, login_url: "" });
    expect(r).toContain("Error");
    expect(r).toContain("login_url");
  });

  it("signal aborted → Error: cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await make_tool().execute(BASE_PARAMS, { signal: ctrl.signal } as any);
    expect(r).toBe("Error: cancelled");
    expect(mock_run_ab).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// 성공 플로우
// ══════════════════════════════════════════

describe("WebAuthTool — 성공 플로우", () => {
  it("open 실패 → Error 반환", async () => {
    mock_run_ab.mockResolvedValueOnce(fail_result("ECONNREFUSED"));
    const r = await make_tool().execute(BASE_PARAMS);
    expect(r).toContain("Error");
    expect(r).toContain("ECONNREFUSED");
  });

  it("fill username 실패 → Error 반환", async () => {
    mock_run_ab
      .mockResolvedValueOnce(ok_result()) // open
      .mockResolvedValueOnce(ok_result()) // wait
      .mockResolvedValueOnce(fail_result("selector not found")); // fill username
    const r = await make_tool().execute(BASE_PARAMS);
    expect(r).toContain("Error");
    expect(r).toContain("username");
  });

  it("fill password 실패 → Error 반환", async () => {
    mock_run_ab
      .mockResolvedValueOnce(ok_result()) // open
      .mockResolvedValueOnce(ok_result()) // wait
      .mockResolvedValueOnce(ok_result()) // fill username
      .mockResolvedValueOnce(fail_result("password selector not found")); // fill password
    const r = await make_tool().execute(BASE_PARAMS);
    expect(r).toContain("Error");
    expect(r).toContain("password");
  });

  it("submit 실패 → Error 반환", async () => {
    mock_run_ab
      .mockResolvedValueOnce(ok_result()) // open
      .mockResolvedValueOnce(ok_result()) // wait
      .mockResolvedValueOnce(ok_result()) // fill username
      .mockResolvedValueOnce(ok_result()) // fill password
      .mockResolvedValueOnce(fail_result("submit button not found")); // click
    const r = await make_tool().execute(BASE_PARAMS);
    expect(r).toContain("Error");
    expect(r).toContain("submit");
  });

  it("success_indicator 없음 → authenticated=true", async () => {
    // open, wait, fill_user, fill_pass, click, wait_after
    mock_run_ab.mockResolvedValue(ok_result());
    const r = JSON.parse(await make_tool().execute(BASE_PARAMS));
    expect(r.authenticated).toBe(true);
    expect(r.url).toBe("https://example.com/login");
    expect(r.session).toBe("auth"); // 기본 세션명
  });

  it("success_indicator 있고 check ok → authenticated=true", async () => {
    mock_run_ab.mockResolvedValue(ok_result("Welcome!"));
    const r = JSON.parse(await make_tool().execute({
      ...BASE_PARAMS,
      success_indicator: ".welcome-message",
    }));
    expect(r.authenticated).toBe(true);
  });

  it("success_indicator 있고 check fail → authenticated=false", async () => {
    mock_run_ab
      .mockResolvedValueOnce(ok_result()) // open
      .mockResolvedValueOnce(ok_result()) // wait domcontentloaded
      .mockResolvedValueOnce(ok_result()) // fill username
      .mockResolvedValueOnce(ok_result()) // fill password
      .mockResolvedValueOnce(ok_result()) // click submit
      .mockResolvedValueOnce(ok_result()) // wait_after
      .mockResolvedValueOnce(fail_result("element not found")); // success_indicator check
    const r = JSON.parse(await make_tool().execute({
      ...BASE_PARAMS,
      success_indicator: ".welcome-message",
    }));
    expect(r.authenticated).toBe(false);
    expect(r.note).toContain("may have failed");
  });

  it("session 이름 지정", async () => {
    mock_run_ab.mockResolvedValue(ok_result());
    const r = JSON.parse(await make_tool().execute({
      ...BASE_PARAMS,
      session: "my-session",
    }));
    expect(r.session).toBe("my-session");
    // --session my-session 인수 포함 확인 (첫 번째 호출: open)
    expect(mock_run_ab).toHaveBeenCalledWith(
      expect.arrayContaining(["--session", "my-session"]),
      expect.anything(),
    );
  });

  it("기본 wait_after → open+wait+fill2+click+wait+done = 6번 호출", async () => {
    // wait_after_ms 생략 → 기본 3000ms → wait 호출됨
    mock_run_ab.mockResolvedValue(ok_result());
    await make_tool().execute(BASE_PARAMS);
    // open, wait(load), fill_user, fill_pass, click, wait_after = 6번
    expect(mock_run_ab).toHaveBeenCalledTimes(6);
  });

  it("note에 세션명 포함 (authenticated=true)", async () => {
    mock_run_ab.mockResolvedValue(ok_result());
    const r = JSON.parse(await make_tool().execute(BASE_PARAMS));
    expect(r.note).toContain("auth");
    expect(r.note).toContain("--session");
  });
});
