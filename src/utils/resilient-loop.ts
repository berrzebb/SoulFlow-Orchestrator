/** 크래시 시 지수 백오프로 자동 재시작하는 비동기 루프 유틸. */

import { sleep } from "./common.js";

export type ResilientLoopOptions = {
  /** 루프 이름 (로깅용). */
  name: string;
  /** 루프가 계속 실행돼야 하는지 확인. false면 즉시 종료. */
  should_run: () => boolean;
  /** 에러 발생 시 로깅 콜백. */
  on_error?: (error: unknown) => void;
  /** 초기 재시작 대기 시간 (ms). 기본 1000. */
  base_delay_ms?: number;
  /** 최대 재시작 대기 시간 (ms). 기본 30000. */
  max_delay_ms?: number;
  /** 연속 에러 없이 이 시간 이상 실행되면 백오프 리셋 (ms). 기본 60000. */
  reset_after_ms?: number;
};

/**
 * 크래시 시 지수 백오프로 재시작하는 루프.
 * `fn`이 정상 종료되면 루프 종료. 예외 발생 시 백오프 후 재시작.
 */
export function resilient_loop(
  fn: () => Promise<void>,
  opts: ResilientLoopOptions,
): void {
  const base = opts.base_delay_ms ?? 1_000;
  const max = opts.max_delay_ms ?? 30_000;
  const reset_after = opts.reset_after_ms ?? 60_000;

  (async () => {
    let consecutive_failures = 0;

    while (opts.should_run()) {
      const started_at = Date.now();
      try {
        await fn();
        return; // 정상 종료
      } catch (e) {
        if (!opts.should_run()) return;

        opts.on_error?.(e);

        const ran_ms = Date.now() - started_at;
        if (ran_ms >= reset_after) {
          consecutive_failures = 0;
        }
        consecutive_failures++;

        const delay = Math.min(base * Math.pow(2, consecutive_failures - 1), max);
        await sleep(delay);
      }
    }
  })();
}
