/**
 * EV-1: Evaluation Pipeline contracts.
 *
 * EvalCase/EvalDataset/EvalResult + DI 인터페이스.
 * 로컬 eval runner가 에이전트 응답 품질을 측정하는 최소 계약.
 */

/* ── 데이터 모델 ─────────────────────────────── */

export interface EvalCase {
  /** 케이스 고유 식별자. */
  id: string;
  /** 에이전트에게 전달할 입력 프롬프트. */
  input: string;
  /** 기대 결과 (scorer가 비교 기준으로 사용). */
  expected?: string;
  /** 필터링/그룹핑용 태그. */
  tags?: string[];
  /** 케이스별 추가 메타데이터. */
  metadata?: Record<string, unknown>;
}

export interface EvalDataset {
  /** 데이터셋 이름. */
  name: string;
  /** 데이터셋 설명. */
  description?: string;
  /** 평가 케이스 목록. */
  cases: EvalCase[];
}

export interface EvalResult {
  /** 원본 케이스 ID. */
  case_id: string;
  /** 소속 데이터셋 이름. */
  dataset: string;
  /** 통과 여부. */
  passed: boolean;
  /** 에이전트 실제 출력. */
  actual?: string;
  /** 0~1 범위 점수 (scorer 기반). */
  score: number;
  /** 실행 소요 시간 (ms). */
  duration_ms: number;
  /** 에러 메시지 (실행 실패 시). */
  error?: string;
}

export interface EvalRunSummary {
  /** 데이터셋 이름. */
  dataset: string;
  /** 전체 케이스 수. */
  total: number;
  /** 통과 수. */
  passed: number;
  /** 실패 수. */
  failed: number;
  /** 에러 수 (실행 자체 실패). */
  error_count: number;
  /** 전체 소요 시간 (ms). */
  duration_ms: number;
  /** 개별 결과. */
  results: EvalResult[];
}

/* ── DI 인터페이스 ─────────────────────────────── */

/** 에이전트/오케스트레이터 실행 추상화. */
export interface EvalExecutorLike {
  execute(input: string): Promise<{ output: string; error?: string }>;
}

/** 결과 채점 추상화. */
export interface EvalScorerLike {
  score(input: string, expected: string | undefined, actual: string): { passed: boolean; score: number };
}
