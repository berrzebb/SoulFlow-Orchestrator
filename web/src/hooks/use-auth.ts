import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface AuthStatus {
  enabled: boolean;
  initialized: boolean;
}

export interface AuthUser {
  sub: string;
  username: string;
  role: "superadmin" | "user";
  tid: string;
  wdir: string;
  exp: number;
  /** 현재 팀에서의 역할. null = 멤버십 없음 또는 인증 비활성. */
  team_role?: TeamRole | null;
}

export interface MyTeam {
  id: string;
  name: string;
  created_at: string;
  /** 이 팀에서 현재 사용자의 역할. */
  role: TeamRole;
}

export interface AdminUserRecord {
  id: string;
  username: string;
  system_role: "superadmin" | "user";
  default_team_id: string | null;
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
}

export interface TeamRecord {
  id: string;
  name: string;
  created_at: string;
  member_count?: number;
}

export type TeamRole = "owner" | "manager" | "member" | "viewer";

export interface TeamMember {
  user_id: string;
  username: string | null;
  system_role: "superadmin" | "user" | null;
  role: TeamRole;
  joined_at: string;
  wdir: string;
}

export function useAuthStatus() {
  return useQuery<AuthStatus>({
    queryKey: ["auth-status"],
    queryFn: () => api.get("/api/auth/status"),
    staleTime: 60_000,
    retry: false,
  });
}

export function useAuthUser() {
  const { data: status } = useAuthStatus();
  return useQuery<AuthUser | null>({
    queryKey: ["auth-me"],
    queryFn: async () => {
      try { return await api.get<AuthUser>("/api/auth/me"); }
      catch { return null; }
    },
    enabled: status?.enabled === true,
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      api.post("/api/auth/login", creds),
    onSuccess: () => {
      // 이전 유저 캐시 완전 초기화 후 새 유저 정보 즉시 로드
      qc.clear();
      void qc.prefetchQuery({ queryKey: ["auth-me"], queryFn: async () => {
        try { return await api.get<AuthUser>("/api/auth/me"); }
        catch { return null; }
      } });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSuccess: () => {
      // 전체 캐시 초기화 — 이전 유저 데이터 완전 제거
      qc.clear();
    },
  });
}

export function useAdminUsers() {
  return useQuery<AdminUserRecord[]>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await api.get<{ users: AdminUserRecord[] }>("/api/admin/users");
      return res.users;
    },
    staleTime: 30_000,
  });
}

export function useAdminTeams() {
  return useQuery<TeamRecord[]>({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const res = await api.get<{ teams: TeamRecord[] }>("/api/admin/teams");
      return res.teams;
    },
    staleTime: 30_000,
  });
}

export function useTeamMembers(team_id: string | null) {
  return useQuery<TeamMember[]>({
    queryKey: ["team-members", team_id],
    queryFn: async () => {
      const res = await api.get<{ members: TeamMember[] }>(`/api/admin/teams/${team_id}/members`);
      return res.members;
    },
    enabled: !!team_id,
    staleTime: 30_000,
  });
}

export function useAddTeamMember(team_id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { user_id: string; role: TeamRole }) =>
      api.post(`/api/admin/teams/${team_id}/members`, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["team-members", team_id] }),
  });
}

export function useRemoveTeamMember(team_id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (user_id: string) => api.del(`/api/admin/teams/${team_id}/members/${user_id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["team-members", team_id] }),
  });
}

export function useUpdateTeamMemberRole(team_id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ user_id, role }: { user_id: string; role: TeamRole }) =>
      api.patch(`/api/admin/teams/${team_id}/members/${user_id}`, { role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["team-members", team_id] }),
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/api/admin/teams/${id}`, { name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-teams"] }),
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/teams/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-teams"] });
      void qc.invalidateQueries({ queryKey: ["my-teams"] });
    },
  });
}

/** 현재 사용자가 속한 팀 목록 (각 팀에서의 role 포함). */
export function useMyTeams() {
  const { data: status } = useAuthStatus();
  return useQuery<MyTeam[]>({
    queryKey: ["my-teams"],
    queryFn: async () => {
      const res = await api.get<{ teams: MyTeam[] }>("/api/auth/my-teams");
      return res.teams;
    },
    enabled: status?.enabled === true,
    staleTime: 60_000,
  });
}

/** 현재 팀 컨텍스트를 전환 — 새 JWT 발급 후 auth-me 캐시 갱신. */
export function useSwitchTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (team_id: string) => api.post("/api/auth/switch-team", { team_id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["auth-me"] });
      void qc.invalidateQueries({ queryKey: ["scoped-providers"] });
    },
  });
}
