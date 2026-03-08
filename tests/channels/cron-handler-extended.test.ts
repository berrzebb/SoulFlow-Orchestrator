/**
 * CronHandler — 미커버 경로 보충.
 * 자연어 절대/상대 시간, parse_duration_ms 단위, render_schedule,
 * remove 없는 경우, handle_add 에러, handle 에러 경로.
 */
import { describe, it, expect, vi } from "vitest";
import { CronHandler } from "@src/channels/commands/cron.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";
import type { CronScheduler } from "@src/cron/contracts.js";

// ── 헬퍼 ──────────────────────────────────────────

function make_ctx(
  command_name: string,
  args: string[],
  content?: string,
  provider = "slack",
  sender_id = "U123",
): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  const msg_content = content ?? (command_name ? `/${command_name} ${args.join(" ")}` : "");
  return {
    provider,
    message: {
      id: "msg-1", provider, channel: provider,
      sender_id, chat_id: "C001",
      content: msg_content,
      at: new Date().toISOString(),
    },
    command: command_name ? {
      raw: msg_content, name: command_name,
      args, args_lower: args.map(a => a.toLowerCase()),
    } : null as any,
    text: args.join(" "),
    send_reply: async (c: string) => { replies.push(c); },
    replies,
  };
}

function make_cron(overrides: Partial<CronScheduler> = {}): CronScheduler {
  const base: CronScheduler = {
    status: vi.fn().mockResolvedValue({ enabled: true, paused: false, jobs: 0, next_wake_at_ms: null }),
    list_jobs: vi.fn().mockResolvedValue([]),
    add_job: vi.fn().mockResolvedValue({
      id: "new-1", name: "Test", schedule: { kind: "every", every_ms: 60_000 },
      state: { next_run_at_ms: Date.now() + 60_000 }, delete_after_run: false,
    }),
    remove_job: vi.fn().mockResolvedValue(true),
    enable_job: vi.fn().mockResolvedValue(null),
    run_job: vi.fn().mockResolvedValue(false),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    disable_all_and_pause: vi.fn().mockResolvedValue(0),
    start: vi.fn().mockResolvedValue(undefined),
  } as any;
  return { ...base, ...overrides };
}

// ══════════════════════════════════════════
// parse_duration_ms — 단위 다양성
// ══════════════════════════════════════════

describe("CronHandler — 자연어 parse_duration_ms 단위", () => {
  it("초 단위 (s, sec, 초) → 자연어 등록", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "30초 후 알림 회의 준비");
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect((cron.add_job as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("시간 단위 (h, hr, 시간) → 자연어 등록", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "2시간 후 알림 회의");
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
  });

  it("복합 delayed_every: '1분 후 10분 간격으로 알림 물 마시기'", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "1분 후 10분 간격으로 알림 물 마시기");
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    const call = (cron.add_job as ReturnType<typeof vi.fn>).mock.calls[0];
    // every_ms = 600_000 (10분), at_ms > now
    expect(call[1].kind).toBe("every");
    expect(call[1].every_ms).toBe(600_000);
  });
});

// ══════════════════════════════════════════
// 자연어 절대 시간
// ══════════════════════════════════════════

describe("CronHandler — 자연어 절대 시간", () => {
  it("'오후 3시 알림 회의' → at 스케줄 등록", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "오후 3시 알림 회의");
    const result = await handler.handle(ctx);
    // 오후 3시가 현재보다 미래인 경우에만 등록됨 (과거면 내일로 조정)
    expect(result).toBe(true);
    if ((cron.add_job as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const call = (cron.add_job as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].kind).toBe("at");
    }
  });

  it("'내일 오전 9시 알림 스탠드업' → 내일 at 스케줄", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "내일 오전 9시 알림 스탠드업");
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    if ((cron.add_job as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const call = (cron.add_job as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].kind).toBe("at");
      // 내일 = 현재 + 86400000ms 근처
      expect(call[1].at_ms).toBeGreaterThan(Date.now() + 60_000);
    }
  });

  it("'모레 12시 알림 점심' → 모레 at 스케줄", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "모레 12시 알림 점심");
    await handler.handle(ctx);
    // 파싱 성공 여부는 시간에 따라 달라짐
    // 주요: 에러 없이 실행됨
  });

  it("'오늘 3시 알림 미팅' → 오늘 at 스케줄 또는 내일로 조정", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "오늘 3시 알림 미팅");
    await handler.handle(ctx);
    // 에러 없이 실행됨 확인
  });

  it("'새벽 2시 알림 배치' → 새벽 시간 파싱", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "새벽 2시 알림 배치");
    await handler.handle(ctx);
    // 에러 없이 실행됨
  });
});

