/**
 * FE-2: SessionsTab 사용자 스코프 필터 테스트.
 * auth 활성 + 비슈퍼어드민 → 본인 세션만 표시.
 * 슈퍼어드민 → show_all 토글로 전체 세션 조회.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

const mockUseQuery = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/hooks/use-auth");
vi.mock("@/components/badge", () => ({ Badge: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock("@/components/empty-state", () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock("@/components/search-input", () => ({
  SearchInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/chip-bar", () => ({
  ChipBar: ({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) => (
    <div>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} data-selected={value === o.value}>{o.label}</button>
      ))}
    </div>
  ),
}));
vi.mock("@/utils/format", () => ({ time_ago: () => "1m ago" }));
vi.mock("./split-pane", () => ({
  SplitPane: ({ left }: { left: React.ReactNode }) => <div>{left}</div>,
}), { virtual: true });
vi.mock("./ws-shared", () => ({
  WsListItem: ({ children }: { children: React.ReactNode }) => <div className="ws-item">{children}</div>,
  WsDetailHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  WsSkeletonCol: () => <div />,
}), { virtual: true });

import { useAuthStatus, useAuthUser } from "@/hooks/use-auth";
import { SessionsTab } from "@/pages/workspace/sessions";

function make_session(overrides: Record<string, unknown> = {}) {
  return {
    key: "s1",
    provider: "slack",
    chat_id: "C123",
    alias: "general",
    thread: "main",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:01:00Z",
    message_count: 3,
    user_id: "user-a",
    ...overrides,
  };
}

function setup_auth(opts: { enabled: boolean; role: "user" | "superadmin"; sub: string }) {
  vi.mocked(useAuthStatus).mockReturnValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { data: { enabled: opts.enabled, initialized: true } } as any,
  );
  vi.mocked(useAuthUser).mockReturnValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { data: { sub: opts.sub, username: "test", role: opts.role, tid: "t1", wdir: "/w", exp: 9999999 } } as any,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: 세션 2개 — 하나는 본인, 하나는 타인
  mockUseQuery.mockReturnValue({
    data: [
      make_session({ key: "s-mine", chat_id: "mine", user_id: "user-me" }),
      make_session({ key: "s-other", chat_id: "other", user_id: "user-other" }),
    ],
  });
});

// ── auth 비활성 ──────────────────────────────────────────────────────────────

describe("SessionsTab — auth 비활성", () => {
  it("auth 미활성 → 모든 세션 표시", () => {
    setup_auth({ enabled: false, role: "user", sub: "user-me" });
    render(<SessionsTab />);
    expect(screen.getByText("mine")).toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();
  });
});

// ── 일반 사용자 ──────────────────────────────────────────────────────────────

describe("SessionsTab — auth 활성, 일반 사용자", () => {
  beforeEach(() => setup_auth({ enabled: true, role: "user", sub: "user-me" }));

  it("본인 세션만 표시", () => {
    render(<SessionsTab />);
    expect(screen.getByText("mine")).toBeInTheDocument();
    expect(screen.queryByText("other")).toBeNull();
  });

  it("user_id 없는 세션은 표시 (백엔드 스코핑 신뢰)", () => {
    mockUseQuery.mockReturnValue({
      data: [make_session({ key: "s-no-uid", chat_id: "no-uid", user_id: undefined })],
    });
    render(<SessionsTab />);
    expect(screen.getByText("no-uid")).toBeInTheDocument();
  });

  it("슈퍼어드민 토글 버튼 미노출", () => {
    render(<SessionsTab />);
    expect(screen.queryByText("workspace.sessions.showing_all")).toBeNull();
    expect(screen.queryByText("workspace.sessions.showing_mine")).toBeNull();
  });
});

// ── 슈퍼어드민 ──────────────────────────────────────────────────────────────

describe("SessionsTab — auth 활성, 슈퍼어드민", () => {
  beforeEach(() => setup_auth({ enabled: true, role: "superadmin", sub: "user-admin" }));

  it("기본(본인 모드) → 본인 세션만 표시", () => {
    render(<SessionsTab />);
    // admin 본인 세션 없음 → 빈 결과
    expect(screen.queryByText("mine")).toBeNull();
    expect(screen.queryByText("other")).toBeNull();
  });

  it("show_all 토글 → 모든 세션 표시", () => {
    render(<SessionsTab />);
    const toggle = screen.getByText("workspace.sessions.showing_mine");
    fireEvent.click(toggle);
    expect(screen.getByText("mine")).toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();
  });

  it("show_all 모드 → 타인 세션에 경고 아이콘 ⚠ 표시", () => {
    setup_auth({ enabled: true, role: "superadmin", sub: "user-admin" });
    mockUseQuery.mockReturnValue({
      data: [make_session({ key: "s-foreign", chat_id: "foreign-chat", user_id: "user-other" })],
    });
    render(<SessionsTab />);
    fireEvent.click(screen.getByText("workspace.sessions.showing_mine"));
    expect(screen.getByText("foreign-chat")).toBeInTheDocument();
    // ⚠ 아이콘 (aria-label 기반 확인)
    expect(screen.getByLabelText("workspace.sessions.foreign_session")).toBeInTheDocument();
  });
});
