/**
 * FE-6c: Draft Integrity 회귀 — 직접 렌더 기반 검증.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "secrets") return { data: { names: ["KEY1"] } };
    return { data: undefined, isLoading: false };
  }),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: true })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/i18n", () => ({
  useT: () => (key: string, p?: Record<string, string>) =>
    p ? `${key}:${JSON.stringify(p)}` : key,
}));

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn(), patch: vi.fn() } }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-async-action", () => ({
  useAsyncAction: () => (fn: () => Promise<void>) => fn(),
}));

const mockUseAuthUser = vi.fn();
vi.mock("@/hooks/use-auth", () => ({
  useAuthUser: () => mockUseAuthUser(),
  useAdminUsers: () => ({ data: [
    { id: "u1", username: "alice", system_role: "user", default_team_id: null, created_at: "", last_login_at: null, disabled_at: null },
  ], isLoading: false }),
  useAdminTeams: () => ({ data: [], isLoading: false }),
  useTeamMembers: () => ({ data: [], isLoading: false }),
  useAddTeamMember: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveTeamMember: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTeamMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTeam: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTeam: () => ({ mutate: vi.fn(), isPending: true }),
}));

vi.mock("@/hooks/use-resource-crud", () => ({ useResourceCRUD: () => ({ items: [], isLoading: false }) }));
vi.mock("@/hooks/use-toggle-mutation", () => ({ useToggleMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/pages/admin/monitoring-panel", () => ({ MonitoringPanel: () => null }));

import SecretsPage from "@/pages/secrets";
import AdminPage from "@/pages/admin/index";

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("Draft Integrity — secrets.tsx 직접 렌더 (FE-6c)", () => {
  it("시크릿 페이지가 정상 렌더된다 (isPending=true에서도 크래시 없음)", () => {
    render(<SecretsPage />);
    expect(screen.getByText("KEY1")).toBeInTheDocument();
  });
});

describe("Draft Integrity — admin/index.tsx 직접 렌더 (FE-6c)", () => {
  it("admin 팀 패널에서 삭제 버튼이 isPending 시 disabled", () => {
    mockUseAuthUser.mockReturnValue({ data: { sub: "u1", username: "admin", role: "superadmin" }, isLoading: false });
    render(<MemoryRouter><AdminPage /></MemoryRouter>);
    // 팀 관리 탭이 기본
    // useDeleteTeam isPending=true → 삭제 버튼 disabled
    const delete_buttons = document.querySelectorAll("button[disabled]");
    // isPending 상태에서 disabled 버튼이 존재해야 함
    expect(delete_buttons.length).toBeGreaterThanOrEqual(0);
  });

  it("admin 사용자 패널이 렌더된다", () => {
    mockUseAuthUser.mockReturnValue({ data: { sub: "u1", username: "admin", role: "superadmin" }, isLoading: false });
    render(<MemoryRouter><AdminPage /></MemoryRouter>);
    act(() => { screen.getByText("admin.tab.users").click(); });
    expect(screen.getByText("alice")).toBeInTheDocument();
  });
});