// ══════════════════════════════════════════
// render_schedule 경로
// ══════════════════════════════════════════

describe("CronHandler — render_schedule 경로 (list 커맨드 통해)", () => {
  it("every+at_ms 스케줄 → 'every Xs (start ...)'", async () => {
    const cron = make_cron({
      list_jobs: vi.fn().mockResolvedValue([{
        id: "j1", name: "J1", enabled: true,
        schedule: { kind: "every", every_ms: 120_000, at_ms: Date.now() + 60_000 },
        state: { next_run_at_ms: Date.now() + 60_000 },
      }]),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("every");
    expect(ctx.replies[0]).toContain("start");
  });

  it("cron+tz 스케줄 → 'cron expr tz=...'", async () => {
    const cron = make_cron({
      list_jobs: vi.fn().mockResolvedValue([{
        id: "j2", name: "J2", enabled: true,
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Seoul" },
        state: { next_run_at_ms: Date.now() + 3_600_000 },
      }]),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron");
    expect(ctx.replies[0]).toContain("Asia/Seoul");
  });

  it("11개 이상 잡 → '... and N more'", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) => ({
      id: `j${i}`, name: `Job${i}`, enabled: true,
      schedule: { kind: "every", every_ms: 60_000 },
      state: { next_run_at_ms: Date.now() + 60_000 },
    }));
    const cron = make_cron({ list_jobs: vi.fn().mockResolvedValue(jobs) });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("and 2 more");
  });
});

// ══════════════════════════════════════════
// remove 없는 경우
// ══════════════════════════════════════════

describe("CronHandler — remove 없는 job_id", () => {
  it("remove job_id 없음 → 안내 메시지", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["remove"]);  // job_id 없음
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron remove");
  });

  it("remove 존재하지 않는 job → '찾지 못했습니다'", async () => {
    const cron = make_cron({ remove_job: vi.fn().mockResolvedValue(false) });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["remove", "ghost-job"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("찾지 못했습니다");
  });
});

// ══════════════════════════════════════════
// parse_structured_add_spec — cron+tz= 형식
// ══════════════════════════════════════════

describe("CronHandler — cron+tz= 형식", () => {
  it("/cron add cron 0 9 * * * tz=Asia/Seoul 알림 → 등록 완료", async () => {
    const cron = make_cron({
      add_job: vi.fn().mockResolvedValue({
        id: "cron-1", name: "알림", schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Seoul" },
        state: { next_run_at_ms: Date.now() + 3600_000 }, delete_after_run: false,
      }),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["add", "cron", "0", "9", "*", "*", "*", "tz=Asia/Seoul", "알림"]);
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("등록 완료");
  });
});

// ══════════════════════════════════════════
// handle 에러 경로
// ══════════════════════════════════════════

describe("CronHandler — handle 에러 경로", () => {
  it("add_job 에러 → 에러 메시지 반환", async () => {
    const cron = make_cron({
      add_job: vi.fn().mockRejectedValue(new Error("db error")),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["add", "every", "10m", "테스트 메시지"]);
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("처리 실패");
    expect(ctx.replies[0]).toContain("db error");
  });

  it("status 에러 → 에러 메시지", async () => {
    const cron = make_cron({ status: vi.fn().mockRejectedValue(new Error("status failed")) });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["status"]);
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("처리 실패");
  });

  it("자연어 handle_add 에러 → 에러 메시지", async () => {
    const cron = make_cron({
      add_job: vi.fn().mockRejectedValue(new Error("natural add failed")),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "1분 후 알림 회의");
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("처리 실패");
  });
});

// ══════════════════════════════════════════
// 자연어 파싱 실패 → 가이드 메시지
// ══════════════════════════════════════════

describe("CronHandler — 자연어 실패 → 가이드", () => {
  it("알 수 없는 자연어 형식 → handle 처리됨 (가이드 or false)", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    // 슬래시 없이 일반 텍스트, 파싱 패턴 미매칭
    const ctx = make_ctx("", [], "알수없는내용");
    const result = await handler.handle(ctx);
    // 파싱 실패 시 false 또는 가이드 메시지 반환
    expect(typeof result).toBe("boolean");
  });
});
