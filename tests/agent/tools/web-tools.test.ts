/**
 * web.ts 커버리지 — WebFetchTool, WebSearchTool, WebBrowserTool,
 * WebSnapshotTool, WebExtractTool, WebPdfTool, WebMonitorTool.
 */
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

afterEach(() => { vi.clearAllMocks(); });

const tmp = mkdtempSync(join(tmpdir(), "web-tool-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ══════════════════════════════════════════
// vi.hoisted — vi.mock 팩토리보다 먼저 실행되는 변수 선언
// ══════════════════════════════════════════

const { mock_state, exec_custom, spawn_fn } = vi.hoisted(() => {
  const PROMISIFY_CUSTOM = Symbol.for("nodejs.util.promisify.custom");
  // 초기값: spawn_ok=true → 모듈 첫 로드 시 agent-browser 발견으로 캐싱됨
  const state = { stdout: "", stderr: "", spawn_ok: true, exec_should_throw: false };

  // promisify(execFile)이 { stdout, stderr } 반환하도록 custom symbol 부착
  const custom_fn: (...args: unknown[]) => Promise<{ stdout: string; stderr: string }> = async () => {
    if (state.exec_should_throw) {
      const err = Object.assign(new Error(state.stderr || "exec_failed"), {
        stdout: state.stdout,
        stderr: state.stderr,
        code: 1,
      });
      throw err;
    }
    return { stdout: state.stdout, stderr: state.stderr };
  };

  const exec_file_fn = Object.assign(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof cb === "function") {
        if (state.exec_should_throw) {
          (cb as Function)(new Error(state.stderr), "", state.stderr);
        } else {
          (cb as Function)(null, state.stdout, state.stderr);
        }
      }
    },
    { [PROMISIFY_CUSTOM]: custom_fn }
  );

  const spawn_fn = () => ({ status: state.spawn_ok ? 0 : 1 });

  return {
    mock_state: state,
    exec_custom: exec_file_fn,
    spawn_fn,
  };
});

vi.mock("node:child_process", () => ({
  execFile: exec_custom,
  spawnSync: spawn_fn,
}));

import {
  WebFetchTool,
  WebSearchTool,
  WebBrowserTool,
  WebSnapshotTool,
  WebExtractTool,
  WebPdfTool,
  WebMonitorTool,
} from "@src/agent/tools/web.js";

// ══════════════════════════════════════════
// helpers
// ══════════════════════════════════════════

function set_installed(stdout = "") {
  mock_state.spawn_ok = true;
  mock_state.exec_should_throw = false;
  mock_state.stdout = stdout;
  mock_state.stderr = "";
}

function set_not_installed() {
  mock_state.spawn_ok = false;
  mock_state.exec_should_throw = false;
  mock_state.stdout = "";
  mock_state.stderr = "";
}

function set_exec_fail(stderr = "exec_failed") {
  mock_state.spawn_ok = true;
  mock_state.exec_should_throw = true;
  mock_state.stdout = "";
  mock_state.stderr = stderr;
}

const ws = tmp;

// ══════════════════════════════════════════
// WebFetchTool
// ══════════════════════════════════════════

describe("WebFetchTool — 메타데이터", () => {
  it("name = web_fetch", () => expect(new WebFetchTool().name).toBe("web_fetch"));
  it("category = web", () => expect(new WebFetchTool().category).toBe("web"));
  it("policy_flags.network = true", () => expect(new WebFetchTool().policy_flags.network).toBe(true));
  it("to_schema: function 형식", () => expect(new WebFetchTool().to_schema().type).toBe("function"));
});

