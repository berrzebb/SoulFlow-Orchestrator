/**
 * FE-4: AdminPage UsersPanel — session_count 배지 테스트.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── 모킹 ──────────────────────────────────────────────────────────────────────

const mockUseAuthUser = vi.fn();
const mockUseAdminUsers = vi.fn();
const mockUseAdminTeams = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuthUser: () => mockUseAuthUser(),
  useAdminUsers: () => mockUseAdminUsers(),
  useAdminTeams: () => mockUseAdminTeams(),
  useTeamMembers: () => ({ data: [], isLoading: false }),
  useAddTeamMember: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveTeamMember: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTeamMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTeam: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTeam: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/i18n", () => ({
  useT: () => (key: string, p?: Record<string, string>) =>
    p ? `${key}:${JSON.stringify(p)}` : key,
}));
vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn(), patch: vi.fn() } }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-resource-crud", () => ({ useResourceCRUD: () => ({ items: [], isLoading: false }) }));
vi.mock("@/hooks/use-toggle-mutation", () => ({ useToggleMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/pages/admin/monitoring-panel", () => ({ MonitoringPanel: () => null }));

import AdminPage from "@/pages/admin/index";

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuthUser.mockReturnValue({ data: { sub: "u1", username: "admin", role: "superadmin" }, isLoading: false });
  mockUseAdminTeams.mockReturnValue({ data: [], isLoading: false });
});

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("AdminPage UsersPanel — session_count 배지 (FE-4)", () => {
  it("session_count가 있으면 배지를 렌더한다", () => {
    mockUseAdminUsers.mockReturnValue({
      data: [
        { id: "u1", username: "alice", system_role: "user", default_team_id: null, created_at: "", last_login_at: null, disabled_at: null, session_count: 3 },
      ],
      isLoading: false,
    });
    wrap(<AdminPage />);
    act(() => { screen.getByText("admin.tab.users").click(); });
    expect(screen.getByText("3 sessions")).toBeInTheDocument();
  });

  it("session_count=0이면 배지를 렌더하지 않는다", () => {
    mockUseAdminUsers.mockReturnValue({
      data: [
        { id: "u2", username: "bob", system_role: "user", default_team_id: null, created_at: "", last_login_at: null, disabled_at: null, session_count: 0 },
      ],
      isLoading: false,
    });
    wrap(<AdminPage />);
    act(() => { screen.getByText("admin.tab.users").click(); });
    expect(screen.queryByText(/sessions/)).toBeNull();
  });

  it("session_count가 없으면 배지를 렌더하지 않는다", () => {
    mockUseAdminUsers.mockReturnValue({
      data: [
        { id: "u3", username: "carol", system_role: "user", default_team_id: null, created_at: "", last_login_at: null, disabled_at: null },
      ],
      isLoading: false,
    });
    wrap(<AdminPage />);
    act(() => { screen.getByText("admin.tab.users").click(); });
    expect(screen.queryByText(/sessions/)).toBeNull();
  });
});
