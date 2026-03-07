import { describe, it, expect, vi } from "vitest";
import { CronTool } from "@src/agent/tools/cron.js";
import type { CronScheduler } from "@src/cron/contracts.js";
import type { CronJob, CronSchedule, CronServiceStatus } from "@src/cron/types.js";

function make_job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job_1",
    name: "test-job",
    enabled: true,
    schedule: { kind: "every", every_ms: 60000 },
    payload: { kind: "agent_turn", message: "hello", deliver: false },
    state: {},
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
    delete_after_run: false,
    ...overrides,
  };
}

function make_scheduler(overrides: Partial<CronScheduler> = {}): CronScheduler {
  return {
    add_job: vi.fn(async (name) => make_job({ name })),
    remove_job: vi.fn(async () => true),
    enable_job: vi.fn(async (_id, enabled) => make_job({ enabled })),
    run_job: vi.fn(async () => true),
    list_jobs: vi.fn(async () => [make_job()]),
    status: vi.fn(async (): Promise<CronServiceStatus> => ({ enabled: true, jobs: 1, next_wake_at_ms: null })),
    every: vi.fn(),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    disable_all_and_pause: vi.fn(async () => 0),
    ...overrides,
  };
}

function make_tool(scheduler?: Partial<CronScheduler>) {
  return new CronTool(make_scheduler(scheduler));
}

