import { useState } from "react";
import { useQuery, useMutation, useQueryClient, UseMutationResult } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * 리소스 CRUD 상태 관리 훅 — 데이터 로드, 삭제, 모달, 필터링 통합.
 *
 * 사용:
 * const { items, isLoading, deleteTarget, setDeleteTarget, remove, ... } =
 *   useResourceCRUD({
 *     queryKey: ["channels"],
 *     queryFn: () => api.get("/api/channels"),
 *     deleteEndpoint: (id) => `/api/channels/${id}`,
 *     onDeleteSuccess: () => toast("삭제됨", "ok"),
 *     onDeleteError: (err) => toast(err.message, "err"),
 *   });
 */
export interface UseResourceCRUDOptions<T> {
  queryKey: string[];
  queryFn: () => Promise<T[]>;
  deleteEndpoint?: (id: string) => string;
  onDeleteSuccess?: () => void;
  onDeleteError?: (err: Error) => void;
  refetchInterval?: number;
  staleTime?: number;
}

export interface UseResourceCRUDResult<T> {
  // 데이터
  items: T[];
  isLoading: boolean;

  // 삭제 모달
  deleteTarget: T | null;
  setDeleteTarget: (target: T | null) => void;
  remove: UseMutationResult<unknown, Error, string>;

  // 검색/필터
  search: string;
  setSearch: (s: string) => void;
  filtered: T[];

  // 유틸
  queryClient: ReturnType<typeof useQueryClient>;
}

export function useResourceCRUD<T extends Record<string, any>>({
  queryKey,
  queryFn,
  deleteEndpoint,
  onDeleteSuccess,
  onDeleteError,
  refetchInterval = 15_000,
  staleTime = 5_000,
}: UseResourceCRUDOptions<T>): UseResourceCRUDResult<T> {
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [search, setSearch] = useState("");

  const { data = [], isLoading } = useQuery<T[]>({
    queryKey,
    queryFn,
    refetchInterval,
    staleTime,
  });

  const remove = useMutation({
    mutationFn: (id: string) => {
      if (!deleteEndpoint) return Promise.resolve();
      return api.del(deleteEndpoint(id));
    },
    onSuccess: () => {
      onDeleteSuccess?.();
      void qc.invalidateQueries({ queryKey });
      setDeleteTarget(null);
    },
    onError: (err) => {
      onDeleteError?.(err as Error);
    },
  });

  const filtered = search
    ? data.filter((item) =>
        JSON.stringify(item).toLowerCase().includes(search.toLowerCase())
      )
    : data;

  return {
    items: data,
    isLoading,
    deleteTarget,
    setDeleteTarget,
    remove,
    search,
    setSearch,
    filtered,
    queryClient: qc,
  };
}
