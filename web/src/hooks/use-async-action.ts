import { useAsyncState } from "./use-async-state";

/** try/catch/toast 패턴을 캡슐화한 훅.
 *  fn 성공 시 ok 메시지, 실패 시 err 메시지(없으면 실제 에러 내용) 토스트. */
export function useAsyncAction() {
  const { run } = useAsyncState();
  return run;
}
