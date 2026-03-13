/**
 * CronService — team_id 필터링 테스트.
 * Step 2: CronJob.team_id + list_jobs(include_disabled, team_id) 필터링.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { CronService } from "@src/cron/service.js";

describe("CronService team_id filtering", () => {
  let dir: string;
  let svc: CronService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cron-team-"));
    svc = new CronService(dir, null);
  });

  afterEach(async () => {
    await svc.stop();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("add_job에 team_id 전달 → list_jobs(true, team_id) 필터링", async () => {
    await svc.add_job("job-a", { kind: "every", every_ms: 60000 }, "msg-a", false, null, null, false, { team_id: "team-1" } as any);
    await svc.add_job("job-b", { kind: "every", every_ms: 60000 }, "msg-b", false, null, null, false, { team_id: "team-2" } as any);

    const all = await svc.list_jobs(true);
    expect(all).toHaveLength(2);

    const team1 = await svc.list_jobs(true, "team-1");
    expect(team1).toHaveLength(1);
    expect(team1[0].name).toBe("job-a");

    const team2 = await svc.list_jobs(true, "team-2");
    expect(team2).toHaveLength(1);
    expect(team2[0].name).toBe("job-b");
  });

  it("team_id 미지정 시 전체 반환", async () => {
    await svc.add_job("job-x", { kind: "every", every_ms: 60000 }, "msg", false, null, null, false, { team_id: "t1" } as any);
    await svc.add_job("job-y", { kind: "every", every_ms: 60000 }, "msg", false);

    const all = await svc.list_jobs(true);
    expect(all).toHaveLength(2);
  });
});
