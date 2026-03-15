/**
 * FE-6b: Stale State / Freshness 회귀 — 실제 렌더/훅 경로 직접 호출 검증.
 *
 * 검증 축:
 * 1. root.tsx SSE stale 감지 동작 (이미 root-sse-stale.test.tsx에서 커버 — 여기서는 통합 확인)
 * 2. useQuery refetchInterval 설정이 실제 렌더 시 적용됨
 * 3. workspace memory events에 freshness 관련 데이터가 전달됨
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

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
vi.mock("@/hooks/use-auth", () => ({
  useAuthUser: () => ({ data: { sub: "u1", username: "alice", role: "user" } }),
  useAuthStatus: () => ({ data: { enabled: true, initialized: true } }),
}));

import { MemoryTab } from "@/pages/workspace/memory";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("Stale/Freshness — refetchInterval 직접 검증 (FE-6b)", () => {
  it("MemoryTab state 쿼리에 refetchInterval 10_000ms가 전달된다", () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "state") return { data: { decisions: [], promises: [], workflow_events: [] }, isLoading: false };
      if (queryKey[0] === "memory-daily-list") return { data: { days: [] }, isLoading: false };
      return { data: { content: "" }, isLoading: false };
    });
    render(<MemoryTab />);
    // useQuery 호출 중 state 쿼리의 refetchInterval 확인
    const state_call = mockUseQuery.mock.calls.find(
      (call: unknown[]) => (call[0] as { queryKey: string[] }).queryKey[0] === "state",
    );
    expect(state_call).toBeDefined();
    expect((state_call![0] as { refetchInterval?: number }).refetchInterval).toBe(10_000);
  });

  it("MemoryTab state 쿼리에 staleTime 5_000ms가 전달된다", () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "state") return { data: { decisions: [], promises: [], workflow_events: [] }, isLoading: false };
      if (queryKey[0] === "memory-daily-list") return { data: { days: [] }, isLoading: false };
      return { data: { content: "" }, isLoading: false };
    });
    render(<MemoryTab />);
    const state_call = mockUseQuery.mock.calls.find(
      (call: unknown[]) => (call[0] as { queryKey: string[] }).queryKey[0] === "state",
    );
    expect((state_call![0] as { staleTime?: number }).staleTime).toBe(5_000);
  });

  it("MemoryTab events 뷰에서 이벤트 타임스탬프가 렌더된다 (freshness 표시)", () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "state") {
        return {
          data: {
            decisions: [], promises: [],
            workflow_events: [{ event_id: "e1", phase: "done", task_id: "t1", agent_id: "a1", summary: "fresh event", at: "2026-03-15T10:00:00Z" }],
          },
          isLoading: false,
        };
      }
      if (queryKey[0] === "memory-daily-list") return { data: { days: [] }, isLoading: false };
      return { data: { content: "" }, isLoading: false };
    });
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    expect(screen.getByText("1m ago")).toBeInTheDocument();
  });
});
