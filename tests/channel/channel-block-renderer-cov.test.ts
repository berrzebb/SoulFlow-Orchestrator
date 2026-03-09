/**
 * ChannelBlockRenderer — 미커버 분기 보충.
 * L24: markdown compact 포맷터
 * L30-32: html rate_warning, rate_rejected, compact 포맷터
 * L39: plain compact 포맷터
 */
import { describe, it, expect } from "vitest";
import { ChannelBlockRenderer } from "@src/channels/channel-block-renderer.js";
import type { AgentEvent } from "@src/agent/agent.types.js";

function compact_event(pre_tokens: number): AgentEvent {
  return { type: "compact_boundary", at: new Date().toISOString(), source: { backend: "claude_cli" }, pre_tokens } as any;
}

function rate_limit_event(status: string): AgentEvent {
  return { type: "rate_limit", at: new Date().toISOString(), source: { backend: "claude_cli" }, status } as any;
}

// ══════════════════════════════════════════
// L24: markdown.compact
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — markdown compact 포맷터 (L24)", () => {
  it("compact_boundary 이벤트 + markdown 모드 → 🗜️ compact 포함", () => {
    const r = new ChannelBlockRenderer();
    r.push(compact_event(12000));
    const out = r.render("markdown");
    expect(out).toContain("🗜️");
    expect(out).toContain("12,000");
  });
});

// ══════════════════════════════════════════
// L30: html.rate_warning
// L31: html.rate_rejected
// L32: html.compact
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — html 포맷터 (L30-32)", () => {
  it("rate_limit warning + html → <i>속도 제한 경고</i>", () => {
    const r = new ChannelBlockRenderer();
    r.push(rate_limit_event("warning"));
    const out = r.render("html");
    expect(out).toContain("속도 제한 경고");
    expect(out).toContain("<i>");
  });

  it("rate_limit rejected + html → <i>속도 제한 초과</i>", () => {
    const r = new ChannelBlockRenderer();
    r.push(rate_limit_event("rejected"));
    const out = r.render("html");
    expect(out).toContain("속도 제한 초과");
    expect(out).toContain("<i>");
  });

  it("compact_boundary + html → <i>컨텍스트 압축</i>", () => {
    const r = new ChannelBlockRenderer();
    r.push(compact_event(8000));
    const out = r.render("html");
    expect(out).toContain("컨텍스트 압축");
    expect(out).toContain("<i>");
  });
});

// ══════════════════════════════════════════
// L39: plain.compact
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — plain compact 포맷터 (L40)", () => {
  it("compact_boundary + plain → [Context compacted:] 포함", () => {
    const r = new ChannelBlockRenderer();
    r.push(compact_event(5000));
    const out = r.render("plain");
    expect(out).toContain("Context compacted");
    expect(out).toContain("5,000");
  });
});

// ══════════════════════════════════════════
// L39: plain.rate_rejected
// ══════════════════════════════════════════

describe("ChannelBlockRenderer — plain rate_rejected 포맷터 (L39)", () => {
  it("rate_limit rejected + plain → [Rate limit exceeded] 포함 (L39)", () => {
    const r = new ChannelBlockRenderer();
    r.push(rate_limit_event("rejected"));
    const out = r.render("plain");
    expect(out).toContain("Rate limit exceeded");
  });
});
