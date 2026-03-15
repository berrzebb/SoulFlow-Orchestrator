/**
 * FE-2: RootLayout SSE stale 감지 — 30초 이상 이벤트 없으면 stale 클래스 표시.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── SSE 핸들러 캡처 ──────────────────────────────────────────────────────────

type SseHandlers = Record<string, ((data?: unknown) => void) | undefined>;
let captured_handlers: SseHandlers = {};

vi.mock("@/api/sse", () => ({
  create_sse: (_url: string, handlers: SseHandlers) => {
    captured_handlers = handlers;
    return { close: vi.fn() };
  },
}));

// ── 의존성 모킹 ───────────────────────────────────────────────────────────────

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/" }),
    Outlet: () => <div data-testid="outlet" />,
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/store", () => ({
  useDashboardStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      connection: "connected",
      set_connection: vi.fn(),
      open_sidebar: vi.fn(),
      set_web_stream: vi.fn(),
      set_mirror_event: vi.fn(),
      theme: "light",
      toggle_theme: vi.fn(),
      push_canvas: vi.fn(),
    }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    set_locale: vi.fn(),
  }),
}));

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({ needed: false }) },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuthStatus: () => ({ data: { enabled: false } }),
  useAuthUser: () => ({ data: null, isLoading: false, isFetching: false }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
  useMyTeams: () => ({ data: [] }),
  useSwitchTeam: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-click-outside", () => ({ useClickOutside: vi.fn() }));
vi.mock("@/layouts/sidebar", () => ({ Sidebar: () => <div data-testid="sidebar" /> }));

import { RootLayout } from "@/layouts/root";

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("RootLayout — SSE stale 감지", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    captured_handlers = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("연결됐지만 30초 이상 이벤트가 없으면 stale 클래스를 표시한다", () => {
    render(
      <MemoryRouter>
        <RootLayout />
      </MemoryRouter>,
    );

    // ready 이벤트 → last_event_at.current = Date.now(), set_connection("connected")
    act(() => {
      captured_handlers.ready?.();
    });

    // 35초 전진 — 5초 간격 인터벌이 7회 발화, SSE_STALE_MS(30s) 초과
    act(() => {
      vi.advanceTimersByTime(35_000);
    });

    const conn_span = document.querySelector(".topbar__conn--stale");
    expect(conn_span).not.toBeNull();
    expect(screen.getByText("conn.stale")).toBeInTheDocument();
  });

  it("stale 상태에서 새 이벤트가 오면 stale 클래스가 사라진다", () => {
    render(
      <MemoryRouter>
        <RootLayout />
      </MemoryRouter>,
    );

    act(() => { captured_handlers.ready?.(); });
    act(() => { vi.advanceTimersByTime(35_000); }); // stale 상태 진입
    expect(document.querySelector(".topbar__conn--stale")).not.toBeNull();

    // process 이벤트 → mark_event() → last_event_at.current = 이제의 시간, set_sse_stale(false)
    act(() => { captured_handlers.process?.(); });

    // process 이벤트 후 5초 — 최근 이벤트 있으므로 stale 아님
    act(() => { vi.advanceTimersByTime(5_000); });

    expect(document.querySelector(".topbar__conn--stale")).toBeNull();
  });

  it("이벤트 없이 30초 미만이면 stale을 표시하지 않는다", () => {
    render(
      <MemoryRouter>
        <RootLayout />
      </MemoryRouter>,
    );

    act(() => { captured_handlers.ready?.(); });

    // 20초만 전진 — SSE_STALE_MS(30s) 미만
    act(() => { vi.advanceTimersByTime(20_000); });

    expect(document.querySelector(".topbar__conn--stale")).toBeNull();
  });
});
