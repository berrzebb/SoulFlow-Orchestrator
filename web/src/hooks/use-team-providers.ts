import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface ScopedProvider {
  id: string;
  name: string;
  type: string;
  model: string;
  config: Record<string, unknown>;
  api_key_ref: string;
  enabled: boolean;
  created_at: string;
  scope: "global" | "team" | "personal";
  team_id?: string;
}

export interface ProviderInput {
  name: string;
  type: string;
  model?: string;
  config?: Record<string, unknown>;
  api_key_ref?: string;
  enabled?: boolean;
}

/** 팀 + 전역 병합 프로바이더 목록 (scope 배지 포함). */
export function useScopedProviders(team_id: string | null) {
  return useQuery<ScopedProvider[]>({
    queryKey: ["scoped-providers", team_id],
    queryFn: async () => {
      const res = await api.get<{ providers: ScopedProvider[] }>(`/api/teams/${team_id}/providers`);
      return res.providers;
    },
    enabled: !!team_id,
    staleTime: 30_000,
  });
}

/** 전역 프로바이더만 (superadmin 관리용). */
export function useGlobalProviders() {
  return useQuery<ScopedProvider[]>({
    queryKey: ["global-providers"],
    queryFn: async () => {
      const res = await api.get<{ providers: ScopedProvider[] }>("/api/admin/global-providers");
      return res.providers;
    },
    staleTime: 30_000,
  });
}

export function useAddTeamProvider(team_id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProviderInput) =>
      api.post<ScopedProvider>(`/api/teams/${team_id}/providers`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["scoped-providers", team_id] }),
  });
}

export function useDeleteTeamProvider(team_id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider_id: string) =>
      api.del(`/api/teams/${team_id}/providers/${provider_id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["scoped-providers", team_id] }),
  });
}

export function useAddGlobalProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProviderInput) =>
      api.post<ScopedProvider>("/api/admin/global-providers", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["global-providers"] });
      // 팀 목록에도 전역 프로바이더가 포함되므로 함께 갱신
      void qc.invalidateQueries({ queryKey: ["scoped-providers"] });
    },
  });
}

export function useDeleteGlobalProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/global-providers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["global-providers"] });
      void qc.invalidateQueries({ queryKey: ["scoped-providers"] });
    },
  });
}
