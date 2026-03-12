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
  exp: number;
}

export interface AdminUserRecord {
  id: string;
  username: string;
  system_role: "superadmin" | "user";
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
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
