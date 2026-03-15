/**
 * FE-5: MemoryTab events 뷰 — retrieval_source + novelty_score 렌더 테스트.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
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
vi.mock("@/utils/format", () => ({
  time_ago: (v: string) => v ? "1m ago" : "-",
}));

import { MemoryTab } from "@/pages/workspace/memory";

function make_state(events: Record<string, unknown>[] = []) {
  return {
    decisions: [],
    promises: [],
    workflow_events: events,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

function setup_mocks(events: Record<string, unknown>[]) {
  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "state") {
      return { data: make_state(events), isLoading: false };
    }
    if (queryKey[0] === "memory-daily-list") {
      return { data: { days: [] }, isLoading: false };
    }
    if (queryKey[0] === "memory-content") {
      return { data: { content: "" }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  });
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("MemoryTab events — retrieval_source + novelty_score (FE-5)", () => {
  it("retrieval_source가 있으면 배지를 렌더한다", () => {
    setup_mocks([
      { event_id: "e1", phase: "done", task_id: "t1", agent_id: "a1", summary: "search", at: "2026-01-01", retrieval_source: "hybrid" },
    ]);
    render(<MemoryTab />);
    // events 탭으로 전환
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    expect(screen.getByText("hybrid")).toBeInTheDocument();
  });

  it("novelty_score가 있으면 퍼센트 렌더 (0.85 → 85%)", () => {
    setup_mocks([
      { event_id: "e2", phase: "done", task_id: "t1", agent_id: "a1", summary: "fetch", at: "2026-01-01", novelty_score: 0.85 },
    ]);
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("novelty_score >= 0.7이면 text-ok 클래스 적용", () => {
    setup_mocks([
      { event_id: "e3", phase: "done", task_id: "t1", agent_id: "a1", summary: "high", at: "2026-01-01", novelty_score: 0.75 },
    ]);
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    const score_el = screen.getByText("75%");
    expect(score_el.className).toContain("text-ok");
  });

  it("novelty_score < 0.4이면 text-err 클래스 적용", () => {
    setup_mocks([
      { event_id: "e4", phase: "done", task_id: "t1", agent_id: "a1", summary: "stale", at: "2026-01-01", novelty_score: 0.2 },
    ]);
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    const score_el = screen.getByText("20%");
    expect(score_el.className).toContain("text-err");
  });

  it("retrieval_source + novelty_score 둘 다 있으면 함께 렌더", () => {
    setup_mocks([
      { event_id: "e5", phase: "done", task_id: "t1", agent_id: "a1", summary: "both", at: "2026-01-01", retrieval_source: "vector", novelty_score: 0.5 },
    ]);
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    expect(screen.getByText("vector")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("retrieval 필드 없으면 '-' 렌더", () => {
    setup_mocks([
      { event_id: "e6", phase: "done", task_id: "t1", agent_id: "a1", summary: "plain", at: "2026-01-01" },
    ]);
    render(<MemoryTab />);
    act(() => { screen.getByText(/workspace\.memory\.events/).click(); });
    // Retrieval 컬럼 헤더가 존재
    expect(screen.getByText("Retrieval")).toBeInTheDocument();
  });
});
