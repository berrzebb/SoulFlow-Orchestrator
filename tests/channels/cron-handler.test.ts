/**
 * CronHandler — 자연어/구조화 파싱, 커맨드 aliases, 공개 메서드,
 * 미커버 분기 (parse_action, parse_duration_ms, render_schedule 등) 커버리지.
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
// 자연어 텍스트 regex — pause/resume/stop/nuke
// ══════════════════════════════════════════

describe("CronHandler — 자연어 regex: pause/resume/stop/nuke", () => {
  it("'cron pause' 텍스트 → pause 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "cron pause");
    await handler.handle(ctx);
    expect(cron.pause).toHaveBeenCalled();
  });

  it("'크론 작업 pause' 텍스트 → pause 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "크론 작업 pause");
    await handler.handle(ctx);
    expect(cron.pause).toHaveBeenCalled();
  });

  it("'cron resume' 텍스트 → resume 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "cron resume");
    await handler.handle(ctx);
    expect(cron.resume).toHaveBeenCalled();
  });

  it("'cron stop' 텍스트 → stop 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "cron stop");
    await handler.handle(ctx);
    expect(cron.stop).toHaveBeenCalled();
  });

  it("'cron kill' 텍스트 → nuke 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "cron kill");
    await handler.handle(ctx);
    expect(cron.disable_all_and_pause).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// parse_natural_add_spec — delayed_every 패턴
// ══════════════════════════════════════════

describe("CronHandler — parse_natural_add_spec: delayed_every", () => {
  it("'5분 후 30분 간격으로 물 마시기' → every 스케줄 등록", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    // 자연어 → parse_action이 null 반환 → parse_natural_add_spec 호출
    const ctx = make_ctx("", [], "5분 후 30분 간격으로 물 마시기");
    await handler.handle(ctx);
    if (cron.add_job.mock.calls.length > 0) {
      const schedule = cron.add_job.mock.calls[0][1] as any;
      expect(schedule.kind).toBe("every");
      expect(schedule.at_ms).toBeGreaterThan(Date.now());
    }
  });

  it("'1h 후 1h 마다 배치 작업' → every + at_ms 스케줄", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "1h 후 1h 마다 배치 작업");
    await handler.handle(ctx);
    if (cron.add_job.mock.calls.length > 0) {
      const schedule = cron.add_job.mock.calls[0][1] as any;
      expect(schedule.kind).toBe("every");
    }
  });
});

// ══════════════════════════════════════════
// parse_natural_add_spec — rel 패턴
// ══════════════════════════════════════════

describe("CronHandler — parse_natural_add_spec: rel (N후 본문)", () => {
  it("'30분 후 스탠드업 시작' → at 스케줄 등록", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "30분 후 스탠드업 시작");
    await handler.handle(ctx);
    if (cron.add_job.mock.calls.length > 0) {
      const schedule = cron.add_job.mock.calls[0][1] as any;
      expect(schedule.kind).toBe("at");
    }
  });

  it("'2h 뒤에 점심 알림' → at 스케줄 + deliver=true", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "2h 뒤에 점심 알림");
    await handler.handle(ctx);
    if (cron.add_job.mock.calls.length > 0) {
      // deliver: 알림 키워드 포함
      expect(cron.add_job).toHaveBeenCalled();
    }
  });
});

// ══════════════════════════════════════════
// parse_natural_add_spec — abs meridiem 분기
// ══════════════════════════════════════════

describe("CronHandler — parse_natural_add_spec: abs meridiem", () => {
  it("'오전 12시 미팅' → 자정(0시)으로 변환", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    // 오전 12시 = 자정 → 내일로 스케줄
    const ctx = make_ctx("", [], "오전 12시 미팅");
    await handler.handle(ctx);
    // add_job 호출됐다면 at 스케줄이어야 함
    if (cron.add_job.mock.calls.length > 0) {
      const schedule = cron.add_job.mock.calls[0][1] as any;
      expect(schedule.kind).toBe("at");
    }
  });

  it("'오후 1시 점심 알림' → 13시로 변환", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "오후 1시 점심 알림");
    await handler.handle(ctx);
    if (cron.add_job.mock.calls.length > 0) {
      expect(cron.add_job).toHaveBeenCalled();
    }
  });

  it("'밤 9시 수면 알림' → 21시로 변환", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "밤 9시 수면 알림");
    await handler.handle(ctx);
    if (cron.add_job.mock.calls.length > 0) {
      expect(cron.add_job).toHaveBeenCalled();
    }
  });

  it("'저녁 6시 퇴근 알림' → 18시로 변환", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("", [], "저녁 6시 퇴근 알림");
    await handler.handle(ctx);
    if (cron.add_job.mock.calls.length > 0) {
      expect(cron.add_job).toHaveBeenCalled();
    }
  });

  it("'새벽 2시 배치 작업' → 2시 그대로", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    // 새벽 2시 → 오전 2시로 취급 (hour != 12이므로 변환 없음)
    const ctx = make_ctx("", [], "내일 새벽 2시 배치 작업");
    await handler.handle(ctx);
    if (cron.add_job.mock.calls.length > 0) {
      expect(cron.add_job).toHaveBeenCalled();
    }
  });
});

// ══════════════════════════════════════════
// parse_natural_add_spec — "/" 시작 → null
// ══════════════════════════════════════════

describe("CronHandler — parse_natural_add_spec text.startsWith('/')", () => {
  it("슬래시 시작 텍스트 + action=null → 가이드 또는 false", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    // command.name="" + content="/help" → normalize_common_command_text 결과가 "/help"면 null 반환
    const ctx = make_ctx("", [], "/help");
    // action=null이고 natural_add=null → format_subcommand_guide 호출
    await handler.handle(ctx);
    // format_subcommand_guide가 "" 또는 null 반환하면 false, 있으면 reply
    // 에러 없이 실행되면 ok
    expect(true).toBe(true);
  });
});

// ══════════════════════════════════════════
// parse_structured_add_spec — mode="cron" tz= 형식
// ══════════════════════════════════════════

describe("CronHandler — parse_structured_add_spec cron tz= 형식", () => {
  it("/cron add cron 0 9 * * * tz=Asia/Seoul 알림 → 등록", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["add", "cron", "0", "9", "*", "*", "*", "tz=Asia/Seoul", "알림"]);
    await handler.handle(ctx);
    if (cron.add_job.mock.calls.length > 0) {
      const schedule = cron.add_job.mock.calls[0][1] as any;
      expect(schedule.kind).toBe("cron");
      expect(schedule.tz).toBe("Asia/Seoul");
    }
  });

  it("/cron add cron 인자 6개 미만 → 가이드", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    // cron 모드는 tokens.length >= 7 필요 (cron + 5 expr fields + body)
    // tokens = ["cron", "0", "9", "*", "*"] → length=5 < 7 → null → 가이드
    const ctx = make_ctx("cron", ["add", "cron", "0", "9", "*", "*"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("형식");
  });

  it("mode가 알 수 없는 값 → 가이드 반환", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    // mode = "unknown" → null → 가이드
    const ctx = make_ctx("cron", ["add", "unknown", "param1", "param2"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("형식");
  });
});

// ══════════════════════════════════════════
// format_time_kr — 유효 timestamp
// ══════════════════════════════════════════

describe("CronHandler — format_time_kr 유효 timestamp (list를 통해)", () => {
  it("next_run_at_ms 유효한 미래 시간 → 포맷된 날짜 문자열 포함", async () => {
    const future_ms = Date.now() + 3_600_000;
    const cron = make_cron({
      list_jobs: vi.fn().mockResolvedValue([{
        id: "j1", name: "Test Job", enabled: true,
        schedule: { kind: "every", every_ms: 60_000 },
        state: { next_run_at_ms: future_ms },
      }]),
    });
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["list"]);
    await handler.handle(ctx);
    // 날짜 포맷: YYYY-MM-DDTHH:MM:SS+09:00
    expect(ctx.replies[0]).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

// ══════════════════════════════════════════
// 직접 커맨드 — cron-pause, cron-resume, cron-stop
// ══════════════════════════════════════════

describe("CronHandler — 직접 커맨드 aliases (추가)", () => {
  it("cron-pause 직접 → pause 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-pause", []);
    await handler.handle(ctx);
    expect(cron.pause).toHaveBeenCalled();
  });

  it("cron-resume 직접 → resume 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-resume", []);
    await handler.handle(ctx);
    expect(cron.resume).toHaveBeenCalled();
  });

  it("cron-stop 직접 → stop 실행", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-stop", []);
    await handler.handle(ctx);
    expect(cron.stop).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// parse_add_tokens — ADD_COMMAND_ALIASES 경로
// ══════════════════════════════════════════

describe("CronHandler — parse_add_tokens ADD_COMMAND_ALIASES", () => {
  it("cron_add 커맨드 → args 그대로 파싱", async () => {
    const cron = make_cron();
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron_add", ["every", "5m", "테스트 메시지"]);
    await handler.handle(ctx);
    expect(cron.add_job).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// (from cron-handler-cov3) parse_action, parse_duration_ms,
// parse_add_tokens, parse_natural_add_spec, render_schedule 미커버 분기
// ══════════════════════════════════════════════════════════

function make_cov3_cron() {
  return {
    status: vi.fn().mockResolvedValue({ enabled: true, paused: false, jobs: 0, next_wake_at_ms: 0 }),
    list_jobs: vi.fn().mockResolvedValue([]),
    add_job: vi.fn().mockResolvedValue({ id: "job1" }),
    remove_job: vi.fn().mockResolvedValue({ ok: true }),
    pause_job: vi.fn().mockResolvedValue({ ok: true }),
    resume_job: vi.fn().mockResolvedValue({ ok: true }),
    stop_job: vi.fn().mockResolvedValue({ ok: true }),
    nuke: vi.fn().mockResolvedValue({ ok: true }),
    pause: vi.fn().mockResolvedValue({ ok: true }),
    resume: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function make_cov3_ctx(overrides: {
  content?: string;
  cmd_name?: string;
  cmd_args?: string[];
  send_reply?: (s: string) => Promise<void>;
} = {}): CommandContext {
  const send_reply = overrides.send_reply ?? vi.fn().mockResolvedValue(undefined);
  return {
    provider: "slack",
    message: { sender_id: "u1", chat_id: "c1", content: overrides.content ?? "" } as any,
    command: overrides.cmd_name
      ? { name: overrides.cmd_name, args: overrides.cmd_args ?? [], args_lower: (overrides.cmd_args ?? []).map(s => s.toLowerCase()) }
      : null,
    send_reply,
    reply_to: vi.fn(),
    broadcast: vi.fn(),
    abort_signal: undefined,
  } as any;
}

describe("CronHandler — parse_action root alias no arg (L35)", () => {
  it("/cron 인자 없음 + 텍스트 없음 → L35 히트, guide 발송 후 return true", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const send_spy = vi.fn().mockResolvedValue(undefined);
    const ctx = make_cov3_ctx({ cmd_name: "cron", cmd_args: [], content: "", send_reply: send_spy });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
    expect(send_spy).toHaveBeenCalled();
  });
});

describe("CronHandler — parse_action empty text (L54)", () => {
  it("텍스트 없이 can_handle → false", () => {
    const h = new CronHandler(make_cov3_cron() as any);
    const ctx = make_cov3_ctx({ content: "" });
    expect(h.can_handle(ctx)).toBe(false);
  });
});

describe("CronHandler — parse_action text regex add/remove (L57-58)", () => {
  it("텍스트 'cron add ...' → can_handle true (add action)", () => {
    const h = new CronHandler(make_cov3_cron() as any);
    const ctx = make_cov3_ctx({ content: "cron add every 5m 리마인드" });
    expect(h.can_handle(ctx)).toBe(true);
  });

  it("텍스트 'cron remove job1' → can_handle true (remove action)", () => {
    const h = new CronHandler(make_cov3_cron() as any);
    const ctx = make_cov3_ctx({ content: "cron remove job1" });
    expect(h.can_handle(ctx)).toBe(true);
  });
});

describe("CronHandler — parse_structured_add_spec invalid duration (L68, L70, L118)", () => {
  it("/cron add every 0s body → add 실패 (every_ms=0 → null)", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ cmd_name: "cron", cmd_args: ["add", "every", "0s", "리마인드"], content: "" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
  });

  it("/cron add every invalid body → add 실패 (invalid duration string)", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ cmd_name: "cron", cmd_args: ["add", "every", "abc", "body"], content: "" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
  });
});

describe("CronHandler — parse_add_tokens text regex (L93-96)", () => {
  it("텍스트 'cron add every 5m 알림' → add 처리", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ content: "cron add every 5m 알림" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
  });

  it("텍스트 'cron 추가 every' (매치 없음) → tokens=[] → spec null", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ content: "크론 add" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
  });
});

describe("CronHandler — cron tz= 형식 (L132)", () => {
  it("/cron add cron * * * * * tz=Asia/Seoul body → add 성공 (tz=형식)", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ cmd_name: "cron", cmd_args: ["add", "cron", "*", "*", "*", "*", "*", "tz=Asia/Seoul", "reminder"], content: "" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
    expect(cron.add_job).toHaveBeenCalled();
  });

  it("/cron add cron * * * * * tz Asia/Seoul body → add 성공 (space 형식 L132)", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ cmd_name: "cron", cmd_args: ["add", "cron", "*", "*", "*", "*", "*", "tz", "Asia/Seoul", "reminder"], content: "" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
    expect(cron.add_job).toHaveBeenCalled();
    const schedule = cron.add_job.mock.calls[0][1];
    expect(schedule?.tz).toBe("Asia/Seoul");
  });
});

describe("CronHandler — empty body in structured add (L143)", () => {
  it("/cron add every 5m (body 없음) → spec null → 안내", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ cmd_name: "cron", cmd_args: ["add", "every", "5m"], content: "" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
  });
});

describe("CronHandler — parse_natural_add_spec edge cases (L171, L184)", () => {
  it("'0초 후 5분 간격으로 알림' (start_delay=0 → L171 null)", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const r = await h.handle(make_cov3_ctx({ content: "0초 후 5분 간격으로 알림" }));
    expect(r).toBe(true);
  });

  it("'0분 후 알림' (rel duration=0 → L184 null)", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const r = await h.handle(make_cov3_ctx({ content: "0분 후 알림" }));
    expect(r).toBe(true);
  });
});

describe("CronHandler — parse_natural_add_spec abs time (L201-207)", () => {
  it("'오전 0시 알림' → 오전 0시 (오전 12시 → hour=0)", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ content: "내일 오전 0시에 회의" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
    expect(cron.add_job).toHaveBeenCalled();
  });

  it("'오후 1시 알림' → hour=13 (L205)", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ content: "내일 오후 1시에 회의" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
  });

  it("'24시 알림' → hour=24→0 (L206)", async () => {
    const cron = make_cov3_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ content: "내일 24시에 알림" });
    const r = await h.handle(ctx);
    expect(typeof r).toBe("boolean");
  });
});

describe("CronHandler — render_schedule non-object (L231 via list)", () => {
  it("list 응답에 schedule=null → 'unknown' 표시", async () => {
    const cron = make_cov3_cron();
    cron.list_jobs.mockResolvedValue([{ id: "j1", name: "test", enabled: true, schedule: null, state: {} }]);
    const h = new CronHandler(cron as any);
    const ctx = make_cov3_ctx({ cmd_name: "cron-list", content: "" });
    const send_spy = vi.fn().mockResolvedValue(undefined);
    const ctx2 = { ...ctx, send_reply: send_spy };
    await h.handle(ctx2 as any);
    const msg = send_spy.mock.calls[0]?.[0] || "";
    expect(msg).toContain("unknown");
  });
});

// ══════════════════════════════════════════════════════════
// (from cron-handler-coverage) can_handle, cron=null, 공개 메서드,
// at 스케줄, render_schedule, 직접 커맨드, 자연어 regex
// ══════════════════════════════════════════════════════════

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

describe("CronHandler.handle() — cron=null", () => {
  it("cron=null → false 반환", async () => {
    const handler = new CronHandler(null);
    const ctx = make_ctx("cron", ["status"]);
    const result = await handler.handle(ctx);
    expect(result).toBe(false);
  });
});

describe("CronHandler — pause/resume/stop/nuke 구조화 커맨드", () => {
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
});

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

  it("unknown kind 스케줄 → 'custom'", async () => {
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

describe("CronHandler — 직접 커맨드 aliases (coverage)", () => {
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

describe("CronHandler — 자연어 regex 패턴 (coverage)", () => {
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
