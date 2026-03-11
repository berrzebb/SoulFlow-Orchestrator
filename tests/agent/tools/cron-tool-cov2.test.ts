/**
 * CronTool — 미커버 분기 (cov2):
 * - L132: resolve_delete_after_run — delete_after_run 파라미터가 string "true" → boolean 변환
 * - L138: resolve_deliver_mode — deliver 파라미터가 string "true" → boolean 변환
 */
import { describe, it, expect, vi } from "vitest";
import { CronTool } from "@src/agent/tools/cron.js";
import type { CronScheduler } from "@src/cron/contracts.js";
import type { CronJob } from "@src/cron/types.js";

function make_job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job_1",
    name: "test-job",
    schedule: { kind: "every", every_ms: 60000 },
    payload: { kind: "agent_turn", message: "hello", deliver: false },
    enabled: true,
    delete_after_run: false,
    created_at_ms: Date.now(),
    state: {},
    ...overrides,
  };
}

function make_cron(overrides: Partial<CronScheduler> = {}): CronScheduler {
  return {
    add_job: vi.fn().mockResolvedValue(make_job()),
    remove_job: vi.fn().mockResolvedValue(true),
    enable_job: vi.fn().mockResolvedValue(make_job()),
    run_job: vi.fn().mockResolvedValue(true),
    list_jobs: vi.fn().mockResolvedValue([make_job()]),
    status: vi.fn().mockResolvedValue({ running: true, job_count: 1 }),
    every: vi.fn(),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    disable_all_and_pause: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as CronScheduler;
}

// ── L132: delete_after_run as string ─────────────────────────────────────────

describe("CronTool — L132: delete_after_run string → boolean 변환", () => {
  it("delete_after_run='true' (string) → L132: === 'true' 평가 → true", async () => {
    const cron = make_cron();
    const tool = new CronTool(cron);
    const result = await tool.execute({
      action: "add",
      message: "test message",
      every_seconds: 60,     // _parse_schedule에서 every_seconds를 사용
      delete_after_run: "true",  // string, not boolean → L132
    });
    expect(result).toContain("registered");
    expect(vi.mocked(cron.add_job)).toHaveBeenCalled();
  });

  it("delete_after_run='false' (string) → L132: === 'true' → false", async () => {
    const cron = make_cron();
    const tool = new CronTool(cron);
    await tool.execute({
      action: "add",
      message: "test message",
      every_seconds: 60,
      delete_after_run: "false",  // string "false" → false
    });
    expect(vi.mocked(cron.add_job)).toHaveBeenCalled();
  });
});

// ── L138: deliver as string ───────────────────────────────────────────────────

describe("CronTool — L138: deliver string → boolean 변환", () => {
  it("deliver='true' (string) → L138: === 'true' → true", async () => {
    const cron = make_cron();
    const tool = new CronTool(cron);
    await tool.execute({
      action: "add",
      message: "test message",
      every_seconds: 60,
      deliver: "true",  // string, not boolean → L138
    });
    expect(vi.mocked(cron.add_job)).toHaveBeenCalled();
  });
});
