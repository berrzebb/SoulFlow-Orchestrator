import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useToast } from "../components/toast";

/**
 * 낙관적 업데이트를 포함한 토글 뮤테이션 훅.
 * 항목 ID와 boolean 필드를 PUT으로 업데이트하며, 실패 시 이전 상태로 롤백.
 *
 * 사용:
 * const toggle = useToggleMutation<Item>({
 *   queryKey: ["items"],
 *   getEndpoint: (id) => `/api/items/${id}`,
 *   idField: "item_id",
 *   toggleField: "enabled",
 *   getErrMsg: (err) => t("save_failed", { error: err.message }),
 * });
 * // JSX: onChange={(value) => toggle.mutate({ id: item.item_id, value })}
 */
export function useToggleMutation<T>({
  queryKey,
  getEndpoint,
  idField,
  toggleField,
  getErrMsg,
}: {
  queryKey: string[];
  getEndpoint: (id: string) => string;
  idField: keyof T & string;
  toggleField: keyof T & string;
  getErrMsg?: (err: Error) => string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      api.put(getEndpoint(id), { [toggleField]: value }),
    onMutate: ({ id, value }) => {
      const prev = qc.getQueryData<T[]>(queryKey);
      if (prev) {
        qc.setQueryData(
          queryKey,
          prev.map((item) =>
            String((item as Record<string, unknown>)[idField]) === id
              ? { ...item, [toggleField]: value }
              : item,
          ),
        );
      }
      return prev;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
    onError: (err, _, prev) => {
      if (prev) qc.setQueryData(queryKey, prev);
      toast(getErrMsg?.(err as Error) ?? (err as Error).message, "err");
    },
  });
}
