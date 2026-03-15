/**
 * RPF-4F: WorkflowDetailPage — ArtifactEntryCard 조건부 렌더 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ArtifactBundleEntry } from "@/pages/workflows/detail";

// ── 모듈 모킹 ──────────────────────────────────────────────────────────────────

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn(() => ({ mutate: vi.fn(), isPending: false }));
const mockUseQueryClient = vi.fn(() => ({ invalidateQueries: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQueryClient: () => mockUseQueryClient(),
}));

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("@/api/client", () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-approvals", () => ({
  useApprovals: () => ({ pending: [], resolve: vi.fn() }),
}));
vi.mock("@/components/approval-banner", () => ({ ApprovalBanner: () => null }));
vi.mock("@/components/message-bubble", () => ({ MessageBubble: () => null }));
vi.mock("@/utils/format", () => ({ time_ago: () => "just now" }));

// ── 테스트 대상 ────────────────────────────────────────────────────────────────

import WorkflowDetailPage from "@/pages/workflows/detail";

/** WorkflowDetailPage를 `/workflows/wf-test` 경로로 마운트. */
function render_detail(wf_data: Record<string, unknown> | null, loading = false) {
  mockUseQuery.mockReturnValue({ data: wf_data, isLoading: loading });
  return render(
    <MemoryRouter initialEntries={["/workflows/wf-test"]}>
      <Routes>
        <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function make_wf(overrides: Record<string, unknown> = {}) {
  return {
    workflow_id: "wf-test",
    title: "Test Workflow",
    objective: "test objective",
    status: "completed",
    current_phase: 0,
    phases: [],
    memory: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() });
});

// ── ArtifactEntryCard ─────────────────────────────────────────────────────────

describe("WorkflowDetailPage — ArtifactEntryCard 조건부 렌더", () => {
  it("artifact_bundle 없으면 ArtifactEntryCard 미렌더", () => {
    render_detail(make_wf());
    expect(screen.queryByText("workflows.artifact_bundle")).toBeNull();
  });

  it("artifact_bundle + is_passing=true → Passing 배지 + repo_id 렌더", () => {
    const bundle: ArtifactBundleEntry = {
      repo_id: "my-repo",
      created_at: "2026-01-01T00:00:00.000Z",
      is_passing: true,
      total_validators: 3,
      passed_validators: 3,
      failed_kinds: [],
    };
    render_detail(make_wf({ artifact_bundle: bundle }));
    expect(screen.getByText("workflows.artifact_bundle")).toBeInTheDocument();
    expect(screen.getByText("workflows.artifact_bundle_passing")).toBeInTheDocument();
    expect(screen.getByText("my-repo")).toBeInTheDocument();
  });

  it("artifact_bundle + is_passing=false → 실패 배지 렌더", () => {
    const bundle: ArtifactBundleEntry = {
      repo_id: "fail-repo",
      created_at: "2026-01-01T00:00:00.000Z",
      is_passing: false,
      total_validators: 3,
      passed_validators: 1,
      failed_kinds: ["test", "typecheck"],
    };
    render_detail(make_wf({ artifact_bundle: bundle }));
    expect(screen.getByText("fail-repo")).toBeInTheDocument();
    // failed_kinds 목록 렌더
    expect(screen.getByText("Failed: test, typecheck")).toBeInTheDocument();
  });

  it("passed/total 카운트 렌더", () => {
    const bundle: ArtifactBundleEntry = {
      repo_id: "repo",
      created_at: "2026-01-01T00:00:00.000Z",
      is_passing: true,
      total_validators: 5,
      passed_validators: 5,
      failed_kinds: [],
    };
    render_detail(make_wf({ artifact_bundle: bundle }));
    expect(screen.getByText("5/5 validators")).toBeInTheDocument();
  });

  it("failed_kinds 빈 배열 → 실패 목록 미렌더", () => {
    const bundle: ArtifactBundleEntry = {
      repo_id: "repo",
      created_at: "2026-01-01T00:00:00.000Z",
      is_passing: true,
      total_validators: 2,
      passed_validators: 2,
      failed_kinds: [],
    };
    render_detail(make_wf({ artifact_bundle: bundle }));
    // "Failed:" 텍스트가 없어야 함
    expect(screen.queryByText(/^Failed:/)).toBeNull();
  });

  it("isLoading=true → 스켈레톤 렌더 (artifact_bundle 없음)", () => {
    render_detail(null, true);
    expect(screen.queryByText("workflows.artifact_bundle")).toBeNull();
  });
});
