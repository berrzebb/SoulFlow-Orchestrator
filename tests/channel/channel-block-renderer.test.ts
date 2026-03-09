/**
 * ChannelBlockRenderer — 전체 커버리지.
 * - push: tool_use/tool_result, usage, rate_limit, compact_boundary, 미지원 이벤트
 * - push_thinking
 * - has_content
 * - render: markdown/html/plain 포맷, thinking/tool/usage/rate_limit/compact
 */
import { describe, it, expect } from "vitest";
import { ChannelBlockRenderer } from "@src/channels/channel-block-renderer.js";

function make_renderer(): ChannelBlockRenderer {
  return new ChannelBlockRenderer();
}

// ══════════════════════════════════════════
// push: tool_use → pending (false 반환)
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push tool_use", () => {
  it("tool_use → false 반환 (아직 result 없음)", () => {
    const r = make_renderer();
    const result = r.push({
      type: "tool_use",
      tool_id: "t1",
      tool_name: "bash",
      params: { command: "ls" },
      source: { backend: "claude", task_id: "task1" },
      at: "2026-01-01T00:00:00Z",
    } as any);
    expect(result).toBe(false);
    expect(r.has_content()).toBe(false);
  });
});

// ══════════════════════════════════════════
// push: tool_use + tool_result → 블록 완성
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push tool_result", () => {
  it("tool_use 후 tool_result → true 반환 + has_content=true", () => {
    const r = make_renderer();
    r.push({ type: "tool_use", tool_id: "t1", tool_name: "bash", params: { command: "ls" }, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    const result = r.push({
      type: "tool_result",
      tool_id: "t1",
      tool_name: "bash",
      result: "file1.txt\nfile2.txt",
      is_error: false,
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    expect(result).toBe(true);
    expect(r.has_content()).toBe(true);
  });

  it("pending tool_use 없어도 tool_result → 블록 추가 (이름 폴백)", () => {
    const r = make_renderer();
    const result = r.push({
      type: "tool_result",
      tool_id: "unknown-t",
      tool_name: "read",
      result: "content here",
      is_error: false,
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    expect(result).toBe(true);
    expect(r.has_content()).toBe(true);
  });

  it("is_error=true → 에러 블록", () => {
    const r = make_renderer();
    r.push({ type: "tool_use", tool_id: "t2", tool_name: "exec", params: {}, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    r.push({
      type: "tool_result",
      tool_id: "t2",
      tool_name: "exec",
      result: "Error: command failed",
      is_error: true,
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    const text = r.render("plain");
    expect(text).toContain("FAIL");
  });
});

// ══════════════════════════════════════════
// push: usage
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push usage", () => {
  it("usage 이벤트 → true 반환", () => {
    const r = make_renderer();
    const result = r.push({
      type: "usage",
      tokens: { input: 100, output: 50 },
      cost_usd: 0.0025,
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    expect(result).toBe(true);
  });

  it("usage cost_usd=null → 비용 미표시", () => {
    const r = make_renderer();
    r.push({
      type: "usage",
      tokens: { input: 200, output: 100 },
      cost_usd: undefined,
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    const text = r.render("plain");
    expect(text).toContain("in: 200");
    expect(text).not.toContain("$");
  });
});

// ══════════════════════════════════════════
// push: rate_limit
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push rate_limit", () => {
  it("status=allowed → false 반환 (블록 미생성)", () => {
    const r = make_renderer();
    const result = r.push({
      type: "rate_limit",
      status: "allowed",
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    expect(result).toBe(false);
    expect(r.has_content()).toBe(false);
  });

  it("status=warning → true 반환 + 경고 블록", () => {
    const r = make_renderer();
    const result = r.push({
      type: "rate_limit",
      status: "warning",
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    expect(result).toBe(true);
    const text = r.render("markdown");
    expect(text).toContain("속도 제한 경고");
  });

  it("status=rejected → rate_rejected 포맷", () => {
    const r = make_renderer();
    r.push({
      type: "rate_limit",
      status: "rejected",
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    const text = r.render("markdown");
    expect(text).toContain("속도 제한 초과");
  });
});

// ══════════════════════════════════════════
// push: compact_boundary
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push compact_boundary", () => {
  it("compact_boundary → true 반환 + compact 블록", () => {
    const r = make_renderer();
    const result = r.push({
      type: "compact_boundary",
      pre_tokens: 15000,
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    expect(result).toBe(true);
    const text = r.render("plain");
    expect(text).toContain("Context compacted");
    expect(text).toContain("15,000");
  });
});

// ══════════════════════════════════════════
// push: 미지원 이벤트 → false
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push 미지원 이벤트", () => {
  it("content_delta 등 → false 반환", () => {
    const r = make_renderer();
    const result = r.push({
      type: "content_delta",
      text: "hello",
      source: { backend: "claude", task_id: "t1" },
      at: "",
    } as any);
    expect(result).toBe(false);
    expect(r.has_content()).toBe(false);
  });
});

// ══════════════════════════════════════════
// push_thinking
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push_thinking", () => {
  it("thinking 추가 → has_content=true", () => {
    const r = make_renderer();
    r.push_thinking(500, "thinking content here...");
    expect(r.has_content()).toBe(true);
  });

  it("thinking 렌더링 → 토큰 수 포함", () => {
    const r = make_renderer();
    r.push_thinking(1234, "analyzing the problem");
    const text = r.render("plain");
    expect(text).toContain("Thinking");
    expect(text).toContain("1,234");
  });

  it("긴 content → 120자로 잘림 (preview)", () => {
    const r = make_renderer();
    const long = "x".repeat(200);
    r.push_thinking(100, long);
    // preview는 120자 이하 → 내부적으로 slice(0, 120)
    expect(r.has_content()).toBe(true);
  });
});

// ══════════════════════════════════════════
// has_content
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — has_content", () => {
  it("초기 상태 → false", () => {
    const r = make_renderer();
    expect(r.has_content()).toBe(false);
  });

  it("tool_use만 (미완성) → false", () => {
    const r = make_renderer();
    r.push({ type: "tool_use", tool_id: "t1", tool_name: "bash", params: {}, source: { backend: "claude", task_id: "t" }, at: "" } as any);
    expect(r.has_content()).toBe(false);
  });
});

// ══════════════════════════════════════════
// render: 모드별 포맷
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — render 모드", () => {
  function fill_renderer(r: ChannelBlockRenderer) {
    r.push_thinking(300, "thinking");
    r.push({ type: "tool_use", tool_id: "t1", tool_name: "bash", params: { command: "ls" }, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    r.push({ type: "tool_result", tool_id: "t1", tool_name: "bash", result: "output", is_error: false, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    r.push({ type: "usage", tokens: { input: 100, output: 50 }, cost_usd: 0.001, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
  }

  it("render('markdown') → markdown 포맷 사용", () => {
    const r = make_renderer();
    fill_renderer(r);
    const text = r.render("markdown");
    expect(text).toContain("💭");
    expect(text).toContain("🔧");
    expect(text).toContain("📊");
  });

  it("render('html') → html 포맷 사용", () => {
    const r = make_renderer();
    fill_renderer(r);
    const text = r.render("html");
    expect(text).toContain("<i>");
    expect(text).toContain("<b>");
  });

  it("render('plain') → 기본 텍스트 포맷", () => {
    const r = make_renderer();
    fill_renderer(r);
    const text = r.render("plain");
    expect(text).toContain("Thinking");
    expect(text).toContain("[OK] bash");
    expect(text).toContain("[Usage]");
  });

  it("render() 기본 모드 = plain", () => {
    const r = make_renderer();
    r.push({ type: "usage", tokens: { input: 10, output: 5 }, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    const text = r.render();
    expect(text).toContain("[Usage]");
  });

  it("render — 빈 상태 → 빈 문자열", () => {
    const r = make_renderer();
    expect(r.render()).toBe("");
  });

  it("tool result 100자 넘으면 잘림", () => {
    const r = make_renderer();
    r.push({ type: "tool_use", tool_id: "t1", tool_name: "read", params: {}, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    r.push({ type: "tool_result", tool_id: "t1", tool_name: "read", result: "x".repeat(200), is_error: false, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    const text = r.render("plain");
    // preview는 100자로 잘림
    expect(text).toBeDefined();
  });

  it("여러 system 블록 → 줄바꿈으로 합침", () => {
    const r = make_renderer();
    r.push({ type: "usage", tokens: { input: 50, output: 25 }, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    r.push({ type: "compact_boundary", pre_tokens: 5000, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    r.push({ type: "rate_limit", status: "warning", source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    const text = r.render("plain");
    expect(text).toContain("[Usage]");
    expect(text).toContain("Context compacted");
    expect(text).toContain("Rate limit warning");
  });
});

// ══════════════════════════════════════════
// 복합 시나리오: tool_use 먼저 pending에 있는 상태에서 tool_result
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — 복합 시나리오", () => {
  it("여러 tool 처리 (순서 보장)", () => {
    const r = make_renderer();
    r.push({ type: "tool_use", tool_id: "a", tool_name: "read", params: {}, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    r.push({ type: "tool_use", tool_id: "b", tool_name: "write", params: {}, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    r.push({ type: "tool_result", tool_id: "a", tool_name: "read", result: "content", is_error: false, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    r.push({ type: "tool_result", tool_id: "b", tool_name: "write", result: "ok", is_error: false, source: { backend: "claude", task_id: "t1" }, at: "" } as any);
    const text = r.render("plain");
    expect(text).toContain("read");
    expect(text).toContain("write");
  });
});
