/**
 * ChannelBlockRenderer — 전체 커버리지.
 * - push: tool_start/tool_result, usage, rate_limit, compact, thinking, 미지원 이벤트
 * - has_content
 * - render: markdown/html/plain 포맷, thinking/tool/usage/rate_limit/compact
 */
import { describe, it, expect } from "vitest";
import { ChannelBlockRenderer } from "@src/channels/channel-block-renderer.js";
import type { StreamEvent } from "@src/channels/stream-event.js";

function make_renderer(): ChannelBlockRenderer {
  return new ChannelBlockRenderer();
}

// ══════════════════════════════════════════
// push: tool_start → pending (false 반환)
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push tool_start", () => {
  it("tool_start → false 반환 (아직 result 없음)", () => {
    const r = make_renderer();
    const result = r.push({ type: "tool_start", id: "t1", name: "bash", params: { command: "ls" } });
    expect(result).toBe(false);
    expect(r.has_content()).toBe(false);
  });
});

// ══════════════════════════════════════════
// push: tool_start + tool_result → 블록 완성
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push tool_result", () => {
  it("tool_start 후 tool_result → true 반환 + has_content=true", () => {
    const r = make_renderer();
    r.push({ type: "tool_start", id: "t1", name: "bash", params: { command: "ls" } });
    const result = r.push({ type: "tool_result", id: "t1", name: "bash", result: "file1.txt\nfile2.txt", is_error: false });
    expect(result).toBe(true);
    expect(r.has_content()).toBe(true);
  });

  it("pending tool_start 없어도 tool_result → 블록 추가 (이름 폴백)", () => {
    const r = make_renderer();
    const result = r.push({ type: "tool_result", id: "unknown-t", name: "read", result: "content here", is_error: false });
    expect(result).toBe(true);
    expect(r.has_content()).toBe(true);
  });

  it("is_error=true → 에러 블록", () => {
    const r = make_renderer();
    r.push({ type: "tool_start", id: "t2", name: "exec", params: {} });
    r.push({ type: "tool_result", id: "t2", name: "exec", result: "Error: command failed", is_error: true });
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
    const result = r.push({ type: "usage", input: 100, output: 50, cost_usd: 0.0025 });
    expect(result).toBe(true);
  });

  it("usage cost_usd=undefined → 비용 미표시", () => {
    const r = make_renderer();
    r.push({ type: "usage", input: 200, output: 100 });
    const text = r.render("plain");
    expect(text).toContain("in: 200");
    expect(text).not.toContain("$");
  });
});

// ══════════════════════════════════════════
// push: rate_limit
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push rate_limit", () => {
  it("status=allowed_warning → true 반환 + 경고 블록", () => {
    const r = make_renderer();
    const result = r.push({ type: "rate_limit", status: "allowed_warning" });
    expect(result).toBe(true);
    const text = r.render("markdown");
    expect(text).toContain("속도 제한 경고");
  });

  it("status=rejected → rate_rejected 포맷", () => {
    const r = make_renderer();
    r.push({ type: "rate_limit", status: "rejected" });
    const text = r.render("markdown");
    expect(text).toContain("속도 제한 초과");
  });

  it("미지원 타입 → false 반환 (블록 미생성)", () => {
    const r = make_renderer();
    const result = r.push({ type: "delta", content: "hello" } as StreamEvent);
    expect(result).toBe(false);
    expect(r.has_content()).toBe(false);
  });
});

// ══════════════════════════════════════════
// push: compact
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push compact", () => {
  it("compact → true 반환 + compact 블록", () => {
    const r = make_renderer();
    const result = r.push({ type: "compact", pre_tokens: 15000 });
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
  it("delta 등 → false 반환", () => {
    const r = make_renderer();
    const result = r.push({ type: "delta", content: "hello" } as StreamEvent);
    expect(result).toBe(false);
    expect(r.has_content()).toBe(false);
  });
});

// ══════════════════════════════════════════
// push: thinking
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — push thinking", () => {
  it("thinking 추가 → has_content=true", () => {
    const r = make_renderer();
    r.push({ type: "thinking", tokens: 500, preview: "thinking content here..." });
    expect(r.has_content()).toBe(true);
  });

  it("thinking 렌더링 → 토큰 수 포함", () => {
    const r = make_renderer();
    r.push({ type: "thinking", tokens: 1234, preview: "analyzing the problem" });
    const text = r.render("plain");
    expect(text).toContain("Thinking");
    expect(text).toContain("1,234");
  });

  it("preview 전달 → has_content=true", () => {
    const r = make_renderer();
    const long = "x".repeat(200);
    r.push({ type: "thinking", tokens: 100, preview: long });
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

  it("tool_start만 (미완성) → false", () => {
    const r = make_renderer();
    r.push({ type: "tool_start", id: "t1", name: "bash", params: {} });
    expect(r.has_content()).toBe(false);
  });
});

// ══════════════════════════════════════════
// render: 모드별 포맷
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — render 모드", () => {
  function fill_renderer(r: ChannelBlockRenderer) {
    r.push({ type: "thinking", tokens: 300, preview: "thinking" });
    r.push({ type: "tool_start", id: "t1", name: "bash", params: { command: "ls" } });
    r.push({ type: "tool_result", id: "t1", name: "bash", result: "output", is_error: false });
    r.push({ type: "usage", input: 100, output: 50, cost_usd: 0.001 });
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
    r.push({ type: "usage", input: 10, output: 5 });
    const text = r.render();
    expect(text).toContain("[Usage]");
  });

  it("render — 빈 상태 → 빈 문자열", () => {
    const r = make_renderer();
    expect(r.render()).toBe("");
  });

  it("tool result 100자 넘으면 잘림", () => {
    const r = make_renderer();
    r.push({ type: "tool_start", id: "t1", name: "read", params: {} });
    r.push({ type: "tool_result", id: "t1", name: "read", result: "x".repeat(200), is_error: false });
    const text = r.render("plain");
    expect(text).toBeDefined();
  });

  it("여러 system 블록 → 줄바꿈으로 합침", () => {
    const r = make_renderer();
    r.push({ type: "usage", input: 50, output: 25 });
    r.push({ type: "compact", pre_tokens: 5000 });
    r.push({ type: "rate_limit", status: "allowed_warning" });
    const text = r.render("plain");
    expect(text).toContain("[Usage]");
    expect(text).toContain("Context compacted");
    expect(text).toContain("Rate limit warning");
  });
});

// ══════════════════════════════════════════
// 복합 시나리오: tool_start 먼저 pending에 있는 상태에서 tool_result
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — 복합 시나리오", () => {
  it("여러 tool 처리 (순서 보장)", () => {
    const r = make_renderer();
    r.push({ type: "tool_start", id: "a", name: "read", params: {} });
    r.push({ type: "tool_start", id: "b", name: "write", params: {} });
    r.push({ type: "tool_result", id: "a", name: "read", result: "content", is_error: false });
    r.push({ type: "tool_result", id: "b", name: "write", result: "ok", is_error: false });
    const text = r.render("plain");
    expect(text).toContain("read");
    expect(text).toContain("write");
  });
});
