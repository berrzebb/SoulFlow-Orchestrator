import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useToast } from "../components/toast";
import { useT } from "../i18n";
import type { PendingApproval } from "../components/approval-banner";

export type { PendingApproval };

interface UseApprovalsOptions {
  /** 추가 쿼리 키를 같이 invalidate (예: 채팅 세션) */
  related_query_keys?: unknown[][];
  /** 폴링 주기 (ms). 기본 4000 */
  refetch_interval?: number;
  /** 활성화 여부. 기본 true */
  enabled?: boolean;
}

export function useApprovals(options: UseApprovalsOptions = {}) {
  const { related_query_keys = [], refetch_interval = 4_000, enabled = true } = options;
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();

  const { data: pending = [] } = useQuery<PendingApproval[]>({
    queryKey: ["approvals-pending"],
    queryFn: () => api.get("/api/approvals?status=pending"),
    refetchInterval: refetch_interval,
    enabled,
  });

  const resolve = async (request_id: string, text: string) => {
    try {
      await api.post(`/api/approvals/${encodeURIComponent(request_id)}/resolve`, { text });
      toast(t("chat.approval_done"), "ok");
      void qc.invalidateQueries({ queryKey: ["approvals-pending"] });
      for (const key of related_query_keys) {
        void qc.invalidateQueries({ queryKey: key });
      }
    } catch {
      toast(t("chat.approval_failed"), "err");
    }
  };

  return { pending, resolve };
}
