import { useState } from "react";
import { api } from "../api/client";
import { useAsyncAction } from "./use-async-action";

/**
 * 삭제 확인 모달 상태 + 삭제 액션 통합 훅.
 * deleteTarget 상태, confirmDelete, modalOpen/closeModal 을 반환.
 *
 * 사용:
 * const { deleteTarget, setDeleteTarget, confirmDelete, modalOpen, closeModal } =
 *   useDeleteConfirmation({ getEndpoint: (t) => `/api/jobs/${t.id}`, onDeleted: refresh, ... });
 */
export function useDeleteConfirmation<T>({
  getEndpoint,
  onDeleted,
  okMsg,
  errMsg,
}: {
  getEndpoint: (target: T) => string;
  onDeleted?: () => void;
  okMsg?: string;
  errMsg?: string;
}) {
  const run_action = useAsyncAction();
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);

  const confirm = () => {
    if (!deleteTarget) return Promise.resolve();
    return run_action(
      () => api.del(getEndpoint(deleteTarget)).then(() => { setDeleteTarget(null); onDeleted?.(); }),
      okMsg,
      errMsg,
    );
  };

  return {
    deleteTarget,
    setDeleteTarget,
    confirmDelete: () => void confirm(),
    modalOpen: !!deleteTarget,
    closeModal: () => setDeleteTarget(null),
  };
}
