import type { CronJob, CronSchedule, CronServiceStatus } from "./types.js";

export interface CronScheduler {
  add_job(
    name: string,
    schedule: CronSchedule,
    message: string,
    deliver?: boolean,
    channel?: string | null,
    to?: string | null,
    delete_after_run?: boolean,
  ): Promise<CronJob>;
  remove_job(job_id: string): Promise<boolean>;
  enable_job(job_id: string, enabled?: boolean): Promise<CronJob | null>;
  run_job(job_id: string, force?: boolean): Promise<boolean>;
  list_jobs(include_disabled?: boolean): Promise<CronJob[]>;
  status(): Promise<CronServiceStatus>;
  every(ms: number, fn: () => Promise<void>): void;
}
