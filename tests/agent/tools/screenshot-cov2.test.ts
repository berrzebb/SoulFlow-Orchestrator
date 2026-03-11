/**
 * screenshot.ts — 미커버 분기 (cov2):
 * - L64: delay_ms > 0 → await sleep(delay_ms) 실행
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@src/agent/tools/agent-browser-client.js", () => ({
  run_agent_browser: vi.fn(),
  detect_agent_browser_binary: vi.fn().mockReturnValue("agent-browser"),
}));

import { ScreenshotTool } from "@src/agent/tools/screenshot.js";
import * as ab_client from "@src/agent/tools/agent-browser-client.js";
const mock_run = ab_client.run_agent_browser as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

// ── L64: delay_ms > 0 → sleep 호출 ──────────────────────────────────────────

describe("ScreenshotTool — L64: delay_ms > 0 → sleep 실행", () => {
  it("delay_ms=1 → sleep 호출 후 screenshot 완료 (L64)", async () => {
    mock_run
      .mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", parsed: null }) // open
      .mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", parsed: null }) // wait
      .mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", parsed: null }) // screenshot
      .mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", parsed: null }); // close

    const tool = new ScreenshotTool({ workspace: "/tmp/test-workspace" });
    const r = JSON.parse(await tool.execute({
      url: "https://example.com",
      delay_ms: 1,  // > 0 → L64 sleep 실행
    }));

    expect(r.success).toBe(true);
    expect(r.url).toBe("https://example.com");
  });
});
