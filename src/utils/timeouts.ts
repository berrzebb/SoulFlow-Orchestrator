/**
 * 도메인별 타임아웃 상수 중앙화.
 * 각 모듈에서 로컬 상수 대신 이 파일을 import한다.
 */

// ── 외부 HTTP 요청 (채널 API, 미디어 다운로드, 모델 카탈로그, 임베딩) ──
export const HTTP_FETCH_QUICK_TIMEOUT_MS = 10_000;   // 헬스체크, 웹훅, OAuth 연결 확인
export const HTTP_FETCH_SHORT_TIMEOUT_MS = 15_000;   // RSS, Prometheus push 등 단순 요청
export const HTTP_FETCH_TIMEOUT_MS = 30_000;          // 일반 HTTP 요청 기본값
export const HTTP_FETCH_LONG_TIMEOUT_MS = 60_000;    // S3 업로드/다운로드, 임베딩 배치

// ── MCP 서버 스타트업 ──
export const MCP_STARTUP_TIMEOUT_MS = 15_000;

// ── LLM 프로바이더 요청 ──
export const LLM_REQUEST_TIMEOUT_MS = 120_000;
export const LLM_CLI_TIMEOUT_MS = 180_000;
export const LLM_PER_CALL_TIMEOUT_MS = 90_000;

// ── 에이전트 턴 ──
export const AGENT_PER_TURN_TIMEOUT_MS = 600_000;

// ── 프로세스 수명주기 ──
export const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Promise에 타임아웃을 적용. 완료/실패 시 타이머를 반드시 정리한다.
 * Promise.race 직접 사용 시 타이머 누수가 발생하므로 이 함수를 사용할 것.
 */
export function with_timeout<T>(promise: Promise<T>, timeout_ms: number): Promise<T> {
  if (timeout_ms <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout_promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${timeout_ms}ms`)), timeout_ms);
  });
  return Promise.race([promise, timeout_promise]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

/**
 * 최대 concurrency 개수만큼 동시에 태스크를 실행.
 * errorMode: "continue" → 에러 무시하고 계속, "stop" → 첫 에러 시 중단.
 */
export async function run_tasks_with_concurrency<T>(params: {
  tasks: Array<() => Promise<T>>;
  limit: number;
  error_mode?: "continue" | "stop";
  on_error?: (error: unknown, index: number) => void;
}): Promise<{ results: T[]; first_error: unknown; has_error: boolean }> {
  const { tasks, on_error } = params;
  const error_mode = params.error_mode ?? "continue";
  if (tasks.length === 0) return { results: [], first_error: undefined, has_error: false };

  const limit = Math.max(1, Math.min(params.limit, tasks.length));
  const results: T[] = Array.from({ length: tasks.length });
  let next = 0;
  let first_error: unknown = undefined;
  let has_error = false;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      if (error_mode === "stop" && has_error) return;
      const index = next++;
      if (index >= tasks.length) return;
      try {
        results[index] = await tasks[index]();
      } catch (error) {
        if (!has_error) { first_error = error; has_error = true; }
        on_error?.(error, index);
        if (error_mode === "stop") return;
      }
    }
  });

  await Promise.allSettled(workers);
  return { results, first_error, has_error };
}
