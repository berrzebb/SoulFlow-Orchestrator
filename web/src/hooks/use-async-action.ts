import { useToast } from "../components/toast";

/** try/catch/toast 패턴을 캡슐화한 훅.
 *  fn 성공 시 ok 메시지, 실패 시 err 메시지(없으면 실제 에러 내용) 토스트. */
export function useAsyncAction() {
  const { toast } = useToast();
  return async (fn: () => Promise<void>, ok?: string, err?: string) => {
    try {
      await fn();
      if (ok) toast(ok, "ok");
    } catch (e) {
      toast(err ?? (e instanceof Error ? e.message : String(e)), "err");
    }
  };
}
