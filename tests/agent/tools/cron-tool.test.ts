/**
 * CronTool — CronScheduler mock 기반 커버리지.
 * add/list/remove/enable/disable/run/status 액션 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { CronTool } from "../../../src/agent/tools/cron.js";
import type { CronScheduler } from "../../../src/cron/contracts.js";
import type { CronJob, CronServiceStatus } from "../../../src/cron/types.js";

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
    status: vi.fn().mockResolvedValue({ running: true, job_count: 1 } as unknown as CronServiceStatus),
    every: vi.fn(),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    disable_all_and_pause: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function make_tool(cron = make_cron()) {
  return new CronTool(cron);
}

describe("CronTool — status", () => {
  it("status → cron.status() 호출 → JSON 반환", async () => {
    const cron = make_cron();
    const r = JSON.parse(await make_tool(cron).execute({ action: "status" }));
    expect(r.running).toBe(true);
    expect(vi.mocked(cron.status)).toHaveBeenCalled();
  });
});

describe("CronTool — list", () => {
  it("list → cron.list_jobs() 호출 → 배열 반환", async () => {
    const cron = make_cron();
    const r = JSON.parse(await make_tool(cron).execute({ action: "list" }));
    expect(Array.isArray(r)).toBe(true);
    expect(r[0].id).toBe("job_1");
  });

  it("include_disabled=true → list_jobs(true) 호출", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "list", include_disabled: true });
    expect(vi.mocked(cron.list_jobs)).toHaveBeenCalledWith(true);
  });
});

describe("CronTool — remove", () => {
  it("remove 성공 → removed:job_1", async () => {
    const cron = make_cron();
    const r = await make_tool(cron).execute({ action: "remove", job_id: "job_1" });
    expect(r).toContain("removed:job_1");
  });

  it("remove 실패(not found) → not_found:...", async () => {
    const cron = make_cron({ remove_job: vi.fn().mockResolvedValue(false) });
    const r = await make_tool(cron).execute({ action: "remove", job_id: "no_such" });
    expect(r).toContain("not_found:no_such");
  });

  it("remove: job_id 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "remove" });
    expect(r).toContain("Error");
    expect(r).toContain("job_id");
  });
});

describe("CronTool — enable/disable", () => {
  it("enable → cron.enable_job(id, true) → JSON", async () => {
    const cron = make_cron();
    const r = JSON.parse(await make_tool(cron).execute({ action: "enable", job_id: "job_1" }));
    expect(r.id).toBe("job_1");
    expect(vi.mocked(cron.enable_job)).toHaveBeenCalledWith("job_1", true);
  });

  it("disable → cron.enable_job(id, false) → JSON", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "disable", job_id: "job_1" });
    expect(vi.mocked(cron.enable_job)).toHaveBeenCalledWith("job_1", false);
  });

  it("enable: job_id 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "enable" });
    expect(r).toContain("Error");
    expect(r).toContain("job_id");
  });

  it("enable: job not found → not_found:...", async () => {
    const cron = make_cron({ enable_job: vi.fn().mockResolvedValue(null) });
    const r = await make_tool(cron).execute({ action: "enable", job_id: "ghost" });
    expect(r).toContain("not_found:ghost");
  });
});

describe("CronTool — run", () => {
  it("run → cron.run_job(id, force) → run:...", async () => {
    const cron = make_cron();
    const r = await make_tool(cron).execute({ action: "run", job_id: "job_1", force: true });
    expect(r).toContain("run:job_1");
    expect(vi.mocked(cron.run_job)).toHaveBeenCalledWith("job_1", true);
  });

  it("run 실패 → cannot_run:...", async () => {
    const cron = make_cron({ run_job: vi.fn().mockResolvedValue(false) });
    const r = await make_tool(cron).execute({ action: "run", job_id: "job_1" });
    expect(r).toContain("cannot_run:job_1");
  });

  it("run: job_id 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "run" });
    expect(r).toContain("Error");
  });
});

describe("CronTool — add (every_seconds)", () => {
  it("add every_seconds → 등록 성공", async () => {
    const cron = make_cron();
    const r = await make_tool(cron).execute({ action: "add", message: "hello", every_seconds: 60 });
    expect(r).toContain("registered");
    expect(r).toContain("job_id=job_1");
  });

  it("add: message 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "add", every_seconds: 60 });
    expect(r).toContain("Error");
    expect(r).toContain("message");
  });

  it("add: schedule 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "add", message: "hello" });
    expect(r).toContain("Error");
    expect(r).toContain("one of every_seconds");
  });
});

describe("CronTool — add (cron_expr)", () => {
  it("add cron_expr → 등록 성공", async () => {
    const cron = make_cron();
    const r = await make_tool(cron).execute({ action: "add", message: "hello", cron_expr: "0 * * * *" });
    expect(r).toContain("registered");
  });

  it("add cron_expr + tz → tz 포함", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "add", message: "hello", cron_expr: "0 * * * *", tz: "Asia/Seoul" });
    const call = vi.mocked(cron.add_job).mock.calls[0]!;
    expect(call[1]).toMatchObject({ kind: "cron", tz: "Asia/Seoul" });
  });
});

describe("CronTool — add (at)", () => {
  it("add at (ISO datetime) → 등록 성공", async () => {
    const cron = make_cron();
    const r = await make_tool(cron).execute({ action: "add", message: "hello", at: "2099-01-01T00:00:00Z" });
    expect(r).toContain("registered");
  });

  it("add at 잘못된 날짜 → Error: invalid_at_datetime", async () => {
    const r = await make_tool().execute({ action: "add", message: "hello", at: "not-a-date" });
    expect(r).toContain("Error");
    expect(r).toContain("invalid_at_datetime");
  });
});

describe("CronTool — add (deliver, channel, to, delete_after_run)", () => {
  it("deliver=true → add_job에 true 전달", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "add", message: "hello", every_seconds: 60, deliver: true });
    const call = vi.mocked(cron.add_job).mock.calls[0]!;
    expect(call[3]).toBe(true);
  });

  it("deliver='false' (string) → false", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "add", message: "hello", every_seconds: 60, deliver: "false" });
    const call = vi.mocked(cron.add_job).mock.calls[0]!;
    expect(call[3]).toBe(false);
  });

  it("channel 명시 → add_job에 전달", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "add", message: "hello", every_seconds: 60, channel: "slack-ch" });
    const call = vi.mocked(cron.add_job).mock.calls[0]!;
    expect(call[4]).toBe("slack-ch");
  });

  it("to 명시 → add_job에 전달", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "add", message: "hello", every_seconds: 60, to: "user-123" });
    const call = vi.mocked(cron.add_job).mock.calls[0]!;
    expect(call[5]).toBe("user-123");
  });

  it("delete_after_run=true (boolean) → add_job에 true 전달", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "add", message: "hello", every_seconds: 60, delete_after_run: true });
    const call = vi.mocked(cron.add_job).mock.calls[0]!;
    expect(call[6]).toBe(true);
  });

  it("delete_after_run='true' (string) → true", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "add", message: "hello", every_seconds: 60, delete_after_run: "true" });
    const call = vi.mocked(cron.add_job).mock.calls[0]!;
    expect(call[6]).toBe(true);
  });

  it("at schedule + delete_after_run 미지정 → 기본값 true (kind=at)", async () => {
    const cron = make_cron();
    await make_tool(cron).execute({ action: "add", message: "hello", at: "2099-01-01T00:00:00Z" });
    const call = vi.mocked(cron.add_job).mock.calls[0]!;
    expect(call[6]).toBe(true);
  });
});

describe("CronTool — 미지원 action", () => {
  it("unknown action → Error", async () => {
    const r = await make_tool().execute({ action: "bogus" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});

describe("CronTool — parse_iso_date_ms (L7/L8)", () => {
  it("유효한 ISO 날짜 → 숫자 반환 (L7/L8 경로)", async () => {
    // parse_iso_date_ms는 at 필드 처리 시 호출됨
    const cron = make_cron();
    const r = await make_tool(cron).execute({ action: "add", message: "test", at: "2099-06-15T12:00:00Z" });
    expect(r).toContain("registered");
  });
});
