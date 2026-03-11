import type { CronJob, CronJobOverrides, CronRetryPolicy, CronSchedule, CronServiceStatus } from "./types.js";

export interface CronScheduler {
  add_job(
    name: string,
    schedule: CronSchedule,
    message: string,
    deliver?: boolean,
    channel?: string | null,
    to?: string | null,
    delete_after_run?: boolean,
    options?: { retry?: CronRetryPolicy; overrides?: CronJobOverrides },
  ): Promise<CronJob>;
  remove_job(job_id: string): Promise<boolean>;
  enable_job(job_id: string, enabled?: boolean): Promise<CronJob | null>;
  run_job(job_id: string, force?: boolean): Promise<boolean>;
  list_jobs(include_disabled?: boolean): Promise<CronJob[]>;
  status(): Promise<CronServiceStatus>;
  every(ms: number, fn: () => Promise<void>): void;
  /** 크론 스케줄러 일시 정지 — 등록된 작업은 유지하되 실행을 중단. */
  pause(): Promise<void>;
  /** 일시 정지된 스케줄러를 재개. */
  resume(): Promise<void>;
  /** 스케줄러 완전 중지 — 타이머 해제. */
  stop(): Promise<void>;
  /** 전체 작업을 비활성화(enabled=false)하고 스케줄러를 일시 정지. */
  disable_all_and_pause(): Promise<number>;
}
