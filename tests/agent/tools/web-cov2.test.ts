/**
 * web.ts — 미커버 분기 보충 (agent-browser 설치됨 경로).
 * 이 파일은 별도 모듈 인스턴스로 로드 → cached_agent_browser_bin 초기화됨.
 * 커버: 브라우저 성공 경로, WebMonitorTool 2회 실행, extract_search_results,
 *       IPv6 blocked, 0.0.0.0, parse_last_json_line, compact_session_name,
 *       with_browser_session(wait_ms>0), WebExtractTool 빈 selector.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── child_process 모킹 ──────────────────────────────────────────────────

const { mock_spawn_sync_cov2, mock_exec_file_cov2 } = vi.hoisted(() => ({
  mock_spawn_sync_cov2: vi.fn(),
  mock_exec_file_cov2: vi.fn(),
}));

vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  return {
    ...real,
    spawnSync: mock_spawn_sync_cov2,
    execFile: mock_exec_file_cov2,
  };
});

// 모듈 import 전에 spawnSync 설정 → 바이너리 있는 것으로 감지
mock_spawn_sync_cov2.mockReturnValue({ status: 0 });

import {
  WebFetchTool,
  WebSearchTool,
  WebBrowserTool,
  WebSnapshotTool,
  WebExtractTool,
  WebPdfTool,
  WebMonitorTool,
} from "@src/agent/tools/web.js";

type ExecCallback = (e: Error | null, r: { stdout: string; stderr: string }) => void;

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "web-cov2-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  vi.clearAllMocks();
});

/** execFile 성공 mock (JSON stdout 포함) */
function mock_success(stdout_json: object, calls = 10): void {
  const stdout = JSON.stringify({ data: stdout_json }) + "\n";
  for (let i = 0; i < calls; i++) {
    mock_exec_file_cov2.mockImplementationOnce(
      (_cmd: unknown, _args: unknown, _opts: unknown, cb: ExecCallback) => {
        cb(null, { stdout, stderr: "" });
      }
    );
  }
}

function mock_exec_sequence(...responses: Array<{ ok: boolean; stdout?: string; stderr?: string }>) {
  for (const resp of responses) {
    if (resp.ok) {
      mock_exec_file_cov2.mockImplementationOnce(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: ExecCallback) => {
          cb(null, { stdout: resp.stdout ?? "{}", stderr: "" });
        }
      );
    } else {
      mock_exec_file_cov2.mockImplementationOnce(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: ExecCallback) => {
          cb(new Error(resp.stderr ?? "failed"), { stdout: "", stderr: resp.stderr ?? "failed" });
        }
      );
    }
  }
}

// ══════════════════════════════════════════
// validate_url — IPv6 및 0.0.0.0
// ══════════════════════════════════════════

describe("WebFetchTool — validate_url IPv6/0.0.0.0", () => {
  it("::1 (IPv6 loopback) → blocked_private_host", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "http://[::1]/path" });
    expect(String(r)).toContain("blocked_private_host");
  });

  it("0.0.0.0 → blocked_private_host", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "http://0.0.0.0/path" });
    expect(String(r)).toContain("blocked_private_host");
  });
});

// ══════════════════════════════════════════
// WebFetchTool — 설치됨 경로
// ══════════════════════════════════════════

describe("WebFetchTool — agent-browser 설치됨 성공 경로", () => {
  it("get_text 성공 → text 반환", async () => {
    // open, wait, get text (success with text data)
    const text_stdout = JSON.stringify({ data: { text: "Hello World" } }) + "\n";
    mock_exec_file_cov2
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // open
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // wait
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: text_stdout, stderr: "" })); // get text

    const tool = new WebFetchTool();
    const r = JSON.parse(await tool.execute({ url: "https://example.com", max_chars: 1000 }));
    expect(r.url).toBe("https://example.com");
    expect(r.text).toContain("Hello World");
  });

  it("get_text 빈 결과 → snapshot fallback", async () => {
    const snapshot_stdout = JSON.stringify({ data: { snapshot: "Snapshot content" } }) + "\n";
    mock_exec_file_cov2
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // open
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // wait
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: '{"data":{}}', stderr: "" })) // get text (empty)
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: snapshot_stdout, stderr: "" })); // snapshot fallback

    const tool = new WebFetchTool();
    const r = JSON.parse(await tool.execute({ url: "https://example.com" }));
    expect(r.text).toContain("Snapshot content");
  });

  it("get_text 빈 결과 + snapshot 실패 → error 반환", async () => {
    mock_exec_file_cov2
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // open
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // wait
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: '{"data":{}}', stderr: "" })) // get text (empty)
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("snapshot fail"), { stdout: "", stderr: "snapshot fail" })); // snapshot fail

    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "https://example.com" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// WebSearchTool — 설치됨 경로
