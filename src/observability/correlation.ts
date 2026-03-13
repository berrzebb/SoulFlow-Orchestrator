/**
 * OB-1: 실행 경로 전체를 관통하는 공통 correlation key 체계.
 *
 * request → channel → orchestration → workflow → delivery 경로가
 * 동일한 키 이름으로 이어지도록 한다.
 */
import { randomUUID } from "node:crypto";

/** 실행 문맥을 관통하는 공통 키. 모든 필드는 optional — 진입점마다 알 수 있는 범위가 다르다. */
export type CorrelationContext = {
  /** 전체 요청 흐름을 묶는 최상위 ID. UUID v4. */
  trace_id: string;
  /** HTTP 요청 단위 ID. 하나의 trace 내에 여러 request가 있을 수 있다. */
  request_id?: string;
  /** ProcessTracker가 부여하는 실행 추적 ID. */
  run_id?: string;
  /** 워크플로우 실행 ID. */
  workflow_id?: string;
  /** 팀 ID. 멀티테넌트 스코핑 기준. */
  team_id?: string;
  /** 사용자 ID. */
  user_id?: string;
  /** LLM 프로바이더 식별자. */
  provider?: string;
  /** 채팅 세션 ID. */
  chat_id?: string;
  /** 워크스페이스 경로. */
  workspace_dir?: string;
};

/** 새 trace_id를 가진 빈 correlation context 생성. */
export function create_correlation(seed?: Partial<CorrelationContext>): CorrelationContext {
  return { trace_id: randomUUID(), ...seed };
}

/** 기존 context에 추가 필드를 병합. undefined 값은 기존 값을 덮어쓰지 않는다. */
export function extend_correlation(
  base: CorrelationContext,
  extra: Partial<CorrelationContext>,
): CorrelationContext {
  const merged = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
}

/** CorrelationContext에서 undefined가 아닌 필드만 추출. 로그 출력용. */
export function correlation_fields(ctx: Partial<CorrelationContext>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v !== undefined) out[k] = String(v);
  }
  return out;
}
