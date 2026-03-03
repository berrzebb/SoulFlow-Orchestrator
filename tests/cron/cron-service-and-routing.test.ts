import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { CommandContext, CommandHandler } from "@src/channels/commands/types.ts";
import { CronService } from "@src/cron/service.ts";
import { create_harness, inbound } from "@helpers/harness.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("cron service and routing", () => {
  it("executes overdue one-shot immediately on start and removes it", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cron-service-test-"));
    const store_root = join(workspace, "runtime", "cron");
    let executed = 0;
    const cron = new CronService(store_root, async () => {
      executed += 1;
      return "ok";
    }, {
      default_tick_ms: 20,
    });
    try {
      await cron.add_job(
        "overdue-once",
        { kind: "at", at_ms: Date.now() - 5_000 },
        "run once",
        false,
        "telegram",
        "chat-1",
        true,
      );
      await cron.start();
      await sleep(120);
      expect(executed).toBe(1);
      const rows = await cron.list_jobs(true);
      expect(rows.length).toBe(0);
    } finally {
      await cron.stop();
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

class FakeCronHandler implements CommandHandler {
  readonly name = "cron";
  readonly add_calls: Array<{ schedule: Record<string, unknown>; message: string }> = [];

  can_handle(ctx: CommandContext): boolean {
    const text = ctx.text.toLowerCase();
    return text.includes("알림") || text.includes("간격") || text.includes("/cron");
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const text = ctx.text;
    const delayed_every = text.match(/(\d+)\s*(분|시간)\s*(?:후|뒤)?\s+(\d+)\s*(분|시간)\s*간격(?:으로)?\s+(.+)/);
    if (delayed_every) {
      const delay_amount = Number(delayed_every[1]);
      const delay_unit = delayed_every[2] === "분" ? 60_000 : 3_600_000;
      const every_amount = Number(delayed_every[3]);
      const every_unit = delayed_every[4] === "분" ? 60_000 : 3_600_000;
      const schedule = {
        kind: "every",
        at_ms: Date.now() + delay_amount * delay_unit,
        every_ms: every_amount * every_unit,
      };
      this.add_calls.push({ schedule, message: delayed_every[5]!.trim() });
      await ctx.send_reply(`cron 등록 완료\n- schedule: ${JSON.stringify(schedule)}`);
      return true;
    }

    const rel_match = text.match(/(\d+)\s*(분|시간)\s*(?:후|뒤)?\s+알림\s+(.+)/);
    if (rel_match) {
      const amount = Number(rel_match[1]);
      const unit = rel_match[2] === "분" ? 60_000 : 3_600_000;
      const schedule = { kind: "at", at_ms: Date.now() + amount * unit };
      this.add_calls.push({ schedule, message: rel_match[3]!.trim() });
      await ctx.send_reply(`cron 등록 완료\n- schedule: ${JSON.stringify(schedule)}`);
      return true;
    }

    return false;
  }
}

describe("cron command routing", () => {
  it("cron add intent with mention is handled by command router without orchestration", async () => {
    let orchestration_calls = 0;
    const cron_handler = new FakeCronHandler();
    const harness = await create_harness({
      command_handlers: [cron_handler],
      orchestration_handler: async () => {
        orchestration_calls += 1;
        return { reply: "agent-called", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("@assistant 1분 후 알림 물 마시기"));
      expect(cron_handler.add_calls.length).toBe(1);
      expect(orchestration_calls).toBe(0);
      expect(harness.registry.sent.length).toBeGreaterThan(0);
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(String(last.content || "")).toMatch(/cron 등록 완료/i);
    } finally {
      await harness.cleanup();
    }
  });

  it("supports compact korean forms (N분후/N시간후)", async () => {
    const cron_handler = new FakeCronHandler();
    let orchestration_calls = 0;
    const harness = await create_harness({
      command_handlers: [cron_handler],
      orchestration_handler: async () => {
        orchestration_calls += 1;
        return { reply: "agent-called", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      const start = Date.now();
      await harness.manager.handle_inbound_message(inbound("@assistant 1분후 알림 물 마시기"));
      await harness.manager.handle_inbound_message(inbound("@assistant 2시간후 알림 회의 준비"));
      expect(cron_handler.add_calls.length).toBe(2);
      expect(orchestration_calls).toBe(0);

      const first = cron_handler.add_calls[0]?.schedule || {};
      const second = cron_handler.add_calls[1]?.schedule || {};
      expect(String(first.kind || "")).toBe("at");
      expect(String(second.kind || "")).toBe("at");
      const first_delta = Number(first.at_ms || 0) - start;
      const second_delta = Number(second.at_ms || 0) - start;
      expect(first_delta).toBeGreaterThanOrEqual(50_000);
      expect(first_delta).toBeLessThanOrEqual(120_000);
      expect(second_delta).toBeGreaterThanOrEqual(7_000_000);
      expect(second_delta).toBeLessThanOrEqual(7_500_000);
    } finally {
      await harness.cleanup();
    }
  });

  it("supports delayed interval form (N후 M간격으로)", async () => {
    const cron_handler = new FakeCronHandler();
    let orchestration_calls = 0;
    const harness = await create_harness({
      command_handlers: [cron_handler],
      orchestration_handler: async () => {
        orchestration_calls += 1;
        return { reply: "agent-called", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      const start = Date.now();
      await harness.manager.handle_inbound_message(inbound("@assistant 1분후 30분간격으로 시스템 상태 점검 실행"));
      expect(cron_handler.add_calls.length).toBe(1);
      expect(orchestration_calls).toBe(0);
      const schedule = cron_handler.add_calls[0]?.schedule || {};
      expect(String(schedule.kind || "")).toBe("every");
      expect(Number(schedule.every_ms || 0)).toBe(1_800_000);
      const first_run_delta = Number(schedule.at_ms || 0) - start;
      expect(first_run_delta).toBeGreaterThanOrEqual(50_000);
      expect(first_run_delta).toBeLessThanOrEqual(120_000);
    } finally {
      await harness.cleanup();
    }
  });
});
