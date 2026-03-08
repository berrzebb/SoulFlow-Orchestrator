import { useState } from "react";
import { useToast } from "../components/toast";

/** try/catch/toast + pending 상태를 함께 관리하는 훅.
 *  버튼 비활성화/로딩 텍스트 표시가 필요한 액션에 사용. */
export function useAsyncState() {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<void>, ok?: string, err?: string | ((e: unknown) => string)) => {
    setPending(true);
    try {
      await fn();
      if (ok) toast(ok, "ok");
    } catch (e) {
      const msg = typeof err === "function" ? err(e) : (err ?? (e instanceof Error ? e.message : String(e)));
      toast(msg, "err");
    } finally {
      setPending(false);
    }
  };
  return { pending, run };
}