describe("CronTool", () => {
  describe("action=status", () => {
    it("returns scheduler status", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "status" });
      const parsed = JSON.parse(result);
      expect(parsed.enabled).toBe(true);
      expect(parsed.jobs).toBe(1);
    });
  });

  describe("action=list", () => {
    it("lists jobs", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "list" });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("test-job");
    });

    it("passes include_disabled flag", async () => {
      const list_jobs = vi.fn(async () => []);
      const tool = make_tool({ list_jobs });
      await tool.execute({ action: "list", include_disabled: true });
      expect(list_jobs).toHaveBeenCalledWith(true);
    });
  });

  describe("action=remove", () => {
    it("removes a job", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "remove", job_id: "job_1" });
      expect(result).toBe("removed:job_1");
    });

    it("reports not_found", async () => {
      const tool = make_tool({ remove_job: vi.fn(async () => false) });
      const result = await tool.execute({ action: "remove", job_id: "none" });
      expect(result).toBe("not_found:none");
    });

    it("requires job_id", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "remove" });
      expect(result).toContain("Error");
    });
  });

  describe("action=enable/disable", () => {
    it("enables a job", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "enable", job_id: "job_1" });
      const parsed = JSON.parse(result);
      expect(parsed.enabled).toBe(true);
    });

    it("disables a job", async () => {
      const enable_job = vi.fn(async (_id: string, enabled?: boolean) => make_job({ enabled }));
      const tool = make_tool({ enable_job });
      const result = await tool.execute({ action: "disable", job_id: "job_1" });
      const parsed = JSON.parse(result);
      expect(parsed.enabled).toBe(false);
    });

    it("returns not_found when job missing", async () => {
      const tool = make_tool({ enable_job: vi.fn(async () => null) });
      const result = await tool.execute({ action: "enable", job_id: "nope" });
      expect(result).toBe("not_found:nope");
    });
  });

  describe("action=run", () => {
    it("runs a job", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "run", job_id: "job_1" });
      expect(result).toBe("run:job_1");
    });

    it("reports cannot_run", async () => {
      const tool = make_tool({ run_job: vi.fn(async () => false) });
      const result = await tool.execute({ action: "run", job_id: "job_1" });
      expect(result).toBe("cannot_run:job_1");
    });
  });

  describe("action=add", () => {
    it("adds every_seconds schedule", async () => {
      const add_job = vi.fn(async (name: string, schedule: CronSchedule) =>
        make_job({ name, schedule }),
      );
      const tool = make_tool({ add_job });
      const result = await tool.execute({
        action: "add",
        every_seconds: 300,
        message: "check status",
      });
      expect(result).toContain("registered");
      expect(add_job).toHaveBeenCalled();
      const schedule = add_job.mock.calls[0][1] as CronSchedule;
      expect(schedule.kind).toBe("every");
      expect(schedule.every_ms).toBe(300000);
    });

    it("adds cron_expr schedule", async () => {
      const add_job = vi.fn(async (name: string, schedule: CronSchedule) =>
        make_job({ name, schedule }),
      );
      const tool = make_tool({ add_job });
      await tool.execute({
        action: "add",
        cron_expr: "0 9 * * *",
        message: "morning check",
      });
      const schedule = add_job.mock.calls[0][1] as CronSchedule;
      expect(schedule.kind).toBe("cron");
      expect(schedule.expr).toBe("0 9 * * *");
    });

    it("adds at (one-shot) schedule", async () => {
      const add_job = vi.fn(async (name: string, schedule: CronSchedule) =>
        make_job({ name, schedule, delete_after_run: true }),
      );
      const tool = make_tool({ add_job });
      const result = await tool.execute({
        action: "add",
        at: "2025-06-01T09:00:00Z",
        message: "reminder",
      });
      expect(result).toContain("delete_after_run=true");
      const schedule = add_job.mock.calls[0][1] as CronSchedule;
      expect(schedule.kind).toBe("at");
      expect(schedule.at_ms).toBeGreaterThan(0);
    });

    it("returns error for invalid at datetime", async () => {
      const tool = make_tool();
      const result = await tool.execute({
        action: "add",
        at: "not-a-date",
        message: "reminder",
      });
      expect(result).toContain("Error");
      expect(result).toContain("invalid_at_datetime");
    });

    it("requires at least one schedule type", async () => {
      const tool = make_tool();
      const result = await tool.execute({
        action: "add",
        message: "no schedule",
      });
      expect(result).toContain("Error");
    });

    it("requires message", async () => {
      const tool = make_tool();
      const result = await tool.execute({
        action: "add",
        every_seconds: 60,
      });
      expect(result).toContain("Error");
      expect(result).toContain("message is required");
    });

    it("uses context for target channel/chat_id", async () => {
      const add_job = vi.fn(async (name: string, schedule: CronSchedule) => make_job({ name }));
      const tool = make_tool({ add_job });
      await tool.execute(
        { action: "add", every_seconds: 60, message: "test" },
        { channel: "slack", chat_id: "C123" },
      );
      expect(add_job).toHaveBeenCalled();
      const channel = add_job.mock.calls[0][4]; // channel arg
      const to = add_job.mock.calls[0][5]; // to arg
      expect(channel).toBe("slack");
      expect(to).toBe("C123");
    });

    it("deliver defaults to false", async () => {
      const add_job = vi.fn(async (name: string, schedule: CronSchedule) => make_job({ name }));
      const tool = make_tool({ add_job });
      await tool.execute({ action: "add", every_seconds: 60, message: "test" });
      const deliver = add_job.mock.calls[0][3]; // deliver arg
      expect(deliver).toBe(false);
    });

    it("explicit deliver=true is passed", async () => {
      const add_job = vi.fn(async (name: string, schedule: CronSchedule) => make_job({ name }));
      const tool = make_tool({ add_job });
      await tool.execute({ action: "add", every_seconds: 60, message: "test", deliver: true });
      const deliver = add_job.mock.calls[0][3];
      expect(deliver).toBe(true);
    });
  });

  describe("unsupported action", () => {
    it("returns error", async () => {
      const tool = make_tool();
      const result = await tool.execute({ action: "unknown" });
      expect(result).toContain("Error");
      expect(result).toContain("unsupported");
    });
  });

  describe("tool interface", () => {
    it("has correct metadata", () => {
      const tool = make_tool();
      expect(tool.name).toBe("cron");
      expect(tool.category).toBe("scheduling");
    });
  });
});
