/**
 * MemoryConsolidationService — 미커버 경로 보충.
 * (기본 테스트: memory-consolidation.test.ts 참고)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryConsolidationService } from "@src/agent/memory-consolidation.service.js";
import type { MemoryConsolidationConfig } from "@src/agent/memory-consolidation.service.js";

const noop_logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

function make_config(overrides: Partial<MemoryConsolidationConfig> = {}): MemoryConsolidationConfig {
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

function make_store(days: string[] = [], content_map: Record<string, string> = {}) {
  return {
    list_daily: vi.fn().mockResolvedValue(days),
    read_daily: vi.fn().mockImplementation(async (day: string) => content_map[day] ?? ""),
    append_longterm: vi.fn().mockResolvedValue(undefined),
  };
}

function make_store_with_consolidate(
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

beforeEach(() => { vi.useFakeTimers(); });

// ══════════════════════════════════════════
// health_check
// ══════════════════════════════════════════

describe("MemoryConsolidationService — health_check", () => {
  it("시작 전 ok: false", () => {
    const svc = new MemoryConsolidationService({ memory_store: make_store() as any, config: make_config(), logger: noop_logger });
    expect(svc.health_check().ok).toBe(false);
    expect(svc.health_check().details?.busy_count).toBe(0);
    expect(svc.health_check().details?.consolidating).toBe(false);
  });

  it("start 후 ok: true", async () => {
    const svc = new MemoryConsolidationService({ memory_store: make_store() as any, config: make_config(), logger: noop_logger });
    await svc.start();
    expect(svc.health_check().ok).toBe(true);
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// run_consolidation — running=false 가드
// ══════════════════════════════════════════

describe("MemoryConsolidationService — run_consolidation running=false", () => {
  it("start() 안 했을 때 → ok: false (not running)", async () => {
    const svc = new MemoryConsolidationService({ memory_store: make_store() as any, config: make_config(), logger: noop_logger });
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("not running");
  });
});

// ══════════════════════════════════════════
// touch() 조건별 처리
// ══════════════════════════════════════════

describe("MemoryConsolidationService — touch() 조건", () => {
  it("enabled=false → touch() 무시됨", async () => {
    const store = make_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store as any,
      config: make_config({ enabled: false }),
      logger: noop_logger,
    });
    await svc.start();
    svc.touch();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.list_daily).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("trigger=cron → touch() idle timer 시작 안 함", async () => {
    const store = make_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store as any,
      config: make_config({ trigger: "cron" }),
      logger: noop_logger,
    });
    await svc.start();
    svc.touch();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.list_daily).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("busy_count > 0 → touch() idle timer 시작 안 함", async () => {
    const store = make_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store as any,
      config: make_config({ idle_after_ms: 100 }),
      logger: noop_logger,
    });
    await svc.start();
    svc.touch_start();
    svc.touch();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.list_daily).not.toHaveBeenCalled();
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// store.consolidate() 있을 때
// ══════════════════════════════════════════

describe("MemoryConsolidationService — store.consolidate() 구현체", () => {
  it("store.consolidate() 호출됨", async () => {
    const store = make_store_with_consolidate();
    const svc = new MemoryConsolidationService({ memory_store: store as any, config: make_config(), logger: noop_logger });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store.consolidate).toHaveBeenCalledOnce();
    await svc.stop();
  });

  it("options가 store.consolidate()에 전달됨", async () => {
    const store = make_store_with_consolidate();
    const svc = new MemoryConsolidationService({ memory_store: store as any, config: make_config(), logger: noop_logger });
    await svc.start();
    await svc.run_consolidation({ memory_window: 14, archive: true, session: "s1" });
    expect(store.consolidate).toHaveBeenCalledWith(
      expect.objectContaining({ memory_window: 14, archive: true, session: "s1" }),
    );
    await svc.stop();
  });

  it("store.consolidate() 예외 → ok: false, error in summary", async () => {
    const store = {
      ...make_store(),
      consolidate: vi.fn().mockRejectedValue(new Error("DB connection failed")),
    };
    const svc = new MemoryConsolidationService({ memory_store: store as any, config: make_config(), logger: noop_logger });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("DB connection failed");
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// store_consolidate fallback 추가 케이스
// ══════════════════════════════════════════

describe("MemoryConsolidationService — store_consolidate fallback", () => {
  it("window 밖 오래된 entries → 스킵", async () => {
    const store = make_store(["2000-01-01"], { "2000-01-01": "very old content" });
    const svc = new MemoryConsolidationService({ memory_store: store as any, config: make_config({ window_days: 7 }), logger: noop_logger });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store.append_longterm).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("잘못된 날짜 형식 → 무시", async () => {
    const store = make_store(["not-a-date"], { "not-a-date": "content" });
    const svc = new MemoryConsolidationService({ memory_store: store as any, config: make_config(), logger: noop_logger });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store.append_longterm).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("content 공백만 → 스킵", async () => {
    const day_str = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const store = make_store([day_str], { [day_str]: "   " });
    const svc = new MemoryConsolidationService({ memory_store: store as any, config: make_config(), logger: noop_logger });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store.append_longterm).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("window 내 유효 content → append_longterm 호출 + summary 포함", async () => {
    const day_str = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const store = make_store([day_str], { [day_str]: "valid memory content" });
    const svc = new MemoryConsolidationService({ memory_store: store as any, config: make_config({ window_days: 7 }), logger: noop_logger });
    await svc.start();
    const r = await svc.run_consolidation();
    expect(r.ok).toBe(true);
    expect(store.append_longterm).toHaveBeenCalledOnce();
    expect(r.summary).toContain("consolidated 1");
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// stop — 타이머 정리
// ══════════════════════════════════════════

describe("MemoryConsolidationService — stop 정리", () => {
  it("idle_timer 정리: stop 후 timer 발동 안 함", async () => {
    const store = make_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store as any,
      config: make_config({ idle_after_ms: 5000 }),
      logger: noop_logger,
    });
    await svc.start();
    svc.touch();
    await svc.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.list_daily).not.toHaveBeenCalled();
  });

  it("cron_timer 정리: stop 후 interval 발동 안 함", async () => {
    const store = make_store([]);
    const svc = new MemoryConsolidationService({
      memory_store: store as any,
      config: make_config({ trigger: "cron", interval_ms: 1000 }),
      logger: noop_logger,
    });
    await svc.start();
    await svc.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.list_daily).not.toHaveBeenCalled();
  });
});
