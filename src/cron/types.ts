export type CronScheduleKind = "at" | "every" | "cron";

export type CronPayloadKind = "system_event" | "agent_turn";

export type CronJobStatus = "ok" | "error" | "skipped";

export type CronSchedule = {
  kind: CronScheduleKind;
  at_ms?: number | null;
  every_ms?: number | null;
  expr?: string | null;
  tz?: string | null;
  /** 동일 시각 실행 분산용 지연 (ms). job ID 기반 결정적 오프셋 적용. cron kind 전용. */
  stagger_ms?: number | null;
};

/** per-job 실행 오버라이드. agent_turn 모드에서 백엔드에 전달. */
export type CronJobOverrides = {
  model?: string | null;
  max_tokens?: number | null;
  thinking_budget?: number | null;
  temperature?: number | null;
};

export type CronPayload = {
  kind: CronPayloadKind;
  message: string;
  deliver: boolean;
  channel?: string | null;
  to?: string | null;
  /** agent_turn 실행 시 모델/토큰/thinking 오버라이드. */
  overrides?: CronJobOverrides | null;
};

export type CronJobState = {
  next_run_at_ms?: number | null;
  last_run_at_ms?: number | null;
  last_status?: CronJobStatus | null;
  last_error?: string | null;
  running?: boolean;
  running_started_at_ms?: number | null;
  /** 현재 연속 실패 횟수. 성공 시 0으로 리셋. */
  retry_attempt?: number;
};

/** 재시도 정책. 지수 백오프로 일시적 실패 자동 복구. */
export type CronRetryPolicy = {
  /** 최대 재시도 횟수. -1이면 무제한. */
  max_retries: number;
  /** 백오프 단계 (ms). attempt가 배열 길이를 초과하면 마지막 값 반복. */
  backoff_ms: number[];
};

/** recurring(every/cron) 기본 정책: 30s→1m→5m→15m→60m, 무제한. */
export const DEFAULT_RETRY_RECURRING: CronRetryPolicy = {
  max_retries: -1,
  backoff_ms: [30_000, 60_000, 300_000, 900_000, 3_600_000],
};

/** one-shot(at) 기본 정책: 동일 백오프, 3회 제한. */
export const DEFAULT_RETRY_ONESHOT: CronRetryPolicy = {
  max_retries: 3,
  backoff_ms: [30_000, 60_000, 300_000],
};

export type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
  created_at_ms: number;
  updated_at_ms: number;
  delete_after_run: boolean;
  /** 재시도 정책. null이면 스케줄 종류에 따라 기본 정책 적용. */
  retry?: CronRetryPolicy | null;
};

export type CronStore = {
  version: number;
  jobs: CronJob[];
};

export type CronOnJob = (job: CronJob) => Promise<string | null>;

export type CronChangeType = "executed" | "added" | "removed" | "enabled" | "disabled" | "paused" | "resumed";

export type CronServiceOptions = {
  running_lease_ms?: number;
  logger?: import("../logger.js").Logger | null;
  on_change?: (type: CronChangeType, job_id?: string) => void;
};

export type CronServiceStatus = {
  enabled: boolean;
  paused?: boolean;
  jobs: number;
  next_wake_at_ms: number | null;
};
