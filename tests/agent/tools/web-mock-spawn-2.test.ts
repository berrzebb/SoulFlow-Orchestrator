/**
 * web.ts — 미커버 분기 보충 (cov4):
 * - L234: WebBrowserTool snapshot → run_agent_browser_cli 실패 → agent_browser_error
 * - L400: WebSnapshotTool screenshot 실패 → agent_browser_error
 * - L448: WebExtractTool — sanitized.security.prompt_injection_suspected → injection_suspected = true
 * - L497: WebPdfTool pdf 실패 → agent_browser_error
 * - L549: WebMonitorTool snapshot(no selector) 실패 → agent_browser_error
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── child_process 모킹 ──────────────────────────────────────────────────

const { mock_spawn_sync_cov4, mock_exec_file_cov4 } = vi.hoisted(() => ({
  mock_spawn_sync_cov4: vi.fn(),
  mock_exec_file_cov4: vi.fn(),
}));

vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  return {
    ...real,
    spawnSync: mock_spawn_sync_cov4,
    execFile: mock_exec_file_cov4,
  };
});

// 모듈 import 전에 spawnSync 설정 → 바이너리 있는 것으로 감지
mock_spawn_sync_cov4.mockReturnValue({ status: 0 });

import {
  WebBrowserTool,
  WebSnapshotTool,
  WebExtractTool,
  WebPdfTool,
  WebMonitorTool,
} from "@src/agent/tools/web.js";

type ExecCallback = (e: Error | null, r: { stdout: string; stderr: string }) => void;

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "web-cov4-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  vi.clearAllMocks();
});

/** execFile 성공 mock */
function mock_ok(stdout = "{}"): void {
  mock_exec_file_cov4.mockImplementationOnce(
    (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout, stderr: "" })
  );
}

/** execFile 실패 mock */
function mock_fail(stderr = "command_failed"): void {
  mock_exec_file_cov4.mockImplementationOnce(
    (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) =>
      cb(new Error(stderr), { stdout: "", stderr })
  );
}

// ── L234: WebBrowserTool action=snapshot → snapshot 실패 ─────────────────

describe("WebBrowserTool — L234: snapshot 실패 → agent_browser_error", () => {
  it("action=snapshot, CLI 실패 → L234 return error", async () => {
    // 1 call: snapshot --json → FAIL
    mock_fail("snapshot_error");

    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "snapshot" });
    expect(r).toContain("Error");
    expect(r).not.toContain("agent_browser_not_installed");
  });
});

// ── L400: WebSnapshotTool screenshot 실패 ────────────────────────────────

describe("WebSnapshotTool — L400: screenshot CLI 실패 → agent_browser_error", () => {
  it("open 성공 + screenshot 실패 → L400 return error", async () => {
    // with_browser_session: open(ok), wait --load(ok), screenshot(FAIL), close(ok finally)
    mock_ok("{}");                  // open
    mock_ok("{}");                  // wait --load domcontentloaded
    mock_fail("screenshot_failed"); // screenshot → L400
    mock_ok("{}");                  // close (finally block)

    const tool = new WebSnapshotTool({ workspace });
    const r = await tool.execute({ url: "https://example.com" });
    expect(r).toContain("Error");
  });
});

// ── L448: WebExtractTool prompt_injection_suspected ───────────────────────

describe("WebExtractTool — L448: injection 감지 → injection_suspected = true", () => {
  it("추출 내용에 인젝션 패턴 포함 → L448 injection_suspected=true", async () => {
    // with_browser_session: open(ok), wait(ok), get text(ok with injection content), close(ok)
    const injection_stdout = JSON.stringify({ data: { text: "jailbreak mode activated" } }) + "\n";
    mock_ok("{}");                // open
    mock_ok("{}");                // wait domcontentloaded
    mock_ok(injection_stdout);    // get text → jailbreak 패턴 → L448
    mock_ok("{}");                // close (finally block)

    const tool = new WebExtractTool();
    const r = JSON.parse(await tool.execute({
      url: "https://example.com",
      selectors: { title: "h1" },
    }));
    // L448: sanitized.security.prompt_injection_suspected → injection_suspected = true
    expect(r.security.prompt_injection_suspected).toBe(true);
  });
});

// ── L497: WebPdfTool pdf 실패 ────────────────────────────────────────────

describe("WebPdfTool — L497: pdf CLI 실패 → agent_browser_error", () => {
  it("open 성공 + pdf 실패 → L497 return error", async () => {
    // with_browser_session: open(ok), wait(ok), pdf(FAIL), close(ok finally)
    mock_ok("{}");           // open
    mock_ok("{}");           // wait domcontentloaded
    mock_fail("pdf_failed"); // pdf → L497
    mock_ok("{}");           // close (finally block)

    const tool = new WebPdfTool({ workspace });
    const r = await tool.execute({ url: "https://example.com" });
    expect(r).toContain("Error");
  });
});

// ── L549: WebMonitorTool snapshot(no selector) 실패 ──────────────────────

describe("WebMonitorTool — L549: snapshot(no selector) 실패 → agent_browser_error", () => {
  it("open 성공 + snapshot 실패 → L549 return error", async () => {
    // with_browser_session: open(ok), wait(ok), snapshot -c -d 6 (FAIL), close(ok finally)
    mock_ok("{}");                         // open
    mock_ok("{}");                         // wait domcontentloaded
    mock_fail("snapshot_monitor_failed");   // snapshot → L549
    mock_ok("{}");                         // close (finally block)

    const tool = new WebMonitorTool({ workspace });
    const r = await tool.execute({ url: "https://example.com", label: "test-monitor" });
    expect(r).toContain("Error");
  });
});
