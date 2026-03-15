/**
 * FE-2: ChatBottomBar — 채널 미스매치 배지 + 세션 재사용 칩 + busy 상태 렌더 테스트.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

vi.mock("@/i18n", () => ({
  useT: () => (key: string, p?: Record<string, string>) =>
    p ? `${key}:${JSON.stringify(p)}` : key,
}));

import { ChatBottomBar } from "@/pages/chat/chat-status-bar";

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

const base_props = {
  session_label: "Chat",
  is_busy: true,
  is_streaming: false,
  onStop: vi.fn(),
};

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("ChatBottomBar", () => {
  beforeEach(() => {
    // BusyBar의 setInterval이 테스트 오염을 방지
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is_busy=false이면 null을 반환한다", () => {
    const { container } = render(<ChatBottomBar {...base_props} is_busy={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("is_busy=true이면 세션 레이블을 렌더한다", () => {
    render(<ChatBottomBar {...base_props} />);
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("채널이 다를 때 미스매치 배지(⚡)를 렌더한다", () => {
    render(
      <ChatBottomBar
        {...base_props}
        requested_channel="web"
        delivered_channel="slack"
      />,
    );
    // aria-label로 배지 확인
    expect(screen.getByLabelText("chat.channel_mismatch")).toBeInTheDocument();
    // 전달된 채널 이름이 배지 텍스트에 포함됨
    expect(screen.getByText(/slack/)).toBeInTheDocument();
  });

  it("채널이 같으면 미스매치 배지를 렌더하지 않는다", () => {
    render(
      <ChatBottomBar
        {...base_props}
        requested_channel="web"
        delivered_channel="web"
      />,
    );
    expect(screen.queryByLabelText("chat.channel_mismatch")).toBeNull();
  });

  it("delivered_channel만 있고 requested_channel이 없으면 배지를 렌더하지 않는다", () => {
    render(<ChatBottomBar {...base_props} delivered_channel="slack" />);
    expect(screen.queryByLabelText("chat.channel_mismatch")).toBeNull();
  });

  it("session_reuse=true이면 재사용 칩(↩)을 렌더한다", () => {
    render(<ChatBottomBar {...base_props} session_reuse={true} />);
    // ↩ 기호와 i18n 키 텍스트 확인
    expect(screen.getByText(/chat\.session_reuse/)).toBeInTheDocument();
  });

  it("session_reuse=false이면 재사용 칩을 렌더하지 않는다", () => {
    render(<ChatBottomBar {...base_props} session_reuse={false} />);
    expect(screen.queryByText(/chat\.session_reuse/)).toBeNull();
  });

  it("미스매치 배지와 재사용 칩이 동시에 렌더된다", () => {
    render(
      <ChatBottomBar
        {...base_props}
        requested_channel="web"
        delivered_channel="slack"
        session_reuse={true}
      />,
    );
    expect(screen.getByLabelText("chat.channel_mismatch")).toBeInTheDocument();
    expect(screen.getByText(/chat\.session_reuse/)).toBeInTheDocument();
  });
});