// ══════════════════════════════════════════

describe("WebSearchTool — agent-browser 설치됨 성공 경로", () => {
  it("open 실패 → error 반환", async () => {
    mock_exec_file_cov2.mockImplementationOnce(
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("open failed"), { stdout: "", stderr: "open failed" })
    );
    const tool = new WebSearchTool();
    const r = await tool.execute({ query: "test query" });
    expect(r).toContain("Error");
  });

  it("snapshot 성공 → results 포함 JSON 반환", async () => {
    const snapshot_text = `link "Example Result" [ref=abc123]`;
    const snap_stdout = JSON.stringify({ data: { snapshot: snapshot_text } }) + "\n";
    mock_exec_file_cov2
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // open
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // wait
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: snap_stdout, stderr: "" })); // snapshot

    const tool = new WebSearchTool();
    const r = JSON.parse(await tool.execute({ query: "example", count: 3 }));
    expect(r.query).toBe("example");
    expect(r.results).toBeInstanceOf(Array);
    expect(r.results[0].title).toBe("Example Result");
    expect(r.results[0].ref).toBe("abc123");
  });

  it("snapshot 실패 → error 반환", async () => {
    mock_exec_file_cov2
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // open
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // wait
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("snap fail"), { stdout: "", stderr: "snap fail" })); // snapshot fail

    const tool = new WebSearchTool();
    const r = await tool.execute({ query: "test" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// WebBrowserTool — 성공 경로 (browser 설치됨)
// ══════════════════════════════════════════

describe("WebBrowserTool — 성공 경로", () => {
  it("open 성공 → ok=true", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }));
    const tool = new WebBrowserTool();
    const r = JSON.parse(await tool.execute({ action: "open", url: "https://example.com" }));
    expect(r.ok).toBe(true);
    expect(r.action).toBe("open");
  });

  it("snapshot 성공 → text 포함", async () => {
    const snap_stdout = JSON.stringify({ data: { snapshot: "page content", refs: { a: "https://example.com" } } }) + "\n";
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: snap_stdout, stderr: "" }));
    const tool = new WebBrowserTool();
    const r = JSON.parse(await tool.execute({ action: "snapshot" }));
    expect(r.action).toBe("snapshot");
    expect(r.text).toContain("page content");
  });

  it("click 성공 → ok=true", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }));
    const tool = new WebBrowserTool();
    const r = JSON.parse(await tool.execute({ action: "click", selector: "#btn" }));
    expect(r.ok).toBe(true);
    expect(r.selector).toBe("#btn");
  });

  it("click 실패 → error 반환", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("click fail"), { stdout: "", stderr: "click fail" }));
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "click", selector: "#btn" });
    expect(r).toContain("Error");
  });

  it("fill 성공 → ok=true", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }));
    const tool = new WebBrowserTool();
    const r = JSON.parse(await tool.execute({ action: "fill", selector: "#input", text: "hello" }));
    expect(r.ok).toBe(true);
  });

  it("fill 실패 → error 반환", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("fill fail"), { stdout: "", stderr: "fill fail" }));
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "fill", selector: "#input", text: "hi" });
    expect(r).toContain("Error");
  });

  it("wait selector 성공 → ok=true, selector 포함", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }));
    const tool = new WebBrowserTool();
    const r = JSON.parse(await tool.execute({ action: "wait", selector: ".loaded" }));
    expect(r.ok).toBe(true);
    expect(r.selector).toBe(".loaded");
  });

  it("wait ms 성공 → ok=true, wait_ms 포함", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }));
    const tool = new WebBrowserTool();
    const r = JSON.parse(await tool.execute({ action: "wait", wait_ms: 500 }));
    expect(r.ok).toBe(true);
    expect(r.wait_ms).toBe(500);
  });

  it("wait 실패 → error 반환", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("wait fail"), { stdout: "", stderr: "wait fail" }));
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "wait", selector: ".el" });
    expect(r).toContain("Error");
  });

  it("get_text 성공 → data 포함", async () => {
    const txt_stdout = JSON.stringify({ data: { text: "extracted text" } }) + "\n";
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: txt_stdout, stderr: "" }));
    const tool = new WebBrowserTool();
    const r = JSON.parse(await tool.execute({ action: "get_text", selector: "h1" }));
    expect(r.ok).toBe(true);
  });

  it("get_text 실패 → error 반환", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("get fail"), { stdout: "", stderr: "get fail" }));
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "get_text", selector: "h1" });
    expect(r).toContain("Error");
  });

  it("screenshot 성공 → ok=true", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }));
    const tool = new WebBrowserTool();
    const r = JSON.parse(await tool.execute({ action: "screenshot" }));
    expect(r.ok).toBe(true);
    expect(r.action).toBe("screenshot");
  });

  it("screenshot full_page+annotate → 플래그 전달", async () => {
    let captured_args: string[] = [];
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, args: string[], _o: unknown, cb: ExecCallback) => {
      captured_args = args as string[];
      cb(null, { stdout: "{}", stderr: "" });
    });
    const tool = new WebBrowserTool();
    await tool.execute({ action: "screenshot", full_page: true, annotate: true });
    // Windows: cmd.exe /d /s /c "agent-browser.cmd ..." → inspect joined command
    const cmd_str = captured_args.join(" ");
    expect(cmd_str).toContain("--full");
    expect(cmd_str).toContain("--annotate");
  });

  it("screenshot with path → 경로 전달", async () => {
    let captured_args: string[] = [];
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, args: string[], _o: unknown, cb: ExecCallback) => {
      captured_args = args as string[];
      cb(null, { stdout: "{}", stderr: "" });
    });
    const tool = new WebBrowserTool();
    await tool.execute({ action: "screenshot", path: "/tmp/screen.png" });
    const cmd_str = captured_args.join(" ");
    expect(cmd_str).toContain("screen.png");
  });

  it("screenshot 실패 → error 반환", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("shot fail"), { stdout: "", stderr: "shot fail" }));
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "screenshot" });
    expect(r).toContain("Error");
  });

  it("close 성공 → ok=true", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }));
    const tool = new WebBrowserTool();
    const r = JSON.parse(await tool.execute({ action: "close" }));
    expect(r.ok).toBe(true);
    expect(r.action).toBe("close");
  });

  it("close 실패 → error 반환", async () => {
    mock_exec_file_cov2.mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("close fail"), { stdout: "", stderr: "close fail" }));
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "close" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// WebMonitorTool — 첫 실행 → 두 번째 실행 (변경/변경없음)
// ══════════════════════════════════════════

