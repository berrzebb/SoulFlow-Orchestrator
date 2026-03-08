/**
 * CronHandler + StatsHandler 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { CronHandler } from "@src/channels/commands/cron.handler.js";
import { StatsHandler, type StatsAccess } from "@src/channels/commands/stats.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";
import type { CronScheduler } from "@src/cron/contracts.js";

// ── 헬퍼: CommandContext 생성 ──

function make_ctx(
  command_name: string,
  args: string[],
  content?: string,
  provider = "slack",
  sender_id = "U123",
): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  const msg_content = content ?? `/${command_name} ${args.join(" ")}`;
  return {
    provider,
    message: {
      id: "msg-1",
      provider,
      channel: provider,
      sender_id,
      chat_id: "C001",
      content: msg_content,
      at: new Date().toISOString(),
    },
    command: {
      raw: msg_content,
      name: command_name,
      args,
      args_lower: args.map((a) => a.toLowerCase()),
    },
    text: args.join(" "),
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

// ── Mock CronScheduler ──

function make_cron(): CronScheduler {
  return {
    status: vi.fn().mockResolvedValue({ enabled: true, paused: false, jobs: 3, next_wake_at_ms: Date.now() + 60_000 }),
    list_jobs: vi.fn().mockResolvedValue([
      { id: "job-1", name: "Test Job", enabled: true, schedule: { kind: "every", every_ms: 60_000 }, state: { next_run_at_ms: Date.now() + 30_000 } },
      { id: "job-2", name: "At Job", enabled: false, schedule: { kind: "at", at_ms: Date.now() + 3600_000 }, state: {} },
    ]),
    add_job: vi.fn().mockResolvedValue({
      id: "new-job-1",
      name: "New Job",
      schedule: { kind: "every", every_ms: 60_000 },
      state: { next_run_at_ms: Date.now() + 60_000 },
      delete_after_run: false,
    }),
    remove_job: vi.fn().mockResolvedValue(true),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    disable_all_and_pause: vi.fn().mockResolvedValue(5),
  } as unknown as CronScheduler;
}

// ══════════════════════════════════════════
// CronHandler
// ══════════════════════════════════════════

describe("CronHandler — can_handle", () => {
  it("cron 스케줄러 없음 → false", () => {
    const handler = new CronHandler(null);
    const ctx = make_ctx("cron", ["status"]);
    expect(handler.can_handle(ctx)).toBe(false);
  });

  it("cron 커맨드 → true", () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["status"]);
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("cron-status 커맨드 → true", () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron-status", []);
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("cron-list 커맨드 → true", () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron-list", []);
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("알 수 없는 커맨드 → false", () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("unknown", []);
    expect(handler.can_handle(ctx)).toBe(false);
  });
});

describe("CronHandler — handle: 스케줄러 없음", () => {
  it("cron 없음 → false 반환", async () => {
    const handler = new CronHandler(null);
    const ctx = make_ctx("cron", ["status"]);
    const result = await handler.handle(ctx);
    expect(result).toBe(false);
  });
});

describe("CronHandler — handle: status", () => {
  it("/cron status → 상태 메시지 반환", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["status"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron 상태");
    expect(ctx.replies[0]).toContain("enabled");
    expect(ctx.replies[0]).toContain("jobs");
  });

  it("/cron-status 별칭", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron-status", []);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron 상태");
  });
});

describe("CronHandler — handle: list", () => {
  it("/cron list → 작업 목록 반환", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["list"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron 작업 목록");
    expect(ctx.replies[0]).toContain("job-1");
  });

  it("/cron-list → 작업 없음 메시지", async () => {
    const cron = make_cron();
    (cron.list_jobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron-list", []);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
  });
});

describe("CronHandler — handle: add (structured)", () => {
  it("/cron add every 10m 메모 → 등록 완료", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["add", "every", "10m", "테스트 메모"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron 등록 완료");
  });

  it("/cron-add at spec → 등록 완료", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron-add", ["at", future, "알림 메시지"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron 등록 완료");
  });

  it("add spec 부족 → 안내 메시지", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["add"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("cron add 형식");
  });
});

describe("CronHandler — handle: remove", () => {
  it("/cron remove job-1 → 삭제 완료", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["remove", "job-1"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("삭제 완료");
  });

  it("/cron-remove → job_id 없음 안내", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron-remove", []);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("remove 형식");
  });

  it("삭제 실패 (미존재 job) → 찾지 못함 메시지", async () => {
    const cron = make_cron();
    (cron.remove_job as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["remove", "ghost-job"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("찾지 못했습니다");
  });
});

describe("CronHandler — handle: pause/resume/stop/nuke", () => {
  it("/cron pause → 일시 정지 메시지", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["pause"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("일시 정지");
  });

  it("/cron resume → 재개 메시지", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["resume"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("재개");
  });

  it("/cron stop → 완전 중지 메시지", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["stop"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("중지");
  });

  it("/cron nuke → 전체 비활성화 메시지", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("cron", ["nuke"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("전체 cron 작업 비활성화");
  });
});

describe("CronHandler — handle: 자연어 입력", () => {
  it("'10분 후 알림 회의' → 자연어 추가 처리", async () => {
    const handler = new CronHandler(make_cron());
    // 자연어: 슬래시 없는 직접 텍스트
    const ctx = make_ctx("", [], "10분 후 알림 회의");
    (ctx.command as { name: string }).name = "";
    await handler.handle(ctx);
    // 등록 완료 또는 안내 메시지
    expect(ctx.replies.length).toBeGreaterThan(0);
  });
});

describe("CronHandler — handle: 에러 케이스", () => {
  it("add_job 예외 → 에러 메시지 반환", async () => {
    const cron = make_cron();
    (cron.add_job as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB 오류"));
    const handler = new CronHandler(cron);
    const ctx = make_ctx("cron", ["add", "every", "5m", "테스트"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("처리 실패");
    expect(ctx.replies[0]).toContain("DB 오류");
  });
});

// ══════════════════════════════════════════
// StatsHandler
// ══════════════════════════════════════════

function make_stats_access(overrides: Partial<StatsAccess> = {}): StatsAccess {
  return {
    get_cd_score: vi.fn().mockReturnValue({
      total: 35,
      events: [
        { indicator: "clarify", points: 10, context: "질문이 모호했습니다", at: new Date().toISOString() },
        { indicator: "correct", points: 25, context: "실수를 정정했습니다", at: new Date().toISOString() },
      ],
    }),
    reset_cd: vi.fn(),
    get_active_task_count: vi.fn().mockReturnValue(2),
    get_active_loop_count: vi.fn().mockReturnValue(1),
    get_provider_health: vi.fn().mockReturnValue([
      { provider: "claude", score: 0.9, success_count: 10, failure_count: 1, avg_latency_ms: 250 },
      { provider: "gpt4", score: 0.4, success_count: 5, failure_count: 8, avg_latency_ms: 500 },
    ]),
    ...overrides,
  };
}

describe("StatsHandler — can_handle", () => {
  it("stats 커맨드 → true", () => {
    const handler = new StatsHandler(make_stats_access());
    const ctx = make_ctx("stats", []);
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("통계 별칭 → true", () => {
    const handler = new StatsHandler(make_stats_access());
    const ctx = make_ctx("통계", []);
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("cd 별칭 → true", () => {
    const handler = new StatsHandler(make_stats_access());
    const ctx = make_ctx("cd", []);
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("unknown → false", () => {
    const handler = new StatsHandler(make_stats_access());
    const ctx = make_ctx("unknown", []);
    expect(handler.can_handle(ctx)).toBe(false);
  });
});

describe("StatsHandler — handle: 개요", () => {
  // 인식되지 않는 action(예: "show") → format_overview() 실행
  // 빈 args는 format_subcommand_guide("stats")가 있으면 가이드 반환

  it("알 수 없는 action → 개요 반환", async () => {
    const handler = new StatsHandler(make_stats_access());
    const ctx = make_ctx("stats", ["show"]); // 인식 못 하는 action → overview
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("CD 점수");
    expect(ctx.replies[0]).toContain("활성 태스크");
    expect(ctx.replies[0]).toContain("활성 루프");
  });

  it("개요: CD 점수 건강 상태 표시 (주의 범위)", async () => {
    const handler = new StatsHandler(make_stats_access());
    const ctx = make_ctx("stats", ["show"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("주의"); // 35점 → 주의
  });

  it("개요: CD 점수 건강 상태 (건강 범위)", async () => {
    const access = make_stats_access({
      get_cd_score: vi.fn().mockReturnValue({ total: 10, events: [] }),
    });
    const handler = new StatsHandler(access);
    const ctx = make_ctx("stats", ["show"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("건강");
  });

  it("개요: 프로바이더 건강 포함", async () => {
    const handler = new StatsHandler(make_stats_access());
    const ctx = make_ctx("stats", ["show"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("프로바이더 건강");
    expect(ctx.replies[0]).toContain("claude");
  });

  it("개요: get_provider_health 없음 → 프로바이더 섹션 없음", async () => {
    const access = make_stats_access({ get_provider_health: undefined });
    const handler = new StatsHandler(access);
    const ctx = make_ctx("stats", ["show"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).not.toContain("프로바이더 건강");
  });

  it("CD 점수 경고 범위 (> 50점)", async () => {
    const access = make_stats_access({
      get_cd_score: vi.fn().mockReturnValue({ total: 60, events: [] }),
    });
    const handler = new StatsHandler(access);
    const ctx = make_ctx("stats", ["show"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("경고");
  });
});

describe("StatsHandler — handle: cd 상세", () => {
  it("/stats cd → CD 이벤트 상세 반환", async () => {
    const handler = new StatsHandler(make_stats_access());
    const ctx = make_ctx("stats", ["cd"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("CD 이벤트");
    expect(ctx.replies[0]).toContain("clarify");
    expect(ctx.replies[0]).toContain("correct");
  });

  it("/stats 상세 (한글 alias)", async () => {
    const handler = new StatsHandler(make_stats_access());
    const ctx = make_ctx("stats", ["상세"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("CD 이벤트");
  });

  it("CD 이벤트 없음 → '이벤트 없음' 메시지", async () => {
    const access = make_stats_access({
      get_cd_score: vi.fn().mockReturnValue({ total: 0, events: [] }),
    });
    const handler = new StatsHandler(access);
    const ctx = make_ctx("stats", ["cd"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("이벤트가 없습니다");
  });
});

describe("StatsHandler — handle: reset", () => {
  it("/stats reset → CD 초기화 + 메시지", async () => {
    const access = make_stats_access();
    const handler = new StatsHandler(access);
    const ctx = make_ctx("stats", ["reset"]);
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("초기화");
    expect(access.reset_cd).toHaveBeenCalled();
  });

  it("/stats 초기화 (한글 alias)", async () => {
    const access = make_stats_access();
    const handler = new StatsHandler(access);
    const ctx = make_ctx("stats", ["초기화"]);
    await handler.handle(ctx);
    expect(access.reset_cd).toHaveBeenCalled();
  });
});
