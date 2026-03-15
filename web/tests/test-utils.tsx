/**
 * 프론트엔드 테스트 공통 유틸리티.
 * MemoryRouter 래핑 + 공통 데이터 팩토리.
 */
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ValidatorSummary } from "@/pages/overview/types";

/** MemoryRouter로 래핑한 render. react-router-dom Link/useNavigate/useParams 사용 컴포넌트용. */
export function render_routed(ui: React.ReactNode): RenderResult {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

/** 모든 필수 필드가 있는 최소 DashboardState 팩토리. */
export function make_dashboard_state(overrides: Record<string, unknown> = {}) {
  return {
    now: "2026-01-01T00:00:00.000Z",
    agents: [],
    tasks: [],
    channels: { enabled: [], health: [], active_runs: 0 },
    processes: { active: [], recent: [] },
    cron: { jobs: [] },
    agent_providers: [],
    queue: { inbound: 0, outbound: 0 },
    ...overrides,
  };
}

/** 통과 ValidatorSummary 팩토리. */
export function make_passing_summary(overrides: Partial<ValidatorSummary> = {}): ValidatorSummary {
  return {
    repo_id: "test-repo",
    total_validators: 3,
    passed_validators: 3,
    failed_validators: [],
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** 실패 항목 있는 ValidatorSummary 팩토리. */
export function make_failing_summary(overrides: Partial<ValidatorSummary> = {}): ValidatorSummary {
  return {
    repo_id: "fail-repo",
    total_validators: 3,
    passed_validators: 1,
    failed_validators: [
      { kind: "test", command: "vitest run", output: "2 failed" },
      { kind: "typecheck", command: "tsc --noEmit" },
    ],
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
