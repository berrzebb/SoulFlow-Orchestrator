/**
 * session-memory-promoter.ts — 전체 커버리지:
 * - L35-48: format_promotion 내부 분기 (timestamp 없음, content 잘림)
 * - L61: sessions.list_by_prefix 없음 → 조기 반환
 * - L63-103: promote_sessions_to_daily 전체 흐름
 * - L82: pending < 2 → skipped
 * - L97-99: 내부 에러 → skipped
 */
import { describe, it, expect, vi } from "vitest";
import { promote_sessions_to_daily } from "@src/agent/session-memory-promoter.js";

const noop_logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any;

function make_memory() {
  return {
    append_daily: vi.fn().mockResolvedValue(undefined),
    read_daily: vi.fn().mockResolvedValue(""),
  } as any;
}

// promotion_horizon 기준: now - session_max_age_ms * 0.5
// 기본 session_max_age_ms = 1_800_000 (30분) → horizon = now - 15분
// 15분 전 메시지 타임스탬프가 필요
const NOW = Date.now();
const HORIZON = NOW - 900_000; // 15분 전

function old_ts(ms_ago = 1_800_000) {
  // promotion_horizon 이전 (오래된) 타임스탬프
  return new Date(NOW - ms_ago).toISOString();
}

function recent_ts() {
  // 최근 타임스탬프 (promotion_horizon 이후 — 승격 대상 아님)
  return new Date(NOW - 60_000).toISOString(); // 1분 전
}

// ── list_by_prefix 없을 때 (L61) ────────────────────────────────────────

describe("promote_sessions_to_daily — list_by_prefix 없음 (L61)", () => {
  it("sessions에 list_by_prefix 없음 → { promoted: 0, skipped: 0 }", async () => {
    const sessions = {} as any; // list_by_prefix 없음
    const memory = make_memory();

    const result = await promote_sessions_to_daily(sessions, memory, noop_logger);

    expect(result).toEqual({ promoted: 0, skipped: 0 });
    expect(memory.append_daily).not.toHaveBeenCalled();
  });
});

// ── entries 비었을 때 ─────────────────────────────────────────────────────

describe("promote_sessions_to_daily — 빈 세션 목록", () => {
  it("list_by_prefix 빈 배열 → { promoted: 0, skipped: 0 }", async () => {
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([]),
      get_or_create: vi.fn(),
      save: vi.fn(),
    } as any;

    const result = await promote_sessions_to_daily(sessions, make_memory(), noop_logger);

    expect(result).toEqual({ promoted: 0, skipped: 0 });
  });

  it("list_by_prefix throw → 빈 배열로 처리 (catch 내부)", async () => {
    const sessions = {
      list_by_prefix: vi.fn().mockRejectedValue(new Error("db error")),
      get_or_create: vi.fn(),
      save: vi.fn(),
    } as any;

    const result = await promote_sessions_to_daily(sessions, make_memory(), noop_logger);

    expect(result).toEqual({ promoted: 0, skipped: 0 });
  });
});

// ── pending < 2 → skipped (L82) ──────────────────────────────────────────

describe("promote_sessions_to_daily — pending 메시지 < 2 (L82)", () => {
  it("메시지 1개 → skipped", async () => {
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }]),
      get_or_create: vi.fn().mockResolvedValue({
        key: "prov:ch1:bot",
        last_consolidated: 0,
        messages: [
          { role: "user", content: "안녕", timestamp: old_ts() },
        ],
      }),
      save: vi.fn(),
    } as any;

    const result = await promote_sessions_to_daily(sessions, make_memory(), noop_logger);

    expect(result.skipped).toBe(1);
    expect(result.promoted).toBe(0);
  });

  it("메시지 없음 → skipped", async () => {
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }]),
      get_or_create: vi.fn().mockResolvedValue({
        key: "prov:ch1:bot",
        last_consolidated: 0,
        messages: [],
      }),
      save: vi.fn(),
    } as any;

    const result = await promote_sessions_to_daily(sessions, make_memory(), noop_logger);

    expect(result.skipped).toBe(1);
  });

  it("최근 메시지만 (horizon 이후) → pending 0 → skipped", async () => {
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }]),
      get_or_create: vi.fn().mockResolvedValue({
        key: "prov:ch1:bot",
        last_consolidated: 0,
        messages: [
          { role: "user", content: "최근 메시지", timestamp: recent_ts() },
          { role: "assistant", content: "응답", timestamp: recent_ts() },
        ],
      }),
      save: vi.fn(),
    } as any;

    const result = await promote_sessions_to_daily(sessions, make_memory(), noop_logger);

    expect(result.skipped).toBe(1);
  });
});

// ── 정상 승격 흐름 (L63-103) ─────────────────────────────────────────────

