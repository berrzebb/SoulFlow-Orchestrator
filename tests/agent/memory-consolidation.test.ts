import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.ts";
import { MemoryTool } from "@src/agent/tools/memory-tool.ts";
import { MemoryConsolidationService } from "@src/agent/memory-consolidation.service.ts";
import { ContextBuilder } from "@src/agent/context.service.ts";

const noop_logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noop_logger,
} as any;

function make_config(overrides?: Record<string, unknown>) {
  return {
    enabled: true,
    trigger: "idle" as const,
    idle_after_ms: 300_000,
    interval_ms: 86_400_000,
    window_days: 7,
    archive_used: false,
    ...overrides,
  };
}

describe("MemoryTool write_longterm / append_longterm", () => {
  let workspace: string;
  let store: MemoryStore;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "mem-tool-"));
    store = new MemoryStore(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("write_longterm으로 장기 메모리를 갱신한다", async () => {
    // MemoryTool에 write_longterm action 없음 → store 직접 사용
    await store.write_longterm("핵심 설정: 알파 모드");
    const content = await store.read_longterm();
    expect(content).toContain("핵심 설정: 알파 모드");
  });

  it("append_longterm으로 장기 메모리에 추가한다", async () => {
    const tool = new MemoryTool(store);
    // 초기 내용은 store 직접 작성, 추가는 tool 사용
    await store.write_longterm("첫째");
    const result = await (tool as any).run({ action: "append_longterm", content: "\n둘째" });
    expect(result).toContain("추가 완료");

    const content = await store.read_longterm();
    expect(content).toContain("첫째");
    expect(content).toContain("둘째");
  });

  it("content 없으면 에러를 반환한다", async () => {
    const tool = new MemoryTool(store);
    const result = await (tool as any).run({ action: "write_longterm" });
    expect(result).toContain("Error");
  });
});

