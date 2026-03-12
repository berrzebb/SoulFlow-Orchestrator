/**
 * screenshot_handler — 미커버 분기 커버리지.
 * - url 없음 → early return
 * - ScreenshotTool 동적 import 모킹
 * - result "Error:" prefix → error 반환
 * - JSON.parse 성공 → output_path 반환
 * - catch 분기 (execute throw)
 * - test() 경고
 *
 * NOTE: vi.fn() + new 조합에서 arrow function impl을 사용하면
 * Reflect.construct가 실패함. 일반 함수 keyword 사용 필요.
 * MockScreenshotTool.mockImplementation(function() {...}) 패턴 적용.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── ScreenshotTool 동적 import mock ─────────────────────────────────────────

const mock_execute = vi.hoisted(() => vi.fn());
const MockScreenshotTool = vi.hoisted(() => vi.fn());

vi.mock("@src/agent/tools/screenshot.js", () => ({
  ScreenshotTool: MockScreenshotTool,
}));

// resolve_templates identity
vi.mock("@src/agent/orche-node-executor.js", () => ({
  resolve_templates: (s: string) => s,
}));

import { screenshot_handler } from "@src/agent/nodes/screenshot.js";

const make_ctx = () => ({
  memory: {},
  workspace: "/tmp/ws",
  abort_signal: undefined as any,
});

const make_node = (overrides: Record<string, unknown> = {}) => ({
  node_type: "screenshot",
  url: "https://example.com",
  output_path: "",
  selector: "",
  full_page: false,
  width: 1280,
  height: 720,
  delay_ms: 1000,
  ...overrides,
} as any);

// 일반 함수를 구현으로 사용해야 new와 함께 동작 (arrow function 불가)
function make_ctor_impl() {
  const self = { execute: mock_execute };
  return self;
}

beforeEach(() => {
  mock_execute.mockReset();
  MockScreenshotTool.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  MockScreenshotTool.mockImplementation(function () { return make_ctor_impl(); });
});

// ══════════════════════════════════════════
// execute
// ══════════════════════════════════════════

describe("screenshot_handler — execute", () => {
  it("url 없음 → success=false, error='url is required'", async () => {
    const r = await screenshot_handler.execute!(make_node({ url: "" }), make_ctx() as any);
    expect((r.output as any).success).toBe(false);
    expect((r.output as any).error).toContain("url is required");
    expect(mock_execute).not.toHaveBeenCalled();
  });

  it("ScreenshotTool 성공 → output_path 반환, success=true", async () => {
    mock_execute.mockResolvedValue(JSON.stringify({ output_path: "/tmp/ws/screenshot.png" }));
    const r = await screenshot_handler.execute!(make_node(), make_ctx() as any);
    expect((r.output as any).success).toBe(true);
    expect((r.output as any).output_path).toBe("/tmp/ws/screenshot.png");
  });

  it("result가 'Error:' prefix → success=false", async () => {
    mock_execute.mockResolvedValue("Error: browser not found");
    const r = await screenshot_handler.execute!(make_node(), make_ctx() as any);
    expect((r.output as any).success).toBe(false);
    expect((r.output as any).error).toContain("Error: browser not found");
  });

  it("JSON.parse 실패 → catch → success=false, error 반환", async () => {
    mock_execute.mockResolvedValue("not-json");
    const r = await screenshot_handler.execute!(make_node(), make_ctx() as any);
    expect((r.output as any).success).toBe(false);
    expect((r.output as any).error).toBeTruthy();
  });

  it("ScreenshotTool.execute throw → catch → success=false", async () => {
    mock_execute.mockRejectedValue(new Error("ENOENT"));
    const r = await screenshot_handler.execute!(make_node(), make_ctx() as any);
    expect((r.output as any).success).toBe(false);
    expect((r.output as any).error).toContain("ENOENT");
  });

  it("selector / full_page / width / height / delay_ms 전달", async () => {
    mock_execute.mockResolvedValue(JSON.stringify({ output_path: "/tmp/out.png" }));
    await screenshot_handler.execute!(
      make_node({ selector: ".main", full_page: true, width: 1920, height: 1080, delay_ms: 500 }),
      make_ctx() as any,
    );
    const call = mock_execute.mock.calls[0][0];
    expect(call.selector).toBe(".main");
    expect(call.full_page).toBe(true);
    expect(call.width).toBe(1920);
    expect(call.height).toBe(1080);
    expect(call.delay_ms).toBe(500);
  });

  it("output_path 없는 JSON → output_path=''", async () => {
    mock_execute.mockResolvedValue(JSON.stringify({ some: "other" }));
    const r = await screenshot_handler.execute!(make_node(), make_ctx() as any);
    expect((r.output as any).output_path).toBe("");
  });
});

// ══════════════════════════════════════════
// test()
// ══════════════════════════════════════════

describe("screenshot_handler — test()", () => {
  it("url 없음 → 경고", () => {
    const r = screenshot_handler.test!(make_node({ url: "" }));
    expect(r.warnings).toContain("url is required");
  });

  it("url 공백 → 경고", () => {
    const r = screenshot_handler.test!(make_node({ url: "   " }));
    expect(r.warnings).toContain("url is required");
  });

  it("url 있음 → 경고 없음", () => {
    const r = screenshot_handler.test!(make_node({ url: "https://example.com" }));
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 url/full_page/viewport 포함", () => {
    const r = screenshot_handler.test!(make_node({ url: "https://x.com", full_page: true }));
    expect((r.preview as any).url).toBe("https://x.com");
    expect((r.preview as any).full_page).toBe(true);
    expect((r.preview as any).viewport).toBe("1280x720");
  });

  it("width/height 기본값 적용", () => {
    const r = screenshot_handler.test!(make_node({ url: "https://x.com", width: 0, height: 0 }));
    expect((r.preview as any).viewport).toBe("1280x720");
  });
});
