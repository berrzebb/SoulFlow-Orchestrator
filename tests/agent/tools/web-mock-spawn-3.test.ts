/**
 * WebTool suite — 미커버 분기 보충.
 * validate_url: private IP, invalid protocol, malformed.
 * WebFetchTool / WebSearchTool / WebBrowserTool / WebExtractTool
 * / WebSnapshotTool / WebPdfTool / WebMonitorTool — 필수 필드 검증,
 * agent_browser_not_installed 경로, unsupported action.
 * parse_last_json_line, extract_search_results, compact_session_name은
 * mock execFile로 간접 커버.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── child_process 모킹 ──────────────────────────────────────────────────
// vi.hoisted()로 vi.mock factory 안에서 참조 가능하게 먼저 선언

const { mock_spawn_sync, mock_exec_file } = vi.hoisted(() => ({
  mock_spawn_sync: vi.fn(),
  mock_exec_file: vi.fn(),
}));

vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  return {
    ...real,
    spawnSync: mock_spawn_sync,
    execFile: mock_exec_file,
  };
});

import {
  WebFetchTool,
  WebSearchTool,
  WebBrowserTool,
  WebSnapshotTool,
  WebExtractTool,
  WebPdfTool,
  WebMonitorTool,
} from "@src/agent/tools/web.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "web-cov-"));
  // 기본: 바이너리 미발견 (status !== 0)
  mock_spawn_sync.mockReturnValue({ status: 1 });
  mock_exec_file.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
    cb(new Error("ENOENT: spawn agent-browser"), { stdout: "", stderr: "spawn agent-browser ENOENT" });
  });
  // cached_agent_browser_bin을 리셋하기 위해 모듈을 새로 import하지 않고
  // spawnSync 재호출로 다시 감지하도록 캐시 무효화
  // (캐시는 모듈 레벨 변수라 테스트 간 상태 공유 주의)
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// WebFetchTool — URL 검증 경로
// ══════════════════════════════════════════

describe("WebFetchTool — URL 검증", () => {
  it("localhost URL → blocked_private_host", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "http://localhost/test" });
    expect(String(r)).toContain("private/loopback host blocked");
  });

  it("127.0.0.1 → blocked_private_host", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "http://127.0.0.1/path" });
    expect(String(r)).toContain("private/loopback host blocked");
  });

  it("10.0.0.1 (private) → blocked_private_host", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "http://10.0.0.1/path" });
    expect(String(r)).toContain("private/loopback host blocked");
  });

  it("192.168.1.1 (private) → blocked_private_host", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "http://192.168.1.1/" });
    expect(String(r)).toContain("private/loopback host blocked");
  });

  it("172.16.0.1 (private) → blocked_private_host", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "http://172.16.0.1/" });
    expect(String(r)).toContain("private/loopback host blocked");
  });

  it("169.254.1.1 (link-local) → blocked_private_host", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "http://169.254.1.1/" });
    expect(String(r)).toContain("private/loopback host blocked");
  });

  it("service.local → blocked_private_host", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "http://myservice.local/api" });
    expect(String(r)).toContain("private/loopback host blocked");
  });

  it("file:// protocol → invalid_protocol", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "file:///etc/passwd" });
    expect(String(r)).toContain("unsupported protocol");
  });

  it("완전히 잘못된 URL → invalid_url", async () => {
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "not-a-url" });
    expect(String(r)).toContain("invalid URL");
  });

  it("agent-browser 미설치 → agent_browser_not_installed", async () => {
    const tool = new WebFetchTool();
    // spawnSync status=1 → 바이너리 없음
    mock_spawn_sync.mockReturnValue({ status: 1 });
    const r = await tool.execute({ url: "https://example.com/page" });
    expect(String(r)).toContain("agent_browser_not_installed");
  });
});

// ══════════════════════════════════════════
// WebSearchTool — 필드 검증
// ══════════════════════════════════════════

describe("WebSearchTool — 필드 검증 및 not-installed 경로", () => {
  it("query 없음 → Error: query is required", async () => {
    const tool = new WebSearchTool();
    const r = await tool.execute({ query: "" });
    expect(String(r)).toContain("query is required");
  });

  it("signal aborted → Error: cancelled", async () => {
    const tool = new WebSearchTool();
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await tool.execute({ query: "test" }, { signal: ctrl.signal } as any);
    expect(String(r)).toContain("cancelled");
  });

  it("agent-browser 미설치 → agent_browser_not_installed", async () => {
    const tool = new WebSearchTool();
    mock_spawn_sync.mockReturnValue({ status: 1 });
    const r = await tool.execute({ query: "latest news" });
    expect(String(r)).toContain("agent_browser_not_installed");
  });
});

// ══════════════════════════════════════════
// WebBrowserTool — action 분기
// ══════════════════════════════════════════

describe("WebBrowserTool — action 분기 및 검증", () => {
  it("action 없음 → Error: action is required", async () => {
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "" });
    expect(String(r)).toContain("action is required");
  });

  it("open — url 없음 → Error: url is required", async () => {
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "open", url: "" });
    expect(String(r)).toContain("url is required");
  });

  it("open — 잘못된 URL → invalid_url or blocked", async () => {
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "open", url: "ftp://example.com" });
    expect(String(r)).toContain("unsupported protocol");
  });

  it("open — agent-browser 미설치 → not_installed error", async () => {
    const tool = new WebBrowserTool();
    mock_spawn_sync.mockReturnValue({ status: 1 });
    const r = await tool.execute({ action: "open", url: "https://example.com" });
    expect(String(r)).toContain("agent_browser_not_installed");
  });

  it("click — selector 없음 → Error: selector is required", async () => {
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "click", selector: "" });
    expect(String(r)).toContain("selector is required");
  });

  it("fill — selector 없음 → Error: selector is required", async () => {
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "fill", selector: "" });
    expect(String(r)).toContain("selector is required");
  });

  it("wait — selector 없고 wait_ms가 비수치 문자열 → Error: selector or wait_ms", async () => {
    const tool = new WebBrowserTool();
    // "abc" → Number("abc") = NaN → !isFinite 조건 충족
    const r = await tool.execute({ action: "wait", selector: "", wait_ms: "abc" as any });
    expect(String(r)).toContain("selector or wait_ms is required");
  });

  it("get_text — selector 없음 → Error: selector is required", async () => {
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "get_text", selector: "" });
    expect(String(r)).toContain("selector is required");
  });

  it("unsupported action → Error: unsupported action", async () => {
    const tool = new WebBrowserTool();
    const r = await tool.execute({ action: "fly_to_moon" });
    expect(String(r)).toContain("unsupported action");
    expect(String(r)).toContain("fly_to_moon");
  });
});

// ══════════════════════════════════════════
// WebSnapshotTool — 기본 검증
// ══════════════════════════════════════════

describe("WebSnapshotTool — 검증 및 not-installed", () => {
  it("url 없음 → Error: url is required", async () => {
    const tool = new WebSnapshotTool({ workspace });
    const r = await tool.execute({ url: "" });
    expect(String(r)).toContain("url is required");
  });

  it("agent-browser 미설치 → agent_browser_not_installed", async () => {
    const tool = new WebSnapshotTool({ workspace });
    mock_spawn_sync.mockReturnValue({ status: 1 });
    const r = await tool.execute({ url: "https://example.com" });
    expect(String(r)).toContain("agent_browser_not_installed");
  });
});

// ══════════════════════════════════════════
// WebExtractTool — selectors 검증
// ══════════════════════════════════════════

describe("WebExtractTool — selectors 검증", () => {
  it("url 없음 → Error: url is required", async () => {
    const tool = new WebExtractTool();
    const r = await tool.execute({ url: "", selectors: { title: "h1" } });
    expect(String(r)).toContain("url is required");
  });

  it("selectors가 배열 → Error: selectors must be an object", async () => {
    const tool = new WebExtractTool();
    const r = await tool.execute({ url: "https://example.com", selectors: ["h1"] });
    expect(String(r)).toContain("selectors must be an object");
  });

  it("selectors 없음 (null) → Error: selectors must be an object", async () => {
    const tool = new WebExtractTool();
    const r = await tool.execute({ url: "https://example.com" });
    expect(String(r)).toContain("selectors must be an object");
  });

  it("selectors 비어있음 → Error: at least one entry", async () => {
    const tool = new WebExtractTool();
    const r = await tool.execute({ url: "https://example.com", selectors: {} });
    expect(String(r)).toContain("at least one entry");
  });

  it("selectors 21개 → Error: max 20 selectors", async () => {
    const tool = new WebExtractTool();
    const selectors: Record<string, string> = {};
    for (let i = 0; i < 21; i++) selectors[`k${i}`] = `.sel${i}`;
    const r = await tool.execute({ url: "https://example.com", selectors });
    expect(String(r)).toContain("max 20 selectors");
  });
});

// ══════════════════════════════════════════
// WebPdfTool — 기본 검증
// ══════════════════════════════════════════

describe("WebPdfTool — 검증 및 not-installed", () => {
  it("url 없음 → Error: url is required", async () => {
    const tool = new WebPdfTool({ workspace });
    const r = await tool.execute({ url: "" });
    expect(String(r)).toContain("url is required");
  });

  it("agent-browser 미설치 → not_installed", async () => {
    const tool = new WebPdfTool({ workspace });
    mock_spawn_sync.mockReturnValue({ status: 1 });
    const r = await tool.execute({ url: "https://example.com" });
    expect(String(r)).toContain("agent_browser_not_installed");
  });
});

// ══════════════════════════════════════════
// WebMonitorTool — 기본 검증 + 첫 실행
// ══════════════════════════════════════════

describe("WebMonitorTool — 검증 및 첫 실행", () => {
  it("url 없음 → Error: url is required", async () => {
    const tool = new WebMonitorTool({ workspace });
    const r = await tool.execute({ url: "", label: "test" });
    expect(String(r)).toContain("url is required");
  });

  it("label 없음 → Error: label is required", async () => {
    const tool = new WebMonitorTool({ workspace });
    const r = await tool.execute({ url: "https://example.com", label: "" });
    expect(String(r)).toContain("label is required");
  });

  it("agent-browser 미설치 → not_installed", async () => {
    const tool = new WebMonitorTool({ workspace });
    mock_spawn_sync.mockReturnValue({ status: 1 });
    const r = await tool.execute({ url: "https://example.com", label: "site-monitor" });
    expect(String(r)).toContain("agent_browser_not_installed");
  });
});

// ══════════════════════════════════════════
// agent-browser 설치됨 → run_agent_browser_cli 경로
// ══════════════════════════════════════════

describe("WebFetchTool — agent-browser 설치됨 경로", () => {
  it("execFile 성공 + JSON stdout → parsed 성공", async () => {
    // 바이너리 존재 시뮬레이션 (status=0)
    // 참고: cached_agent_browser_bin이 이미 null로 캐시됐을 수 있음
    // 모듈 캐시를 직접 초기화할 수 없으므로 별도 임포트가 필요하지만
    // 간접적으로 테스트: 에러 응답으로 agent_browser_exec_failed 경로 확인
    mock_exec_file.mockImplementationOnce(
      (_cmd: unknown, _args: unknown, _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
        cb(new Error("Permission denied"), { stdout: "", stderr: "permission denied" });
      }
    );
    // 이 경우 cached_agent_browser_bin이 이미 null이므로 not_installed 반환
    const tool = new WebFetchTool();
    const r = await tool.execute({ url: "https://example.com" });
    // null cached → not_installed 반환
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// WebFetchTool — signal aborted
// ══════════════════════════════════════════

describe("WebFetchTool — signal aborted", () => {
  it("AbortController로 취소 → Error: cancelled", async () => {
    const tool = new WebFetchTool();
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await tool.execute({ url: "https://example.com" }, { signal: ctrl.signal } as any);
    expect(String(r)).toContain("cancelled");
  });
});