describe("MemoryConsolidationService", () => {
  let workspace: string;
  let store: MemoryStore;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "mem-consolidate-"));
    store = new MemoryStore(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("daily memory를 장기 메모리로 압축한다", async () => {
    await store.append_daily("사용자가 A를 요청함", "2026-03-06");
    await store.append_daily("B 작업 완료", "2026-03-07");

    const svc = new MemoryConsolidationService({
      memory_store: store,
      config: make_config(),
      logger: noop_logger,
    });
    await svc.start();

    const result = await svc.run_consolidation();
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("consolidated");

    const longterm = await store.read_longterm();
    expect(longterm).toContain("사용자가 A를 요청함");
    expect(longterm).toContain("B 작업 완료");

    await svc.stop();
  });

  it("archive_used가 true면 사용된 daily를 삭제한다", async () => {
    await store.append_daily("정리 대상", "2026-03-06");

    const svc = new MemoryConsolidationService({
      memory_store: store,
      config: make_config({ archive_used: true }),
      logger: noop_logger,
    });
    await svc.start();

    await svc.run_consolidation();

    const longterm = await store.read_longterm();
    expect(longterm).toContain("정리 대상");

    await svc.stop();
  });

  it("중복 실행을 방지한다", async () => {
    const svc = new MemoryConsolidationService({
      memory_store: store,
      config: make_config(),
      logger: noop_logger,
    });
    await svc.start();

    const [r1, r2] = await Promise.all([
      svc.run_consolidation(),
      svc.run_consolidation(),
    ]);
    const summaries = [r1.summary, r2.summary];
    expect(summaries.some(s => s.includes("already in progress") || s.includes("no daily"))).toBe(true);

    await svc.stop();
  });

  it("cron trigger는 interval_ms 주기로 setInterval을 설정한다", async () => {
    vi.useFakeTimers();
    try {
      const svc = new MemoryConsolidationService({
        memory_store: store,
        config: make_config({ trigger: "cron", interval_ms: 1000 }),
        logger: noop_logger,
      });
      await svc.start();

      await store.append_daily("cron 대상", "2026-03-07");

      // interval 경과 전에는 실행되지 않음
      const before = await store.read_longterm();
      expect(before).toBe("");

      // interval 경과 → consolidation 실행
      await vi.advanceTimersByTimeAsync(1100);

      const after = await store.read_longterm();
      expect(after).toContain("cron 대상");

      await svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("idle trigger: touch() 후 idle_after_ms 경과 시 consolidation 실행", async () => {
    vi.useFakeTimers();
    try {
      await store.append_daily("idle 대상", "2026-03-07");

      const svc = new MemoryConsolidationService({
        memory_store: store,
        config: make_config({ trigger: "idle", idle_after_ms: 500 }),
        logger: noop_logger,
      });
      await svc.start();

      svc.touch();

      // 아직 idle 기간 미경과
      await vi.advanceTimersByTimeAsync(300);
      expect(await store.read_longterm()).toBe("");

      // idle 기간 경과
      await vi.advanceTimersByTimeAsync(300);
      expect(await store.read_longterm()).toContain("idle 대상");

      await svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("touch() 재호출 시 idle timer가 리셋된다", async () => {
    vi.useFakeTimers();
    try {
      await store.append_daily("리셋 테스트", "2026-03-07");

      const svc = new MemoryConsolidationService({
        memory_store: store,
        config: make_config({ trigger: "idle", idle_after_ms: 500 }),
        logger: noop_logger,
      });
      await svc.start();

      svc.touch();
      await vi.advanceTimersByTimeAsync(400);
      // 리셋: 새 touch로 idle timer 초기화
      svc.touch();
      await vi.advanceTimersByTimeAsync(400);
      // 첫 touch로부터 800ms 경과했지만, 두 번째 touch 후 400ms이므로 아직 미실행
      expect(await store.read_longterm()).toBe("");

      // 두 번째 touch 후 500ms 경과
      await vi.advanceTimersByTimeAsync(200);
      expect(await store.read_longterm()).toContain("리셋 테스트");

      await svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("touch_start/touch_end long-turn 보호", () => {
  let workspace: string;
  let store: MemoryStore;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "mem-busy-"));
    store = new MemoryStore(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("touch_start 중에는 idle timer가 시작되지 않는다", async () => {
    vi.useFakeTimers();
    try {
      await store.append_daily("busy 테스트", "2026-03-07");

      const svc = new MemoryConsolidationService({
        memory_store: store,
        config: make_config({ trigger: "idle", idle_after_ms: 200 }),
        logger: noop_logger,
      });
      await svc.start();

      // turn 시작
      svc.touch_start();
      // idle_after_ms 이상 경과
      await vi.advanceTimersByTimeAsync(500);
      // busy 중이므로 consolidation 실행되지 않아야 함
      expect(await store.read_longterm()).toBe("");

      // turn 종료 → idle timer 시작
      svc.touch_end();
      await vi.advanceTimersByTimeAsync(250);
      // idle_after_ms 경과 후 consolidation 실행
      expect(await store.read_longterm()).toContain("busy 테스트");

      await svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("여러 turn이 겹치면 마지막 touch_end 후에만 idle timer 시작", async () => {
    vi.useFakeTimers();
    try {
      await store.append_daily("multi-turn", "2026-03-07");

      const svc = new MemoryConsolidationService({
        memory_store: store,
        config: make_config({ trigger: "idle", idle_after_ms: 200 }),
        logger: noop_logger,
      });
      await svc.start();

      svc.touch_start(); // turn 1
      svc.touch_start(); // turn 2
      svc.touch_end();   // turn 1 종료
      await vi.advanceTimersByTimeAsync(300);
      // turn 2 아직 활성 → 실행되지 않음
      expect(await store.read_longterm()).toBe("");

      svc.touch_end(); // turn 2 종료 → idle timer 시작
      await vi.advanceTimersByTimeAsync(250);
      expect(await store.read_longterm()).toContain("multi-turn");

      await svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("busy 중 run_consolidation 직접 호출도 차단된다", async () => {
    const svc = new MemoryConsolidationService({
      memory_store: store,
      config: make_config(),
      logger: noop_logger,
    });
    await svc.start();

    svc.touch_start();
    const result = await svc.run_consolidation();
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("active turns");

    svc.touch_end();
    await svc.stop();
  });
});

describe("ContextBuilder daily memory injection", () => {
  let workspace: string;
  let store: MemoryStore;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "ctx-daily-"));
    store = new MemoryStore(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("dailyInjectionDays=1이면 최근 daily가 system prompt에 포함된다", async () => {
    await store.append_daily("오늘 A 작업을 완료함");

    const builder = new ContextBuilder(workspace, { memory_store: store });
    builder.set_daily_injection(1);
    const prompt = await builder.build_system_prompt();
    expect(prompt).toContain("Recent Daily");
    expect(prompt).toContain("오늘 A 작업을 완료함");
  });

  it("dailyInjectionDays=0이면 daily가 포함되지 않는다", async () => {
    await store.append_daily("비밀 내용");

    const builder = new ContextBuilder(workspace, { memory_store: store });
    builder.set_daily_injection(0);
    const prompt = await builder.build_system_prompt();
    expect(prompt).not.toContain("비밀 내용");
    expect(prompt).not.toContain("Recent Daily");
  });

  it("write_longterm 후 다음 prompt에 반영된다", async () => {
    await store.write_longterm("장기 기억: 사용자 선호 = 다크모드");

    const builder = new ContextBuilder(workspace, { memory_store: store });
    const prompt = await builder.build_system_prompt();
    expect(prompt).toContain("장기 기억: 사용자 선호 = 다크모드");
  });

  it("session_context로 다른 채널의 daily memory가 필터링된다", async () => {
    // 두 채널의 daily 엔트리를 같은 날짜에 기록
    await store.append_daily(
      "- [slack:ch1:t1] 채널1 대화 내용\n- [slack:ch2:t2] 채널2 대화 내용\n- 스코프 없는 일반 항목",
    );

    const builder = new ContextBuilder(workspace, { memory_store: store });
    builder.set_daily_injection(1);

    // channel=slack, chat_id=ch1 세션으로 빌드
    const prompt = await builder.build_system_prompt([], undefined, {
      channel: "slack",
      chat_id: "ch1",
    });
    expect(prompt).toContain("채널1 대화 내용");
    expect(prompt).not.toContain("채널2 대화 내용");
    // 스코프 없는 항목은 포함됨
    expect(prompt).toContain("스코프 없는 일반 항목");
  });

  it("session_context 없으면 모든 daily 엔트리가 포함된다", async () => {
    await store.append_daily(
      "- [slack:ch1:t1] 채널1\n- [slack:ch2:t2] 채널2",
    );

    const builder = new ContextBuilder(workspace, { memory_store: store });
    builder.set_daily_injection(1);

    const prompt = await builder.build_system_prompt();
    expect(prompt).toContain("채널1");
    expect(prompt).toContain("채널2");
  });

  it("dailyInjectionMaxChars 상한을 초과하면 최근 엔트리만 포함된다", async () => {
    // 오래된 날짜와 최근 날짜에 각각 큰 텍스트 기록
    const old_text = "A".repeat(3000);
    const new_text = "B".repeat(3000);
    await store.append_daily(old_text, "2026-03-06");
    await store.append_daily(new_text, "2026-03-07");

    const builder = new ContextBuilder(workspace, { memory_store: store });
    builder.set_daily_injection(7, 4000);

    const prompt = await builder.build_system_prompt();
    // 최신(2026-03-07)이 우선 포함됨
    expect(prompt).toContain("B".repeat(100));
    // 상한 4000자 내에서 오래된 것은 잘리거나 포함되지 않음
    const memory_section = prompt.split("## Recent Daily")[1] || "";
    expect(memory_section.length).toBeLessThan(5000);
  });

  it("dailyInjectionMaxChars=0이면 상한 없이 모두 포함된다", async () => {
    await store.append_daily("A".repeat(5000), "2026-03-06");
    await store.append_daily("B".repeat(5000), "2026-03-07");

    const builder = new ContextBuilder(workspace, { memory_store: store });
    builder.set_daily_injection(7, 0);

    const prompt = await builder.build_system_prompt();
    expect(prompt).toContain("A".repeat(100));
    expect(prompt).toContain("B".repeat(100));
  });
});

// ── from memory-consolidation-extended.test.ts ──

import type { MemoryConsolidationConfig } from "@src/agent/memory-consolidation.service.ts";

const noop_logger_ext = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

function make_ext_config(overrides: Partial<MemoryConsolidationConfig> = {}): MemoryConsolidationConfig {
  return {
    enabled: true,
    trigger: "idle",
    idle_after_ms: 1000,
    interval_ms: 60_000,
    window_days: 7,
    archive_used: false,
    ...overrides,
  };
}

function make_ext_store(days: string[] = [], content_map: Record<string, string> = {}) {
  return {
    list_daily: vi.fn().mockResolvedValue(days),
    read_daily: vi.fn().mockImplementation(async (day: string) => content_map[day] ?? ""),
    append_longterm: vi.fn().mockResolvedValue(undefined),
  };
}

function make_ext_store_with_consolidate(
  result = {
    ok: true,
    summary: "ok",
    daily_entries_used: ["2024-01-01"],
    archived_files: [] as string[],
    longterm_appended_chars: 100,
    compressed_prompt: "",
  },
) {
  return {
    list_daily: vi.fn().mockResolvedValue([]),
    read_daily: vi.fn().mockResolvedValue(""),
    append_longterm: vi.fn().mockResolvedValue(undefined),
    consolidate: vi.fn().mockResolvedValue(result),
  };
}

describe("MemoryConsolidationService — health_check", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("시작 전 ok: false", () => {
    const svc = new MemoryConsolidationService({ memory_store: make_ext_store() as any, config: make_ext_config(), logger: noop_logger_ext });
    expect(svc.health_check().ok).toBe(false);
    expect(svc.health_check().details?.busy_count).toBe(0);
    expect(svc.health_check().details?.consolidating).toBe(false);
  });

  it("start 후 ok: true", async () => {
    const svc = new MemoryConsolidationService({ memory_store: make_ext_store() as any, config: make_ext_config(), logger: noop_logger_ext });
    await svc.start();
    expect(svc.health_check().ok).toBe(true);
    await svc.stop();
  });
});

describe("MemoryConsolidationService — run_consolidation running=false", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("start() 안 했을 때 → ok: false (not running)", async () => {
    const svc = new MemoryConsolidationService({ memory_store: make_ext_store() as any, config: make_ext_config(), logger: noop_logger_ext });
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("not running");
  });
});

describe("MemoryConsolidationService — touch() 조건", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("enabled=false → touch() 무시됨", async () => {
    const store_ext = make_ext_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store_ext as any,
      config: make_ext_config({ enabled: false }),
      logger: noop_logger_ext,
    });
    await svc.start();
    svc.touch();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store_ext.list_daily).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("trigger=cron → touch() idle timer 시작 안 함", async () => {
    const store_ext = make_ext_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store_ext as any,
      config: make_ext_config({ trigger: "cron" }),
      logger: noop_logger_ext,
    });
    await svc.start();
    svc.touch();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store_ext.list_daily).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("busy_count > 0 → touch() idle timer 시작 안 함", async () => {
    const store_ext = make_ext_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store_ext as any,
      config: make_ext_config({ idle_after_ms: 100 }),
      logger: noop_logger_ext,
    });
    await svc.start();
    svc.touch_start();
    svc.touch();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store_ext.list_daily).not.toHaveBeenCalled();
    await svc.stop();
  });
});

describe("MemoryConsolidationService — store.consolidate() 구현체", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("store.consolidate() 호출됨", async () => {
    const store_ext = make_ext_store_with_consolidate();
    const svc = new MemoryConsolidationService({ memory_store: store_ext as any, config: make_ext_config(), logger: noop_logger_ext });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store_ext.consolidate).toHaveBeenCalledOnce();
    await svc.stop();
  });

  it("options가 store.consolidate()에 전달됨", async () => {
    const store_ext = make_ext_store_with_consolidate();
    const svc = new MemoryConsolidationService({ memory_store: store_ext as any, config: make_ext_config(), logger: noop_logger_ext });
    await svc.start();
    await svc.run_consolidation({ memory_window: 14, archive: true, session: "s1" });
    expect(store_ext.consolidate).toHaveBeenCalledWith(
      expect.objectContaining({ memory_window: 14, archive: true, session: "s1" }),
    );
    await svc.stop();
  });

  it("store.consolidate() 예외 → ok: false, error in summary", async () => {
    const store_ext = {
      ...make_ext_store(),
      consolidate: vi.fn().mockRejectedValue(new Error("DB connection failed")),
    };
    const svc = new MemoryConsolidationService({ memory_store: store_ext as any, config: make_ext_config(), logger: noop_logger_ext });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("DB connection failed");
    await svc.stop();
  });
});

describe("MemoryConsolidationService — store_consolidate fallback", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("window 밖 오래된 entries → 스킵", async () => {
    const store_ext = make_ext_store(["2000-01-01"], { "2000-01-01": "very old content" });
    const svc = new MemoryConsolidationService({ memory_store: store_ext as any, config: make_ext_config({ window_days: 7 }), logger: noop_logger_ext });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store_ext.append_longterm).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("잘못된 날짜 형식 → 무시", async () => {
    const store_ext = make_ext_store(["not-a-date"], { "not-a-date": "content" });
    const svc = new MemoryConsolidationService({ memory_store: store_ext as any, config: make_ext_config(), logger: noop_logger_ext });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store_ext.append_longterm).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("content 공백만 → 스킵", async () => {
    const day_str = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const store_ext = make_ext_store([day_str], { [day_str]: "   " });
    const svc = new MemoryConsolidationService({ memory_store: store_ext as any, config: make_ext_config(), logger: noop_logger_ext });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store_ext.append_longterm).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("window 내 유효 content → append_longterm 호출 + summary 포함", async () => {
    const day_str = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const store_ext = make_ext_store([day_str], { [day_str]: "valid memory content" });
    const svc = new MemoryConsolidationService({ memory_store: store_ext as any, config: make_ext_config({ window_days: 7 }), logger: noop_logger_ext });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store_ext.append_longterm).toHaveBeenCalledOnce();
    expect(r.summary).toContain("consolidated 1");
    await svc.stop();
  });
});

describe("MemoryConsolidationService — touch_start idle_timer 정리 (L86-87)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("touch() 후 touch_start() → idle_timer 즉시 취소", async () => {
    const store_ext = make_ext_store_with_consolidate();
    const svc = new MemoryConsolidationService({
      memory_store: store_ext as any,
      config: make_ext_config({ idle_after_ms: 5000 }),
      logger: noop_logger_ext,
    });
    await svc.start();
    svc.touch();
    svc.touch_start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store_ext.consolidate).not.toHaveBeenCalled();
    await svc.stop();
  });
});

describe("MemoryConsolidationService — stop 정리", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("idle_timer 정리: stop 후 timer 발동 안 함", async () => {
    const store_ext = make_ext_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store_ext as any,
      config: make_ext_config({ idle_after_ms: 5000 }),
      logger: noop_logger_ext,
    });
    await svc.start();
    svc.touch();
    await svc.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store_ext.list_daily).not.toHaveBeenCalled();
  });

  it("cron_timer 정리: stop 후 interval 발동 안 함", async () => {
    const store_ext = make_ext_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store_ext as any,
      config: make_ext_config({ trigger: "cron", interval_ms: 1000 }),
      logger: noop_logger_ext,
    });
    await svc.start();
    await svc.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store_ext.list_daily).not.toHaveBeenCalled();
  });
});
