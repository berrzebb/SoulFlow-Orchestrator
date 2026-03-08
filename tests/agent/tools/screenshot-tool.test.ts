/**
 * ScreenshotTool — run_agent_browser mock 기반 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// agent-browser-client mock
vi.mock("@src/agent/tools/agent-browser-client.js", () => ({
  run_agent_browser: vi.fn(),
  detect_agent_browser_binary: vi.fn().mockReturnValue("agent-browser"),
}));

import { ScreenshotTool } from "@src/agent/tools/screenshot.js";
import * as ab_client from "@src/agent/tools/agent-browser-client.js";
const mock_run = ab_client.run_agent_browser as ReturnType<typeof vi.fn>;

function make_tool(): ScreenshotTool {
  return new ScreenshotTool({ workspace: "/tmp/test-workspace" });
}

function ok_result(parsed: Record<string, unknown> | null = null) {
  return { ok: true, stdout: "", stderr: "", parsed };
}

function fail_result(reason = "agent_browser_not_installed") {
  return { ok: false, stdout: "", stderr: "err", parsed: null, reason };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("ScreenshotTool — 메타데이터", () => {
  it("name = screenshot", () => expect(make_tool().name).toBe("screenshot"));
  it("category = web", () => expect(make_tool().category).toBe("web"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// 파라미터 검증
// ══════════════════════════════════════════

describe("ScreenshotTool — 파라미터 검증", () => {
  it("url 없음 → Error", async () => {
    const r = await make_tool().execute({ url: "" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("url");
  });
});

// ══════════════════════════════════════════
// 주요 흐름
// ══════════════════════════════════════════

describe("ScreenshotTool — open 실패", () => {
  it("open 단계 실패 → agent-browser not installed 반환", async () => {
    mock_run.mockResolvedValueOnce(fail_result());
    const r = await make_tool().execute({ url: "https://example.com" });
    expect(String(r)).toContain("agent-browser");
  });
});

describe("ScreenshotTool — 스크린샷 성공", () => {
  it("성공 흐름 → success:true JSON 반환", async () => {
    // open → ok, wait → ok, screenshot → ok, close → ok
    mock_run
      .mockResolvedValueOnce(ok_result()) // open
      .mockResolvedValueOnce(ok_result()) // wait
      .mockResolvedValueOnce(ok_result()) // screenshot
      .mockResolvedValueOnce(ok_result()); // close

    const r = JSON.parse(await make_tool().execute({
      url: "https://example.com",
      delay_ms: 0,
    }));
    expect(r.success).toBe(true);
    expect(r.url).toBe("https://example.com");
  });

  it("full_page=true → 플래그 포함", async () => {
    mock_run
      .mockResolvedValueOnce(ok_result())
      .mockResolvedValueOnce(ok_result())
      .mockResolvedValueOnce(ok_result())
      .mockResolvedValueOnce(ok_result());

    const r = JSON.parse(await make_tool().execute({
      url: "https://example.com",
      full_page: true,
      delay_ms: 0,
    }));
    expect(r.full_page).toBe(true);
  });

  it("selector 지정 → selector 반환", async () => {
    mock_run
      .mockResolvedValueOnce(ok_result())
      .mockResolvedValueOnce(ok_result())
      .mockResolvedValueOnce(ok_result())
      .mockResolvedValueOnce(ok_result());

    const r = JSON.parse(await make_tool().execute({
      url: "https://example.com",
      selector: ".main-content",
      delay_ms: 0,
    }));
    expect(r.selector).toBe(".main-content");
  });

  it("screenshot 단계 실패 → Error 반환", async () => {
    mock_run
      .mockResolvedValueOnce(ok_result())
      .mockResolvedValueOnce(ok_result())
      .mockResolvedValueOnce(fail_result("agent_browser_exec_failed"))
      .mockResolvedValueOnce(ok_result());

    const r = await make_tool().execute({ url: "https://example.com", delay_ms: 0 });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("screenshot");
  });

  it("예외 발생 → Error + close 호출", async () => {
    mock_run
      .mockResolvedValueOnce(ok_result())
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(ok_result()); // close

    const r = await make_tool().execute({ url: "https://example.com", delay_ms: 0 });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("timeout");
  });

  it("신호 취소 → Error: cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await make_tool().execute(
      { url: "https://example.com" },
      { signal: controller.signal } as any
    );
    expect(String(r)).toContain("cancelled");
  });
});