function make_monitor_exec_seq(snapshot_text: string) {
  const snap_stdout = JSON.stringify({ data: { snapshot: snapshot_text } }) + "\n";
  // open, wait, snapshot, close
  [
    (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // open
    (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // wait domcontentloaded
    (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: snap_stdout, stderr: "" }), // snapshot
    (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // close
  ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));
}

describe("WebMonitorTool — 첫 실행 + 두 번째 실행", () => {
  it("첫 실행 → first_run=true", async () => {
    make_monitor_exec_seq("Initial content line 1\nLine 2");
    const tool = new WebMonitorTool({ workspace });
    const r = JSON.parse(await tool.execute({ url: "https://example.com", label: "first-run-test" }));
    expect(r.first_run).toBe(true);
    expect(r.changed).toBe(false);
  });

  it("두 번째 실행 (내용 변경됨) → changed=true", async () => {
    // 첫 실행
    make_monitor_exec_seq("Original line 1\nOriginal line 2");
    const tool = new WebMonitorTool({ workspace });
    await tool.execute({ url: "https://example.com", label: "change-test" });

    // 두 번째 실행 (내용 변경)
    make_monitor_exec_seq("New content line 1\nNew line 2");
    const r = JSON.parse(await tool.execute({ url: "https://example.com", label: "change-test" }));
    expect(r.changed).toBe(true);
    expect(r.diff.added).toBeGreaterThan(0);
  });

  it("두 번째 실행 (내용 동일) → changed=false", async () => {
    // 첫 실행
    make_monitor_exec_seq("Same content line");
    const tool = new WebMonitorTool({ workspace });
    await tool.execute({ url: "https://example.com", label: "no-change-test" });

    // 두 번째 실행 (동일 내용)
    make_monitor_exec_seq("Same content line");
    const r = JSON.parse(await tool.execute({ url: "https://example.com", label: "no-change-test" }));
    expect(r.changed).toBe(false);
    expect(r.diff.added).toBe(0);
    expect(r.diff.removed).toBe(0);
  });
});

describe("WebMonitorTool — selector 사용", () => {
  it("selector 지정 → get text 사용", async () => {
    const txt_stdout = JSON.stringify({ data: { text: "Specific text" } }) + "\n";
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // open
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // wait
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: txt_stdout, stderr: "" }), // get text
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // close
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebMonitorTool({ workspace });
    const r = JSON.parse(await tool.execute({ url: "https://example.com", label: "selector-test", selector: "main" }));
    expect(r.first_run).toBe(true);
  });

  it("selector get_text 실패 → error 반환", async () => {
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),           // open
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),           // wait
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("get fail"), { stdout: "", stderr: "get fail" }), // get text fail
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),           // close
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebMonitorTool({ workspace });
    const r = await tool.execute({ url: "https://example.com", label: "fail-test", selector: "main" });
    expect(r).toContain("Error");
  });
});