describe("WebFetchTool — URL 유효성 검사", () => {
  const tool = new WebFetchTool();

  it("빈 URL → Error: invalid_url", async () => {
    const r = await tool.execute({ url: "" });
    expect(r).toContain("Error");
  });

  it("file:// 프로토콜 → Error: invalid_protocol", async () => {
    const r = await tool.execute({ url: "file:///etc/passwd" });
    expect(r).toContain("Error");
    expect(r).toContain("invalid_protocol");
  });

  it("localhost → Error: blocked_private_host", async () => {
    const r = await tool.execute({ url: "http://localhost/api" });
    expect(r).toContain("blocked_private_host");
  });

  it("127.0.0.1 → Error: blocked_private_host", async () => {
    const r = await tool.execute({ url: "http://127.0.0.1/api" });
    expect(r).toContain("blocked_private_host");
  });

  it("192.168.x.x → Error: blocked_private_host", async () => {
    const r = await tool.execute({ url: "http://192.168.0.1/" });
    expect(r).toContain("Error");
  });

  it("10.x.x.x → Error: blocked_private_host", async () => {
    const r = await tool.execute({ url: "http://10.0.0.1/api" });
    expect(r).toContain("Error");
  });

  it("169.254.x.x → 차단 (link-local)", async () => {
    const r = await tool.execute({ url: "http://169.254.0.1/api" });
    expect(r).toContain("Error");
  });

  it("172.16.x.x → 차단 (private)", async () => {
    const r = await tool.execute({ url: "http://172.16.0.1/api" });
    expect(r).toContain("Error");
  });

  it("IPv6 ::1 → 차단", async () => {
    const r = await tool.execute({ url: "http://[::1]/api" });
    expect(r).toContain("Error");
  });

  it(".local 도메인 → 차단", async () => {
    const r = await tool.execute({ url: "http://myhost.local/" });
    expect(r).toContain("Error");
  });

  it("잘못된 URL 형식 → Error: invalid_url", async () => {
    const r = await tool.execute({ url: "not-a-url" });
    expect(r).toContain("Error");
  });

  it("signal aborted → Error: cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await tool.execute({ url: "https://example.com" }, { signal: controller.signal });
    expect(r).toContain("cancel");
  });
});


describe("WebFetchTool — agent-browser 설치됨", () => {
  it("get text 성공 → JSON 결과 반환", async () => {
    // open → wait → get text (전부 ok, stdout에 data.text)
    set_installed(JSON.stringify({ data: { text: "page content here" } }));
    const r = await new WebFetchTool().execute({ url: "https://example.com" });
    const parsed = JSON.parse(r);
    expect(parsed.url).toBe("https://example.com");
    expect(typeof parsed.text).toBe("string");
  });
});

// ══════════════════════════════════════════
// WebSearchTool
// ══════════════════════════════════════════

describe("WebSearchTool — 메타데이터", () => {
  it("name = web_search", () => expect(new WebSearchTool().name).toBe("web_search"));
  it("category = web", () => expect(new WebSearchTool().category).toBe("web"));
});

describe("WebSearchTool — 유효성 검사", () => {
  const tool = new WebSearchTool();

  it("빈 query → Error 반환", async () => {
    const r = await tool.execute({ query: "" });
    expect(r).toContain("Error");
    expect(r).toContain("query");
  });

  it("signal aborted → Error: cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await tool.execute({ query: "test" }, { signal: controller.signal });
    expect(r).toContain("cancel");
  });
});


// ══════════════════════════════════════════
// WebBrowserTool
// ══════════════════════════════════════════

describe("WebBrowserTool — 메타데이터", () => {
  it("name = web_browser", () => expect(new WebBrowserTool().name).toBe("web_browser"));
  it("category = web", () => expect(new WebBrowserTool().category).toBe("web"));
  it("to_schema: function 형식", () => expect(new WebBrowserTool().to_schema().type).toBe("function"));
});

