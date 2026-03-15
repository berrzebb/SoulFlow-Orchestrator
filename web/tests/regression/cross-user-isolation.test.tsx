/**
 * FE-6: Cross-user 격리 회귀 — 사용자 스코핑 방어 레이어 검증.
 *
 * 검증 축:
 * 1. memory.tsx events — user_id 기반 클라이언트 필터 (백엔드 스코핑 방어 레이어)
 * 2. agents.tsx processes — sender_id 기반 클라이언트 필터
 * 3. sessions.tsx — user_id 기반 클라이언트 필터 (FE-2에서 이미 구현, 여기서 회귀 검증)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// ── 공통 모킹 ─────────────────────────────────────────────────────────────────

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/i18n", () => ({
  useT: () => (key: string, p?: Record<string, string>) =>
    p ? `${key}:${JSON.stringify(p)}` : key,
}));

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), del: vi.fn() } }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-async-action", () => ({
  useAsyncAction: () => (fn: () => Promise<void>) => fn(),
}));
vi.mock("@/utils/format", () => ({ time_ago: () => "1m ago" }));

const mockUseAuthUser = vi.fn();
const mockUseAuthStatus = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuthUser: () => mockUseAuthUser(),
  useAuthStatus: () => mockUseAuthStatus(),
}));

import { MemoryTab } from "@/pages/workspace/memory";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuthStatus.mockReturnValue({ data: { enabled: true, initialized: true } });
});

// ── MemoryTab events — user_id 필터 검증 ────────────────────────────────────

describe("MemoryTab events — user_id 격리 (FE-6)", () => {
  function setup(events: Record<string, unknown>[], user_sub = "user-A") {
    mockUseAuthUser.mockReturnValue({ data: { sub: user_sub, username: "alice", role: "user" } });
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "state") {
        return { data: { decisions: [], promises: [], workflow_events: events }, isLoading: false };
      }
      if (queryKey[0] === "memory-daily-list") return { data: { days: [] }, isLoading: false };
      return { data: { content: "" }, isLoading: false };
    });
  }

  it("user_id가 현재 사용자와 같은 이벤트만 표시", () => {
    setup([
      { event_id: "e1", phase: "done", task_id: "t1", agent_id: "a1", summary: "my event", at: "2026-01-01", user_id: "user-A" },
      { event_id: "e2", phase: "done", task_id: "t2", agent_id: "a2", summary: "foreign event", at: "2026-01-01", user_id: "user-B" },
    ]);
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    expect(screen.getByText("my event")).toBeInTheDocument();
    expect(screen.queryByText("foreign event")).toBeNull();
  });

  it("user_id가 빈 문자열인 이벤트는 표시 (레거시 데이터 호환)", () => {
    setup([
      { event_id: "e3", phase: "done", task_id: "t3", agent_id: "a3", summary: "legacy event", at: "2026-01-01", user_id: "" },
    ]);
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    expect(screen.getByText("legacy event")).toBeInTheDocument();
  });

  it("user_id 필드가 없는 이벤트도 표시 (graceful degradation)", () => {
    setup([
      { event_id: "e4", phase: "done", task_id: "t4", agent_id: "a4", summary: "no-uid event", at: "2026-01-01" },
    ]);
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    expect(screen.getByText("no-uid event")).toBeInTheDocument();
  });

  it("superadmin은 모든 이벤트 표시", () => {
    mockUseAuthUser.mockReturnValue({ data: { sub: "admin", username: "admin", role: "superadmin" } });
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "state") {
        return {
          data: {
            decisions: [], promises: [],
            workflow_events: [
              { event_id: "e5", phase: "done", task_id: "t5", agent_id: "a5", summary: "user-A event", at: "2026-01-01", user_id: "user-A" },
              { event_id: "e6", phase: "done", task_id: "t6", agent_id: "a6", summary: "user-B event", at: "2026-01-01", user_id: "user-B" },
            ],
          },
          isLoading: false,
        };
      }
      if (queryKey[0] === "memory-daily-list") return { data: { days: [] }, isLoading: false };
      return { data: { content: "" }, isLoading: false };
    });
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    expect(screen.getByText("user-A event")).toBeInTheDocument();
    expect(screen.getByText("user-B event")).toBeInTheDocument();
  });

  it("auth 비활성 시 모든 이벤트 표시 (싱글유저 모드)", () => {
    mockUseAuthStatus.mockReturnValue({ data: { enabled: false, initialized: true } });
    mockUseAuthUser.mockReturnValue({ data: null });
    setup([
      { event_id: "e7", phase: "done", task_id: "t7", agent_id: "a7", summary: "any event", at: "2026-01-01", user_id: "someone" },
    ]);
    // re-mock after setup because setup overrides
    mockUseAuthStatus.mockReturnValue({ data: { enabled: false, initialized: true } });
    mockUseAuthUser.mockReturnValue({ data: null });
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    expect(screen.getByText("any event")).toBeInTheDocument();
  });
});