describe("WebMonitorTool — max_chars 초과 절단", () => {
  it("max_chars=100 → 100자로 절단", async () => {
    const long_text = "A".repeat(500);
    make_monitor_exec_seq(long_text);
    const tool = new WebMonitorTool({ workspace });
    const r = JSON.parse(await tool.execute({ url: "https://example.com", label: "maxchars-test", max_chars: 100 }));
    expect(r.snapshot_length).toBeLessThanOrEqual(100);
  });
});

// ══════════════════════════════════════════
// WebSnapshotTool — 성공 경로
// ══════════════════════════════════════════

describe("WebSnapshotTool — 성공 경로", () => {
  it("screenshot 성공 → path 반환", async () => {
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // open
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // wait
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // screenshot
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // close
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebSnapshotTool({ workspace });
    const r = JSON.parse(await tool.execute({ url: "https://example.com" }));
    expect(r.ok).toBe(true);
    expect(r.path).toContain(".png");
  });

  it("explicit path 지정 → 해당 경로 사용", async () => {
    const out_path = join(workspace, "custom.png");
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // open
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // wait
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // screenshot
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // close
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebSnapshotTool({ workspace });
    const r = JSON.parse(await tool.execute({ url: "https://example.com", path: out_path }));
    expect(r.path).toBe(out_path);
  });

  it("full_page+annotate 플래그", async () => {
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebSnapshotTool({ workspace });
    const r = JSON.parse(await tool.execute({ url: "https://example.com", full_page: true, annotate: true }));
    expect(r.full_page).toBe(true);
    expect(r.annotate).toBe(true);
  });
});

// ══════════════════════════════════════════
// WebPdfTool — 성공 경로
// ══════════════════════════════════════════

describe("WebPdfTool — 성공 경로", () => {
  it("pdf 저장 성공 → path 반환", async () => {
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // open
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // wait
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // pdf
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),   // close
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebPdfTool({ workspace });
    const r = JSON.parse(await tool.execute({ url: "https://example.com" }));
    expect(r.ok).toBe(true);
    expect(r.path).toContain(".pdf");
  });

  it("explicit path 지정", async () => {
    const out_path = join(workspace, "output.pdf");
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebPdfTool({ workspace });
    const r = JSON.parse(await tool.execute({ url: "https://example.com", path: out_path }));
    expect(r.path).toBe(out_path);
  });
});

// ══════════════════════════════════════════
// WebExtractTool — 성공 경로 + 빈 selector
// ══════════════════════════════════════════

