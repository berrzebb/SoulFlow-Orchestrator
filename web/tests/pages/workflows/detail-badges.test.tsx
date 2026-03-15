/**
 * FE-3: WorkflowDetailPage — retry_count / eval_score / schema_valid / reconcile_conflicts 배지 테스트.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/i18n", () => ({ useT: () => (key: string, p?: Record<string, string>) => p ? `${key}:${JSON.stringify(p)}` : key }));
vi.mock("@/api/client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-approvals", () => ({ useApprovals: () => ({ pending: [], resolve: vi.fn() }) }));
vi.mock("@/components/approval-banner", () => ({ ApprovalBanner: () => null }));
vi.mock("@/components/message-bubble", () => ({ MessageBubble: () => null }));
vi.mock("@/utils/format", () => ({ time_ago: () => "just now" }));

import WorkflowDetailPage from "@/pages/workflows/detail";

function make_agent(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: "a1",
    role: "worker",
    label: "Agent A",
    model: "claude",
    status: "completed",
    result: "done",
    messages: [],
    ...overrides,
  };
}

function make_wf(overrides: Record<string, unknown> = {}) {
  return {
    workflow_id: "wf-1",
    title: "Test WF",
    objective: "obj",
    status: "completed",
    current_phase: 0,
    phases: [],
    memory: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:01Z",
    ...overrides,
  };
}

function render_detail(wf_data: Record<string, unknown> | null, loading = false) {
  mockUseQuery.mockReturnValue({ data: wf_data, isLoading: loading });
  return render(
    <MemoryRouter initialEntries={["/workflows/wf-1"]}>
      <Routes>
        <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { vi.clearAllMocks(); mockUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false }); });

// ── eval_score 배지 ──────────────────────────────────────────────────────────

describe("AgentCard — eval_score 배지", () => {
  it("eval_score 없으면 점수 배지 미렌더", () => {
    // running 상태 phase → 접힘 없이 AgentCard 렌더
    const wf = make_wf({ status: "running", phases: [{ phase_id: "p1", title: "P1", status: "running", agents: [make_agent()], mode: "parallel" }] });
    render_detail(wf);
    expect(screen.queryByText(/^\d+%$/)).toBeNull();
  });

  it("eval_score=0.9 → '90%' 배지 렌더 (ok 색상)", () => {
    const agent = make_agent({ eval_score: 0.9 });
    const wf = make_wf({ status: "running", phases: [{ phase_id: "p1", title: "P1", status: "running", agents: [agent], mode: "parallel" }] });
    render_detail(wf);
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("eval_score=0.4 → '40%' 배지 렌더 (err 색상)", () => {
    const agent = make_agent({ eval_score: 0.4 });
    const wf = make_wf({ status: "running", phases: [{ phase_id: "p1", title: "P1", status: "running", agents: [agent], mode: "parallel" }] });
    render_detail(wf);
    expect(screen.getByText("40%")).toBeInTheDocument();
  });
});

// ── retry_count 배지 ─────────────────────────────────────────────────────────

describe("AgentCard — retry_count 배지", () => {
  it("retry_count=0 → 재시도 배지 미렌더", () => {
    const agent = make_agent({ retry_count: 0 });
    const wf = make_wf({ status: "running", phases: [{ phase_id: "p1", title: "P1", status: "running", agents: [agent], mode: "parallel" }] });
    render_detail(wf);
    expect(screen.queryByText(/↩\d+/)).toBeNull();
  });

  it("retry_count=3 → '↩3' 배지 렌더", () => {
    const agent = make_agent({ retry_count: 3 });
    const wf = make_wf({ status: "running", phases: [{ phase_id: "p1", title: "P1", status: "running", agents: [agent], mode: "parallel" }] });
    render_detail(wf);
    expect(screen.getByText("↩3")).toBeInTheDocument();
  });
});

// ── schema_valid 배지 ────────────────────────────────────────────────────────

describe("AgentCard — schema_valid 배지", () => {
  it("schema_valid=true → 검증 통과 배지", () => {
    const agent = make_agent({ schema_valid: true });
    const wf = make_wf({ status: "running", phases: [{ phase_id: "p1", title: "P1", status: "running", agents: [agent], mode: "parallel" }] });
    render_detail(wf);
    expect(screen.getByText("workflows.schema_valid", { exact: false })).toBeInTheDocument();
  });

  it("schema_valid=false → 검증 실패 배지", () => {
    const agent = make_agent({ schema_valid: false });
    const wf = make_wf({ status: "running", phases: [{ phase_id: "p1", title: "P1", status: "running", agents: [agent], mode: "parallel" }] });
    render_detail(wf);
    expect(screen.getByText("workflows.schema_invalid", { exact: false })).toBeInTheDocument();
  });

  it("schema_valid 미제공 → 배지 미렌더", () => {
    const wf = make_wf({ status: "running", phases: [{ phase_id: "p1", title: "P1", status: "running", agents: [make_agent()], mode: "parallel" }] });
    render_detail(wf);
    expect(screen.queryByText(/workflows\.schema_valid/)).toBeNull();
    expect(screen.queryByText(/workflows\.schema_invalid/)).toBeNull();
  });
});

// ── reconcile_conflicts 배지 ─────────────────────────────────────────────────

describe("PhaseCard — reconcile_conflicts 배지", () => {
  it("reconcile_conflicts=0 → 충돌 배지 미렌더", () => {
    const phase = { phase_id: "p1", title: "P1", status: "completed", agents: [make_agent()], mode: "parallel", reconcile_conflicts: 0 };
    render_detail(make_wf({ phases: [phase] }));
    expect(screen.queryByText(/reconcile_conflicts/)).toBeNull();
  });

  it("reconcile_conflicts=2 → 충돌 배지 렌더", () => {
    const phase = { phase_id: "p1", title: "P1", status: "completed", agents: [make_agent()], mode: "parallel", reconcile_conflicts: 2 };
    render_detail(make_wf({ phases: [phase] }));
    // t("workflows.reconcile_conflicts", { n: "2" }) → "workflows.reconcile_conflicts:{"n":"2"}"
    expect(screen.getByText(/reconcile_conflicts/)).toBeInTheDocument();
  });
});
