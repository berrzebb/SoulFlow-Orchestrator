import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./client";

/** 범용 GET 훅 */
export function useApi<T>(key: string[], path: string, opts?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">) {
  return useQuery<T>({ queryKey: key, queryFn: () => api.get<T>(path), ...opts });
}

/* 주요 데이터 훅 */
export function useStatus() {
  return useApi<Record<string, unknown>>(["state"], "/api/state", { refetchInterval: 10_000, staleTime: 5_000 });
}
