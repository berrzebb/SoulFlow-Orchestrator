/**
 * FE-6b: State Consistency 회귀 — 타입 수준 + MonitoringPanel 직접 렌더 검증.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { WorkflowEvent as OverviewWorkflowEvent, RequestClass, DashboardState } from "@/pages/overview/types";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

const mockUseStatus = vi.fn();
vi.mock("@/api/hooks", () => ({ useStatus: (...args: unknown[]) => mockUseStatus(...args) }));
vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/utils/constants", () => ({ PROVIDER_COLORS: {} }));
vi.mock("@/utils/format", () => ({ fmt_time: (v: unknown) => String(v) }));
vi.mock("@/pages/overview/helpers", () => ({
  MetricBar: () => null, StatusDot: () => null, fmt_uptime: () => "0s", fmt_kbps: () => "0 KB/s",
}));
vi.mock("@/pages/overview/processes-section", () => ({ ProcessesSection: () => null }));
vi.mock("@/components/skeleton-grid", () => ({ SkeletonGrid: () => null }));

import { MonitoringPanel } from "@/pages/admin/monitoring-panel";

// ── 타입 수준 일치 검증 ────────────────────────────────────────────────────

describe("State Consistency — 타입 수준 drift 방지 (FE-6b)", () => {
  it("OverviewWorkflowEvent에 user_id 필드가 할당 가능하다", () => {
    const event: OverviewWorkflowEvent = {
      event_id: "e1", phase: "done", task_id: "t1", agent_id: "a1", summary: "ok",
      user_id: "user-42",
    };
    expect(event.user_id).toBe("user-42");
  });

  it("OverviewWorkflowEvent에 retrieval_source + novelty_score가 할당 가능하다", () => {
    const event: OverviewWorkflowEvent = {
      event_id: "e2", phase: "done", task_id: "t2", agent_id: "a2", summary: "ok",
      retrieval_source: "hybrid", novelty_score: 0.8,
    };
    expect(event.retrieval_source).toBe("hybrid");
    expect(event.novelty_score).toBe(0.8);
  });

  it("DashboardState에 request_class_summary + guardrail_stats가 할당 가능하다", () => {
    const state: Partial<DashboardState> = {
      request_class_summary: { builtin: 10, agent: 3 },
      guardrail_stats: { blocked: 1, total: 50 },
    };
    expect(state.request_class_summary?.builtin).toBe(10);
    expect(state.guardrail_stats?.blocked).toBe(1);
  });

  it("RequestClass 6개 값이 모두 유효하다", () => {
    const classes: RequestClass[] = [
      "builtin", "direct_tool", "model_direct",
      "workflow_compile", "workflow_run", "agent",
    ];
    expect(classes).toHaveLength(6);
  });
});

// ── MonitoringPanel 직접 렌더 — request class 배지 variant 검증 ──────────────

describe("State Consistency — MonitoringPanel request class 배지 직접 렌더 (FE-6b)", () => {
  it("request_class_summary가 있으면 배지가 올바른 텍스트로 렌더된다", () => {
    mockUseStatus.mockReturnValue({
      data: {
        now: "2026-01-01T00:00:00.000Z",
        queue: { inbound: 0, outbound: 0 },
        channels: { enabled: [], health: [], active_runs: 0 },
        processes: { active: [], recent: [] },
        cron: { jobs: [] },
        agent_providers: [],
        request_class_summary: { builtin: 10, agent: 3 },
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    render(<MemoryRouter><MonitoringPanel /></MemoryRouter>);
    expect(screen.getByTestId("request-class-panel")).toBeInTheDocument();
    expect(screen.getByText("builtin")).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
  });

  it("guardrail_stats blocked=0이면 clear 배지가 렌더된다", () => {
    mockUseStatus.mockReturnValue({
      data: {
        now: "2026-01-01T00:00:00.000Z",
        queue: { inbound: 0, outbound: 0 },
        channels: { enabled: [], health: [], active_runs: 0 },
        processes: { active: [], recent: [] },
        cron: { jobs: [] },
        agent_providers: [],
        guardrail_stats: { blocked: 0, total: 50 },
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    render(<MemoryRouter><MonitoringPanel /></MemoryRouter>);
    expect(screen.getByText("overview.guardrail_clear")).toBeInTheDocument();
  });
});