describe("promote_sessions_to_daily — 정상 승격 (L86-96)", () => {
  it("user+assistant 2개 → promoted=1, append_daily 호출", async () => {
    const session = {
      key: "prov:ch1:bot",
      last_consolidated: 0,
      messages: [
        { role: "user", content: "안녕하세요", timestamp: old_ts() },
        { role: "assistant", content: "반갑습니다", timestamp: old_ts(1_700_000) },
      ],
    };
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }]),
      get_or_create: vi.fn().mockResolvedValue(session),
      save: vi.fn().mockResolvedValue(undefined),
    } as any;
    const memory = make_memory();

    const result = await promote_sessions_to_daily(sessions, memory, noop_logger);

    expect(result.promoted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(memory.append_daily).toHaveBeenCalledOnce();
    const call_arg = memory.append_daily.mock.calls[0][0] as string;
    expect(call_arg).toContain("prov:ch1:bot");
  });

  it("format_promotion — content 길이 초과 시 잘림 (L43-44)", async () => {
    const long_content = "A".repeat(500);
    const session = {
      key: "provider:channel:alias",
      last_consolidated: 0,
      messages: [
        { role: "user", content: long_content, timestamp: old_ts() },
        { role: "assistant", content: "OK", timestamp: old_ts(1_700_000) },
      ],
    };
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "provider:channel:alias" }]),
      get_or_create: vi.fn().mockResolvedValue(session),
      save: vi.fn().mockResolvedValue(undefined),
    } as any;
    const memory = make_memory();

    await promote_sessions_to_daily(sessions, memory, noop_logger, { max_content_chars: 100 });

    const call_arg = memory.append_daily.mock.calls[0][0] as string;
    // 잘림 문자 "…" 포함
    expect(call_arg).toContain("…");
  });

  it("format_promotion — timestamp 없는 메시지 → 빈 ts (L42)", async () => {
    const session = {
      key: "prov:ch1:bot",
      last_consolidated: 0,
      messages: [
        { role: "user", content: "타임스탬프 없음" }, // timestamp 없음
        { role: "assistant", content: "응답", timestamp: old_ts() },
      ],
    };
    // timestamp 없는 메시지는 ts=0 → promotion_horizon(0) > 0 이므로 pending에서 제외
    // 따라서 assistant만 1개 → pending < 2 → skipped
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }]),
      get_or_create: vi.fn().mockResolvedValue(session),
      save: vi.fn(),
    } as any;

    const result = await promote_sessions_to_daily(sessions, make_memory(), noop_logger);

    expect(result.skipped).toBe(1);
  });

  it("format_promotion — content 없는 메시지 skip (L40)", async () => {
    const session = {
      key: "prov:ch1:bot",
      last_consolidated: 0,
      messages: [
        { role: "user", content: "", timestamp: old_ts() },            // 빈 content
        { role: "user", content: "질문", timestamp: old_ts() },        // 실제 내용
        { role: "assistant", content: "답변", timestamp: old_ts(1_700_000) },
      ],
    };
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }]),
      get_or_create: vi.fn().mockResolvedValue(session),
      save: vi.fn().mockResolvedValue(undefined),
    } as any;
    const memory = make_memory();

    const result = await promote_sessions_to_daily(sessions, memory, noop_logger);

    expect(result.promoted).toBe(1);
    // 빈 content는 lines에 추가 안됨
    const call_arg = memory.append_daily.mock.calls[0][0] as string;
    expect(call_arg).not.toContain("**User:** \n");
  });

  it("last_ts 없을 때 save 미호출 (L89-93)", async () => {
    const session = {
      key: "prov:ch1:bot",
      last_consolidated: 0,
      messages: [
        { role: "user", content: "메시지", timestamp: old_ts() },
        { role: "assistant", content: "응답" }, // timestamp 없음 → last_ts undefined
      ],
    };
    // assistant에 timestamp 없어도 pending 필터는 timestamp 없으면 ts=0 → last_consolidated(0) 이후 아님
    // 따라서 assistant는 pending에 포함 안됨 → pending < 2 → skipped
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }]),
      get_or_create: vi.fn().mockResolvedValue(session),
      save: vi.fn(),
    } as any;

    const result = await promote_sessions_to_daily(sessions, make_memory(), noop_logger);

    expect(result.skipped).toBe(1);
  });
});

// ── 내부 에러 → skipped (L97-99) ─────────────────────────────────────────

describe("promote_sessions_to_daily — 내부 에러 (L97-99)", () => {
  it("get_or_create throw → skipped", async () => {
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }]),
      get_or_create: vi.fn().mockRejectedValue(new Error("session db error")),
      save: vi.fn(),
    } as any;

    const result = await promote_sessions_to_daily(sessions, make_memory(), noop_logger);

    expect(result.skipped).toBe(1);
    expect(result.promoted).toBe(0);
  });

  it("memory.append_daily throw → skipped", async () => {
    const session = {
      key: "prov:ch1:bot",
      last_consolidated: 0,
      messages: [
        { role: "user", content: "질문", timestamp: old_ts() },
        { role: "assistant", content: "답변", timestamp: old_ts(1_700_000) },
      ],
    };
    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }]),
      get_or_create: vi.fn().mockResolvedValue(session),
      save: vi.fn(),
    } as any;
    const memory = {
      append_daily: vi.fn().mockRejectedValue(new Error("memory error")),
    } as any;

    const result = await promote_sessions_to_daily(sessions, memory, noop_logger);

    expect(result.skipped).toBe(1);
    expect(result.promoted).toBe(0);
  });
});

// ── 복수 세션 혼합 ────────────────────────────────────────────────────────

describe("promote_sessions_to_daily — 복수 세션", () => {
  it("승격 1개 + 스킵 1개", async () => {
    const sessions_data = [
      {
        key: "prov:ch1:bot",
        last_consolidated: 0,
        messages: [
          { role: "user", content: "질문", timestamp: old_ts() },
          { role: "assistant", content: "답변", timestamp: old_ts(1_700_000) },
        ],
      },
      {
        key: "prov:ch2:bot",
        last_consolidated: 0,
        messages: [{ role: "user", content: "하나만", timestamp: old_ts() }],
      },
    ];

    const sessions = {
      list_by_prefix: vi.fn().mockResolvedValue([{ key: "prov:ch1:bot" }, { key: "prov:ch2:bot" }]),
      get_or_create: vi.fn().mockImplementation((key: string) => {
        const s = sessions_data.find((s) => s.key === key);
        return Promise.resolve(s);
      }),
      save: vi.fn().mockResolvedValue(undefined),
    } as any;
    const memory = make_memory();

    const result = await promote_sessions_to_daily(sessions, memory, noop_logger);

    expect(result.promoted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(memory.append_daily).toHaveBeenCalledOnce();
  });
});
