/**
 * RPF-4F: MonitoringPanel — ValidatorSummaryPanel 조건부 렌더 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ValidatorSummary } from "@/pages/overview/types";

// ── 모듈 모킹 ──────────────────────────────────────────────────────────────────

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
  MetricBar: () => null,
  StatusDot: () => null,
  fmt_uptime: () => "0s",
  fmt_kbps: () => "0 KB/s",
}));
vi.mock("@/pages/overview/processes-section", () => ({ ProcessesSection: () => null }));
vi.mock("@/components/skeleton-grid", () => ({ SkeletonGrid: () => null }));

// ── 테스트 대상 ────────────────────────────────────────────────────────────────

import { MonitoringPanel } from "@/pages/admin/monitoring-panel";

function make_base_state(overrides: Record<string, unknown> = {}) {
  return {
    now: "2026-01-01T00:00:00.000Z",
    queue: { inbound: 0, outbound: 0 },
    channels: { enabled: [], health: [], active_runs: 0 },
    processes: { active: [], recent: [] },
    cron: { jobs: [] },
    agent_providers: [],
    ...overrides,
  };
}

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── ValidatorSummaryPanel ─────────────────────────────────────────────────────

describe("MonitoringPanel — ValidatorSummaryPanel 조건부 렌더", () => {
  it("validator_summary 없으면 ValidatorSummaryPanel 미렌더", () => {
    mockUseStatus.mockReturnValue({
      data: make_base_state(),
      isLoading: false,
      refetch: vi.fn(),
    });
    wrap(<MonitoringPanel />);
    expect(screen.queryByText("overview.validator_summary")).toBeNull();
  });

  it("validator_summary 있으면 repo_id와 Validator Status 헤더 렌더", () => {
    const summary: ValidatorSummary = {
      repo_id: "test-repo",
      total_validators: 3,
      passed_validators: 3,
      failed_validators: [],
      created_at: "2026-01-01T00:00:00.000Z",
    };
    mockUseStatus.mockReturnValue({
      data: make_base_state({ validator_summary: summary }),
      isLoading: false,
      refetch: vi.fn(),
    });
    wrap(<MonitoringPanel />);
    expect(screen.getByText("test-repo")).toBeInTheDocument();
    expect(screen.getByText("overview.validator_summary")).toBeInTheDocument();
  });

  it("모든 통과 → 배지에 'overview.validator_all_passed' 렌더", () => {
    const summary: ValidatorSummary = {
      repo_id: "clean-repo",
      total_validators: 2,
      passed_validators: 2,
      failed_validators: [],
      created_at: "2026-01-01T00:00:00.000Z",
    };
    mockUseStatus.mockReturnValue({
      data: make_base_state({ validator_summary: summary }),
      isLoading: false,
      refetch: vi.fn(),
    });
    wrap(<MonitoringPanel />);
    expect(screen.getByText("overview.validator_all_passed")).toBeInTheDocument();
  });

  it("실패 있음 → 실패 항목 kind와 command 렌더", () => {
    const summary: ValidatorSummary = {
      repo_id: "fail-repo",
      total_validators: 3,
      passed_validators: 1,
      failed_validators: [
        { kind: "test", command: "vitest run", output: "2 failed" },
      ],
      created_at: "2026-01-01T00:00:00.000Z",
    };
    mockUseStatus.mockReturnValue({
      data: make_base_state({ validator_summary: summary }),
      isLoading: false,
      refetch: vi.fn(),
    });
    wrap(<MonitoringPanel />);
    expect(screen.getByText("test")).toBeInTheDocument();
    expect(screen.getByText("vitest run")).toBeInTheDocument();
  });

  it("isLoading=true → SkeletonGrid 렌더 (validator_summary 미렌더)", () => {
    mockUseStatus.mockReturnValue({ data: undefined, isLoading: true, refetch: vi.fn() });
    wrap(<MonitoringPanel />);
    expect(screen.queryByText("overview.validator_summary")).toBeNull();
  });
});

// ── RPF-6: risk_tier + eval_score 배지 ────────────────────────────────────────

describe("MonitoringPanel — risk_tier + eval_score 배지 (RPF-6)", () => {
  it("risk_tier=high → 위험 등급 레이블 렌더", () => {
    mockUseStatus.mockReturnValue({
      data: make_base_state({
        validator_summary: {
          repo_id: "r",
          total_validators: 1,
          passed_validators: 1,
          failed_validators: [],
          created_at: "2026-01-01T00:00:00.000Z",
          risk_tier: "high",
        },
      }),
      isLoading: false,
      refetch: vi.fn(),
    });
    wrap(<MonitoringPanel />);
    expect(screen.getByText("overview.risk_tier_high")).toBeInTheDocument();
    expect(screen.getByText("overview.risk_tier")).toBeInTheDocument();
  });

  it("risk_tier 없으면 위험 등급 섹션 미렌더", () => {
    mockUseStatus.mockReturnValue({
      data: make_base_state({
        validator_summary: {
          repo_id: "r",
          total_validators: 1,
          passed_validators: 1,
          failed_validators: [],
          created_at: "2026-01-01T00:00:00.000Z",
        },
      }),
      isLoading: false,
      refetch: vi.fn(),
    });
    wrap(<MonitoringPanel />);
    expect(screen.queryByText("overview.risk_tier")).toBeNull();
  });

  it("eval_score=0.9 → 90% 배지 렌더", () => {
    mockUseStatus.mockReturnValue({
      data: make_base_state({
        validator_summary: {
          repo_id: "r",
          total_validators: 1,
          passed_validators: 1,
          failed_validators: [],
          created_at: "2026-01-01T00:00:00.000Z",
          eval_score: 0.9,
        },
      }),
      isLoading: false,
      refetch: vi.fn(),
    });
    wrap(<MonitoringPanel />);
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("overview.eval_score")).toBeInTheDocument();
  });

  it("eval_score 없으면 eval score 섹션 미렌더", () => {
    mockUseStatus.mockReturnValue({
      data: make_base_state({
        validator_summary: {
          repo_id: "r",
          total_validators: 1,
          passed_validators: 1,
          failed_validators: [],
          created_at: "2026-01-01T00:00:00.000Z",
        },
      }),
      isLoading: false,
      refetch: vi.fn(),
    });
    wrap(<MonitoringPanel />);
    expect(screen.queryByText("overview.eval_score")).toBeNull();
  });
});
