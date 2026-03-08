/**
 * CronHandler — 미커버 분기 추가.
 * pause/resume/stop/nuke, add 가이드, spec 파싱(at/cron tz 없음),
 * render_schedule(cron 무tz/unknown), can_handle, format_time_kr n/a.
 */
import { describe, it, expect, vi } from "vitest";
import { CronHandler } from "@src/channels/commands/cron.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";
import type { CronScheduler } from "@src/cron/contracts.js";

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
      args, args_lower: args.map((a) => a.toLowerCase()),
    } : null as any,
    text: args.join(" "),
    send_reply: async (c: string) => { replies.push(c); },
    replies,
  };
}

function make_cron(overrides: Partial<CronScheduler> = {}): CronScheduler {
  const base: CronScheduler = {
    status: vi.fn().mockResolvedValue({ enabled: true, paused: false, jobs: 2, next_wake_at_ms: Date.now() + 60_000 }),
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
    disable_all_and_pause: vi.fn().mockResolvedValue(3),
    start: vi.fn().mockResolvedValue(undefined),
  } as any;
  return { ...base, ...overrides };
}

// ══════════════════════════════════════════
// can_handle 분기
// ══════════════════════════════════════════

describe("CronHandler.can_handle()", () => {
  it("cron=null → false", () => {
    const handler = new CronHandler(null);
    const ctx = make_ctx("cron", ["status"]);
    expect(handler.can_handle(ctx)).toBe(false);
  });

  it("ROOT_ALIASES 명령 → true", () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["status"]);
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("자연어 content가 action 패턴 매칭 → true", () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("", [], "cron status");
    expect(handler.can_handle(ctx)).toBe(true);
  });
});

// ══════════════════════════════════════════
// handle — cron=null
// ══════════════════════════════════════════

describe("CronHandler.handle() — cron=null", () => {
  it("cron=null → false 반환", async () => {
    const handler = new CronHandler(null);
    const ctx = make_ctx("cron", ["status"]);
    const result = await handler.handle(ctx);
    expect(result).toBe(false);
  });
});

// ══════════════════════════════════════════
// pause / resume / stop / nuke 액션
// ══════════════════════════════════════════

describe("CronHandler — pause/resume/stop/nuke", () => {
  it("pause → '일시 정지' 메시지", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["pause"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("일시 정지");
    expect(cron.pause).toHaveBeenCalled();
  });

  it("resume → '재개' 메시지 + status 조회", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["resume"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("재개");
    expect(cron.resume).toHaveBeenCalled();
    expect(cron.status).toHaveBeenCalled();
  });

  it("stop → '완전 중지' 메시지", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["stop"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("중지");
    expect(cron.stop).toHaveBeenCalled();
  });

  it("nuke → '전체 비활성화' 메시지 + disable_all_and_pause 호출", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["nuke"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("비활성화");
    expect(cron.disable_all_and_pause).toHaveBeenCalled();
  });

  it("직접 커맨드 cron-pause → pause 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-pause", []);
    await handler.handle(ctx);
    expect(cron.pause).toHaveBeenCalled();
  });

  it("직접 커맨드 cron-resume → resume 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-resume", []);
    await handler.handle(ctx);
    expect(cron.resume).toHaveBeenCalled();
  });

  it("직접 커맨드 cron-stop → stop 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-stop", []);
    await handler.handle(ctx);
    expect(cron.stop).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// add 가이드 — parse_structured_add_spec 실패
// ══════════════════════════════════════════

describe("CronHandler — add 가이드 메시지", () => {
  it("add 인자 부족 → 형식 가이드 반환", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["add", "invalid_only"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron add 형식");
  });

  it("/cron add at 잘못된날짜 본문 → 형식 가이드", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["add", "at", "notadate", "body"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron add");
  });

  it("/cron add cron 인자 부족(5개 미만) → 가이드", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["add", "cron", "0", "9"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron add");
  });
});

// ══════════════════════════════════════════
// parse_structured_add_spec — at 스케줄
// ══════════════════════════════════════════

describe("CronHandler — parse_structured_add_spec at 스케줄", () => {
  it("/cron add at 2030-01-01T00:00:00Z 메시지 → at 스케줄 등록", async () => {
    const cron = make_cron({
      add_job: vi.fn().mockResolvedValue({
        id: "at-1", name: "메시지", schedule: { kind: "at", at_ms: 1893456000000 },
        state: { next_run_at_ms: 1893456000000 }, delete_after_run: true,
      }),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["add", "at", "2030-01-01T00:00:00Z", "메시지 알림"]);
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(cron.add_job).toHaveBeenCalled();
    const call = (cron.add_job as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].kind).toBe("at");
  });
});

// ══════════════════════════════════════════
// render_schedule — cron without tz, unknown kind
// ══════════════════════════════════════════

describe("CronHandler — render_schedule 경로 (list를 통해)", () => {
  it("cron 스케줄 tz 없음 → 'cron expr' 형식", async () => {
    const cron = make_cron({
      list_jobs: vi.fn().mockResolvedValue([{
        id: "j1", name: "J1", enabled: true,
        schedule: { kind: "cron", expr: "0 9 * * *", tz: null },
        state: { next_run_at_ms: Date.now() + 3_600_000 },
      }]),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("0 9 * * *");
    expect(ctx.replies[0]).not.toContain("tz=");
  });

  it("unknown kind 스케줄 → 'unknown'", async () => {
    const cron = make_cron({
      list_jobs: vi.fn().mockResolvedValue([{
        id: "j2", name: "J2", enabled: true,
        schedule: { kind: "custom", data: "xyz" },
        state: { next_run_at_ms: 0 },
      }]),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("custom");
  });

  it("at 스케줄 → 'at YYYY...'", async () => {
    const cron = make_cron({
      list_jobs: vi.fn().mockResolvedValue([{
        id: "j3", name: "J3", enabled: false,
        schedule: { kind: "at", at_ms: Date.now() + 3_600_000 },
        state: { next_run_at_ms: 0 },
      }]),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("at ");
  });
});

// ══════════════════════════════════════════
// 직접 커맨드 aliases
// ══════════════════════════════════════════

describe("CronHandler — 직접 커맨드 aliases", () => {
  it("cron-status → status 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-status", []);
    await handler.handle(ctx);
    expect(cron.status).toHaveBeenCalled();
  });

  it("cron-list → list 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-list", []);
    await handler.handle(ctx);
    expect(cron.list_jobs).toHaveBeenCalled();
  });

  it("cron-add every 5m 테스트 → 등록", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-add", ["every", "5m", "테스트"]);
    await handler.handle(ctx);
    expect(cron.add_job).toHaveBeenCalled();
  });

  it("cron-remove job-123 → 삭제", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-remove", ["job-123"]);
    await handler.handle(ctx);
    expect(cron.remove_job).toHaveBeenCalledWith("job-123");
  });
});

// ══════════════════════════════════════════
// 자연어 — regex 패턴 직접 매칭
// ══════════════════════════════════════════

describe("CronHandler — 자연어 regex 패턴", () => {
  it("'cron status' 텍스트 → status 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "cron status");
    await handler.handle(ctx);
    expect(cron.status).toHaveBeenCalled();
  });

  it("'cron list' 텍스트 → list 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "cron list");
    await handler.handle(ctx);
    expect(cron.list_jobs).toHaveBeenCalled();
  });

  it("'cron nuke' 텍스트 → nuke 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "cron nuke");
    await handler.handle(ctx);
    expect(cron.disable_all_and_pause).toHaveBeenCalled();
  });
});
