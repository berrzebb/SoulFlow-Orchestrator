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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["auth-me"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSuccess: () => {
      qc.setQueryData<AuthUser | null>(["auth-me"], null);
      void qc.invalidateQueries({ queryKey: ["auth-me"] });
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
