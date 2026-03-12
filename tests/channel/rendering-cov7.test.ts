/**
 * rendering.ts — 미커버 분기 (cov7):
 * - L83: sanitizeMarkdown throw → catch → sanitized = input
 * - L164: apply_blocked_image_policy — text-only → alt || "image"
 * - L173: apply_blocked_link_policy — text-only → label
 *
 * vi.mock으로 sanitizer를 제어해서 내부 정책 함수 분기를 직접 커버.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("markdown-to-markdown-sanitizer", () => ({
  sanitizeMarkdown: vi.fn((input: string) => input),
}));

import { sanitizeMarkdown } from "markdown-to-markdown-sanitizer";
import { render_agent_output } from "@src/channels/rendering.js";
import type { RenderProfile } from "@src/channels/rendering.js";

function make_profile(overrides: Partial<RenderProfile> = {}): RenderProfile {
  return {
    mode: "markdown",
    blocked_image_policy: "indicator",
    blocked_link_policy: "indicator",
    ...overrides,
  };
}

// ── L83: sanitizer throw → catch → sanitized = input ────────────────────────

describe("rendering — L83: sanitizeMarkdown throws → catch → input fallback", () => {
  it("sanitizer가 throw하면 원본 input을 그대로 사용", () => {
    vi.mocked(sanitizeMarkdown).mockImplementationOnce(() => {
      throw new Error("sanitizer-failure");
    });

    const result = render_agent_output("hello world", make_profile());
    // sanitized = input → 원본 텍스트 그대로 반환
    expect(result.markdown).toContain("hello world");
  });
});

// ── L164: apply_blocked_image_policy — text-only ─────────────────────────────

describe("rendering — L164: apply_blocked_image_policy text-only", () => {
  it("alt 있는 blocked image → alt 텍스트로 대체", () => {
    // sanitizer identity mock → ![alt text](/forbidden) 패턴 그대로 통과
    vi.mocked(sanitizeMarkdown).mockImplementationOnce((input: string) => input);

    const result = render_agent_output("![my photo](/forbidden)", make_profile({
      blocked_image_policy: "text-only",
    }));
    expect(result.markdown).toContain("my photo");
    expect(result.markdown).not.toContain("/forbidden");
  });

  it("alt 없는 blocked image → 'image' 기본값으로 대체", () => {
    vi.mocked(sanitizeMarkdown).mockImplementationOnce((input: string) => input);

    const result = render_agent_output("![](/forbidden)", make_profile({
      blocked_image_policy: "text-only",
    }));
    expect(result.markdown).toContain("image");
    expect(result.markdown).not.toContain("/forbidden");
  });
});

// ── L173: apply_blocked_link_policy — text-only ──────────────────────────────

describe("rendering — L173: apply_blocked_link_policy text-only", () => {
  it("blocked link → label 텍스트만 남김", () => {
    vi.mocked(sanitizeMarkdown).mockImplementationOnce((input: string) => input);

    const result = render_agent_output("[click here](#)", make_profile({
      blocked_link_policy: "text-only",
    }));
    expect(result.markdown).toContain("click here");
    expect(result.markdown).not.toContain("(#)");
    expect(result.markdown).not.toContain("[blocked-link]");
  });
});
