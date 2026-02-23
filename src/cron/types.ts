export type CronScheduleKind = "at" | "every" | "cron";

export type CronPayloadKind = "system_event" | "agent_turn";

export type CronJobStatus = "ok" | "error" | "skipped";

export type CronSchedule = {
  kind: CronScheduleKind;
  at_ms?: number | null;
  every_ms?: number | null;
  expr?: string | null;
  tz?: string | null;
};

export type CronPayload = {
  kind: CronPayloadKind;
  message: string;
  deliver: boolean;
  channel?: string | null;
  to?: string | null;
};

export type CronJobState = {
  next_run_at_ms?: number | null;
  last_run_at_ms?: number | null;
  last_status?: CronJobStatus | null;
  last_error?: string | null;
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
};

export type CronStore = {
  version: number;
  jobs: CronJob[];
};

export type CronOnJob = (job: CronJob) => Promise<string | null>;

export type CronServiceOptions = {
  default_tick_ms?: number;
};

export type CronServiceStatus = {
  enabled: boolean;
  paused?: boolean;
  jobs: number;
  next_wake_at_ms: number | null;
};