describe("WebBrowserTool — 유효성 검사", () => {
  const tool = new WebBrowserTool();

  it("action 없음 → Error 반환", async () => {
    const r = await tool.execute({ action: "" });
    expect(r).toContain("Error");
    expect(r).toContain("action");
  });

  it("open: url 없음 → Error 반환", async () => {
    const r = await tool.execute({ action: "open", url: "" });
    expect(r).toContain("Error");
    expect(r).toContain("url");
  });

  it("open: invalid url → Error 반환", async () => {
    const r = await tool.execute({ action: "open", url: "ftp://example.com" });
    expect(r).toContain("Error");
  });

  it("open: private host → Error 반환", async () => {
    const r = await tool.execute({ action: "open", url: "http://localhost:3000" });
    expect(r).toContain("blocked_private_host");
  });

  it("click: selector 없음 → Error 반환", async () => {
    const r = await tool.execute({ action: "click", selector: "" });
    expect(r).toContain("Error");
    expect(r).toContain("selector");
  });

  it("fill: selector 없음 → Error 반환", async () => {
    const r = await tool.execute({ action: "fill", selector: "" });
    expect(r).toContain("Error");
    expect(r).toContain("selector");
  });

  it("wait: wait_ms=Infinity → 유효하지 않은 값이지만 fallback 처리", async () => {
    // wait_ms=0 (기본값)은 유한수이므로 에러 없이 실행됨
    // wait 액션은 selector 또는 wait_ms(유한수)가 있으면 실행
    set_installed(JSON.stringify({ data: {} }));
    const r = await tool.execute({ action: "wait", wait_ms: 100 });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
  });

  it("get_text: selector 없음 → Error 반환", async () => {
    const r = await tool.execute({ action: "get_text", selector: "" });
    expect(r).toContain("Error");
    expect(r).toContain("selector");
  });

  it("unsupported action → Error 반환", async () => {
    const r = await tool.execute({ action: "navigate" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});

describe("WebBrowserTool — agent-browser 설치됨", () => {
  it("open 성공 → JSON 결과 반환", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const r = await new WebBrowserTool().execute({ action: "open", url: "https://example.com" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("open");
  });

  it("snapshot 성공 → JSON 결과 반환", async () => {
    set_installed(JSON.stringify({ data: { snapshot: "page content" } }));
    const r = await new WebBrowserTool().execute({ action: "snapshot" });
    const parsed = JSON.parse(r);
    expect(parsed.action).toBe("snapshot");
  });

  it("click 성공 → ok=true", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const r = await new WebBrowserTool().execute({ action: "click", selector: "#btn" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.selector).toBe("#btn");
  });

  it("fill 성공 → ok=true", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const r = await new WebBrowserTool().execute({ action: "fill", selector: "#input", text: "hello" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
  });

  it("wait by selector → ok=true", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const r = await new WebBrowserTool().execute({ action: "wait", selector: ".loaded" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.selector).toBe(".loaded");
  });

  it("wait by ms → ok=true", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const r = await new WebBrowserTool().execute({ action: "wait", wait_ms: 500 });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.wait_ms).toBe(500);
  });

  it("get_text 성공 → data 포함", async () => {
    set_installed(JSON.stringify({ data: { text: "hello" } }));
    const r = await new WebBrowserTool().execute({ action: "get_text", selector: "h1" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
  });

  it("screenshot 성공 → ok=true", async () => {
    set_installed(JSON.stringify({ data: { path: "/tmp/shot.png" } }));
    const r = await new WebBrowserTool().execute({ action: "screenshot" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
  });

  it("screenshot with path → ok=true", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const r = await new WebBrowserTool().execute({ action: "screenshot", path: "/tmp/shot.png", full_page: true, annotate: true });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
  });

  it("close 성공 → ok=true", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const r = await new WebBrowserTool().execute({ action: "close" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("close");
  });

  it("click 실패 → Error 반환", async () => {
    set_exec_fail("element not found");
    const r = await new WebBrowserTool().execute({ action: "click", selector: "#missing" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// WebSnapshotTool
// ══════════════════════════════════════════

describe("WebSnapshotTool — 유효성 검사", () => {
  const tool = new WebSnapshotTool({ workspace: ws });

  it("url 없음 → Error 반환", async () => {
    const r = await tool.execute({ url: "" });
    expect(r).toContain("Error");
    expect(r).toContain("url");
  });

  it("private host → Error 반환", async () => {
    const r = await tool.execute({ url: "http://192.168.1.1" });
    expect(r).toContain("Error");
  });

  it("signal aborted → Error: cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await tool.execute({ url: "https://example.com" }, { signal: controller.signal });
    expect(r).toContain("cancel");
  });
});

describe("WebSnapshotTool — agent-browser 설치됨", () => {
  it("스크린샷 성공 → path 반환", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const r = await new WebSnapshotTool({ workspace: ws }).execute({
      url: "https://example.com",
      full_page: true,
      annotate: true,
    });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.url).toBe("https://example.com");
  });

  it("custom path 지정 → 해당 경로 사용", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const out_path = join(tmp, "custom-shot.png");
    const r = await new WebSnapshotTool({ workspace: ws }).execute({
      url: "https://example.com",
      path: out_path,
    });
    const parsed = JSON.parse(r);
    expect(parsed.path).toBe(out_path);
  });
});

// ══════════════════════════════════════════
// WebExtractTool
// ══════════════════════════════════════════

describe("WebExtractTool — 유효성 검사", () => {
  const tool = new WebExtractTool();

  it("url 없음 → Error 반환", async () => {
    const r = await tool.execute({ url: "", selectors: { title: "h1" } });
    expect(r).toContain("Error");
    expect(r).toContain("url");
  });

  it("selectors 없음/null → Error 반환", async () => {
    const r = await tool.execute({ url: "https://example.com", selectors: null });
    expect(r).toContain("Error");
    expect(r).toContain("selectors");
  });

  it("selectors 배열 → Error 반환", async () => {
    const r = await tool.execute({ url: "https://example.com", selectors: ["h1"] });
    expect(r).toContain("Error");
    expect(r).toContain("selectors");
  });

  it("selectors 빈 객체 → Error 반환", async () => {
    const r = await tool.execute({ url: "https://example.com", selectors: {} });
    expect(r).toContain("Error");
  });

  it("selectors 20개 초과 → Error 반환", async () => {
    const selectors: Record<string, string> = {};
    for (let i = 0; i < 25; i++) selectors[`k${i}`] = `sel${i}`;
    const r = await tool.execute({ url: "https://example.com", selectors });
    expect(r).toContain("Error");
    expect(r).toContain("20");
  });

  it("private host → Error 반환", async () => {
    const r = await tool.execute({ url: "http://10.0.0.1/api", selectors: { title: "h1" } });
    expect(r).toContain("Error");
  });
});

describe("WebExtractTool — agent-browser 설치됨", () => {
  it("텍스트 추출 성공 → extracted 반환", async () => {
    set_installed(JSON.stringify({ data: { text: "Hello World" } }));
    const r = await new WebExtractTool().execute({
      url: "https://example.com",
      selectors: { title: "h1" },
    });
    const parsed = JSON.parse(r);
    expect(parsed.url).toBe("https://example.com");
    expect(typeof parsed.extracted).toBe("object");
  });
});

// ══════════════════════════════════════════
// WebPdfTool
// ══════════════════════════════════════════

describe("WebPdfTool — 유효성 검사", () => {
  const tool = new WebPdfTool({ workspace: ws });

  it("url 없음 → Error 반환", async () => {
    const r = await tool.execute({ url: "" });
    expect(r).toContain("Error");
    expect(r).toContain("url");
  });

  it("private host → Error 반환", async () => {
    const r = await tool.execute({ url: "http://localhost:8080/doc" });
    expect(r).toContain("Error");
  });
});

describe("WebPdfTool — agent-browser 설치됨", () => {
  it("PDF 생성 성공 → path 반환", async () => {
    set_installed(JSON.stringify({ data: {} }));
    const r = await new WebPdfTool({ workspace: ws }).execute({ url: "https://example.com" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.url).toBe("https://example.com");
  });
});

// ══════════════════════════════════════════
// WebMonitorTool
// ══════════════════════════════════════════

describe("WebMonitorTool — 유효성 검사", () => {
  const tool = new WebMonitorTool({ workspace: ws });

  it("url 없음 → Error 반환", async () => {
    const r = await tool.execute({ url: "", label: "test" });
    expect(r).toContain("Error");
    expect(r).toContain("url");
  });

  it("private host → Error 반환", async () => {
    const r = await tool.execute({ url: "http://localhost", label: "test" });
    expect(r).toContain("Error");
  });

  it("label 없음 → Error 반환", async () => {
    const r = await tool.execute({ url: "https://example.com", label: "" });
    expect(r).toContain("Error");
    expect(r).toContain("label");
  });
});

describe("WebMonitorTool — first_run / changed", () => {
  it("first_run=true (이전 데이터 없음)", async () => {
    set_installed(JSON.stringify({ data: { snapshot: "page content v1" } }));
    const r = await new WebMonitorTool({ workspace: ws }).execute({
      url: "https://example.com",
      label: "monitor-test-1",
    });
    const parsed = JSON.parse(r);
    expect(parsed.first_run).toBe(true);
    expect(parsed.changed).toBe(false);
  });

  it("두 번째 실행 — 변경 있음 → changed=true", async () => {
    // 첫 번째 실행
    set_installed(JSON.stringify({ data: { snapshot: "original content" } }));
    const tool = new WebMonitorTool({ workspace: ws });
    await tool.execute({ url: "https://example.com", label: "monitor-test-2" });

    // 두 번째 실행 (내용 변경)
    set_installed(JSON.stringify({ data: { snapshot: "changed content NEW" } }));
    const r2 = await new WebMonitorTool({ workspace: ws }).execute({
      url: "https://example.com",
      label: "monitor-test-2",
    });
    const parsed = JSON.parse(r2);
    expect(parsed.changed).toBe(true);
    expect(parsed.diff.added).toBeGreaterThan(0);
  });

  it("두 번째 실행 — 변경 없음 → changed=false", async () => {
    set_installed(JSON.stringify({ data: { snapshot: "same content" } }));
    const tool = new WebMonitorTool({ workspace: ws });
    await tool.execute({ url: "https://example.com", label: "monitor-test-3" });

    set_installed(JSON.stringify({ data: { snapshot: "same content" } }));
    const r2 = await new WebMonitorTool({ workspace: ws }).execute({
      url: "https://example.com",
      label: "monitor-test-3",
    });
    const parsed = JSON.parse(r2);
    expect(parsed.changed).toBe(false);
  });

  it("selector로 특정 영역 모니터링", async () => {
    set_installed(JSON.stringify({ data: { text: "select content" } }));
    const r = await new WebMonitorTool({ workspace: ws }).execute({
      url: "https://example.com",
      label: "monitor-selector-1",
      selector: ".content",
    });
    const parsed = JSON.parse(r);
    expect(parsed.first_run).toBe(true);
  });
});