describe("WebExtractTool — 성공 경로", () => {
  it("selector 추출 성공 → extracted 포함", async () => {
    const txt_stdout = JSON.stringify({ data: { text: "Page title" } }) + "\n";
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // open
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // wait
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: txt_stdout, stderr: "" }), // get text (title)
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // close
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebExtractTool();
    const r = JSON.parse(await tool.execute({ url: "https://example.com", selectors: { title: "h1" } }));
    expect(r.extracted.title).toContain("Page title");
  });

  it("빈 selector 값 → extracted[key]='' (스킵)", async () => {
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // open
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // wait
      // 빈 selector: get text 미호출
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),      // close
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebExtractTool();
    const r = JSON.parse(await tool.execute({ url: "https://example.com", selectors: { title: "" } }));
    expect(r.extracted.title).toBe("");
  });

  it("selector get_text 실패 → error 메시지 포함", async () => {
    [
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),           // open
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),           // wait
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(new Error("not found"), { stdout: "", stderr: "not found" }), // get text fail
      (_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }),           // close
    ].forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebExtractTool();
    const r = JSON.parse(await tool.execute({ url: "https://example.com", selectors: { content: ".main" } }));
    expect(r.extracted.content).toContain("error");
  });
});

// ══════════════════════════════════════════
// with_browser_session — wait_ms > 0
// ══════════════════════════════════════════

describe("WebSnapshotTool — wait_ms > 0 (with_browser_session extra wait)", () => {
  it("wait_ms=500 → 추가 wait 명령 전송됨", async () => {
    const calls: string[][] = [];
    const make_impl = () => (_c: unknown, args: string[], _o: unknown, cb: ExecCallback) => {
      calls.push(args as string[]);
      cb(null, { stdout: "{}", stderr: "" });
    };
    // open, wait domcontentloaded, wait 500ms, screenshot, close
    [make_impl(), make_impl(), make_impl(), make_impl(), make_impl()]
      .forEach((impl) => mock_exec_file_cov2.mockImplementationOnce(impl));

    const tool = new WebSnapshotTool({ workspace });
    await tool.execute({ url: "https://example.com", wait_ms: 500 });

    // 최소 5번 호출됨 (open + wait + extra_wait + screenshot + close)
    expect(calls.length).toBeGreaterThanOrEqual(5);
    // extra wait 호출에 "500" 포함됨
    const all_args = calls.map((a) => a.join(" "));
    const has_wait_500 = all_args.some((s) => s.includes("500") && s.includes("wait"));
    expect(has_wait_500).toBe(true);
  });
});

// ══════════════════════════════════════════
// compact_session_name — context 사용
// ══════════════════════════════════════════

describe("WebFetchTool — compact_session_name context", () => {
  it("context channel+chat_id → session 생성됨", async () => {
    // get_text + snapshot 둘 다 실패하면 error지만 session은 생성됨
    mock_exec_file_cov2
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // open
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // wait
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: '{"data":{"text":"content"}}', stderr: "" })); // get text

    const tool = new WebFetchTool();
    const r = JSON.parse(await tool.execute(
      { url: "https://example.com" },
      { channel: "my-channel", chat_id: "C12345" } as any,
    ));
    expect(r.session).toContain("my-channel");
    expect(r.session).toContain("c12345");
  });
});

// ══════════════════════════════════════════
// extract_search_results — 중복 제거
// ══════════════════════════════════════════

describe("extract_search_results (WebSearchTool 간접)", () => {
  it("중복 링크 제거됨", async () => {
    const snapshot = [
      `link "Dup Title" [ref=r1]`,
      `link "Dup Title" [ref=r1]`,  // 중복
      `link "Other" [ref=r2]`,
    ].join("\n");
    const snap_stdout = JSON.stringify({ data: { snapshot } }) + "\n";
    mock_exec_file_cov2
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // open
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" })) // wait
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: snap_stdout, stderr: "" })); // snapshot

    const tool = new WebSearchTool();
    const r = JSON.parse(await tool.execute({ query: "test", count: 10 }));
    // 중복 제거로 2개만 나와야 함
    expect(r.results).toHaveLength(2);
    expect(r.results[0].ref).toBe("r1");
    expect(r.results[1].ref).toBe("r2");
  });

  it("ref 없는 링크 → ref=null", async () => {
    const snapshot = `link "No Ref Title"`;
    const snap_stdout = JSON.stringify({ data: { snapshot } }) + "\n";
    mock_exec_file_cov2
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }))
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: "{}", stderr: "" }))
      .mockImplementationOnce((_c: unknown, _a: unknown, _o: unknown, cb: ExecCallback) => cb(null, { stdout: snap_stdout, stderr: "" }));

    const tool = new WebSearchTool();
    const r = JSON.parse(await tool.execute({ query: "test" }));
    expect(r.results[0].ref).toBeNull();
  });
});
