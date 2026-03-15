/**
 * FE-6d: Mobile + Accessibility 회귀 — 직접 렌더 검증.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

vi.mock("@/i18n", () => ({
  useT: () => (key: string, p?: Record<string, string>) =>
    p ? `${key}:${JSON.stringify(p)}` : key,
}));

// ── WsListItem 직접 렌더 ────────────────────────────────────────────────────

import { WsListItem } from "@/pages/workspace/ws-shared";

describe("Accessibility — WsListItem 직접 렌더 (FE-6d)", () => {
  it("role=button이 렌더된다", () => {
    render(<WsListItem id="test" active={false} onClick={vi.fn()}>Item</WsListItem>);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("tabIndex=0이 적용된다 (키보드 접근 가능)", () => {
    render(<WsListItem id="test" active={false} onClick={vi.fn()}>Item</WsListItem>);
    expect(screen.getByRole("button")).toHaveAttribute("tabindex", "0");
  });

  it("active 상태에서 ws-item--active 클래스가 적용된다", () => {
    render(<WsListItem id="test" active={true} onClick={vi.fn()}>Active</WsListItem>);
    expect(screen.getByRole("button").className).toContain("ws-item--active");
  });
});

// ── ChatBottomBar 직접 렌더 — aria-label 검증 ──────────────────────────────

import { ChatBottomBar } from "@/pages/chat/chat-status-bar";

describe("Accessibility — ChatBottomBar aria-label 직접 렌더 (FE-6d)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("채널 미스매치 시 aria-label이 렌더된다", () => {
    render(
      <ChatBottomBar
        session_label="Chat"
        is_busy={true}
        is_streaming={false}
        onStop={vi.fn()}
        requested_channel="web"
        delivered_channel="slack"
      />,
    );
    expect(screen.getByLabelText("chat.channel_mismatch")).toBeInTheDocument();
  });

  it("세션 재사용 칩이 렌더된다", () => {
    render(
      <ChatBottomBar
        session_label="Chat"
        is_busy={true}
        is_streaming={false}
        onStop={vi.fn()}
        session_reuse={true}
      />,
    );
    expect(screen.getByText(/chat\.session_reuse/)).toBeInTheDocument();
  });
});
