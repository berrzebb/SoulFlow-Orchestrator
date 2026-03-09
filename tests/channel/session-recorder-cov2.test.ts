/**
 * SessionRecorder — 미커버 분기 커버리지.
 * - record_assistant 예외 catch → logger.debug
 * - get_history: sessions=null, ts 없음, catch block
 * - get_last_assistant_content: sessions=null, 없으면 null, catch block
 * - emit_mirror: on_mirror 예외 격리
 * - get_history: max_age_ms > 0 필터링
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionRecorder } from "@src/channels/session-recorder.js";

function make_recorder(overrides: Partial<{
  sessions: any;
  daily_memory: any;
  on_mirror_message: any;
}> = {}) {
  return new SessionRecorder({
    sessions: overrides.sessions ?? null,
    daily_memory: overrides.daily_memory ?? null,
    sanitize_for_storage: (s) => s,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    on_mirror_message: overrides.on_mirror_message,
  });
}

function make_message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1", provider: "slack", channel: "slack",
    chat_id: "C123", sender_id: "user1",
    content: "hello", at: new Date().toISOString(), thread_id: undefined,
    ...overrides,
  } as any;
}

function make_sessions(messages: any[] = []) {
  return {
    get_or_create: vi.fn().mockResolvedValue({ messages }),
    append_message: vi.fn().mockResolvedValue(undefined),
  } as any;
}

beforeEach(() => vi.clearAllMocks());

// ══════════════════════════════════════════════════════════
// record_assistant 예외 catch
// ══════════════════════════════════════════════════════════

describe("SessionRecorder — record_assistant 예외 catch", () => {
  it("sessions.append_message throw → logger.debug 호출, 예외 전파 없음", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const sessions = {
      get_or_create: vi.fn().mockResolvedValue({ messages: [] }),
      append_message: vi.fn().mockRejectedValue(new Error("DB error")),
    };
    const recorder = new SessionRecorder({
      sessions, daily_memory: null,
      sanitize_for_storage: (s) => s,
      logger,
    });
    await expect(
      recorder.record_assistant("slack", make_message(), "assistant", "response")
    ).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith("record_assistant failed", expect.objectContaining({ error: expect.any(String) }));
  });

  it("sessions=null → 즉시 반환", async () => {
    const recorder = make_recorder({ sessions: null });
    await expect(
      recorder.record_assistant("slack", make_message(), "assistant", "content")
    ).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// get_history
// ══════════════════════════════════════════════════════════

describe("SessionRecorder — get_history", () => {
  it("sessions=null → [] 반환", async () => {
    const recorder = make_recorder({ sessions: null });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 0);
    expect(h).toEqual([]);
  });

  it("메시지 없음 → [] 반환", async () => {
    const recorder = make_recorder({ sessions: make_sessions([]) });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 0);
    expect(h).toEqual([]);
  });

  it("메시지 있음 → role/content 추출", async () => {
    const recorder = make_recorder({
      sessions: make_sessions([
        { role: "user", content: "hello", timestamp: new Date().toISOString() },
        { role: "assistant", content: "hi", timestamp: new Date().toISOString() },
      ]),
    });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 0);
    expect(h).toHaveLength(2);
    expect(h[0].role).toBe("user");
  });

  it("max_age_ms 필터: 오래된 메시지 제외", async () => {
    const old_ts = new Date(Date.now() - 1_000_000).toISOString();
    const new_ts = new Date().toISOString();
    const recorder = make_recorder({
      sessions: make_sessions([
        { role: "user", content: "old msg", timestamp: old_ts },
        { role: "user", content: "new msg", timestamp: new_ts },
      ]),
    });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 60_000);
    expect(h).toHaveLength(1);
    expect(h[0].content).toBe("new msg");
  });

  it("timestamp 없는 메시지 → max_age_ms>0 → 포함 (return true)", async () => {
    const recorder = make_recorder({
      sessions: make_sessions([
        { role: "user", content: "no-ts msg" }, // timestamp 없음
      ]),
    });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 60_000);
    expect(h).toHaveLength(1);
  });

  it("sessions.get_or_create throw → catch → [] 반환", async () => {
    const sessions = {
      get_or_create: vi.fn().mockRejectedValue(new Error("DB error")),
      append_message: vi.fn(),
    };
    const recorder = make_recorder({ sessions });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 0);
    expect(h).toEqual([]);
  });

  it("content 없는 메시지 → filter 제거", async () => {
    const recorder = make_recorder({
      sessions: make_sessions([
        { role: "user", content: "", timestamp: new Date().toISOString() },
        { role: "user", content: "valid", timestamp: new Date().toISOString() },
      ]),
    });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 0);
    expect(h).toHaveLength(1);
    expect(h[0].content).toBe("valid");
  });
});

// ══════════════════════════════════════════════════════════
// get_last_assistant_content
// ══════════════════════════════════════════════════════════

describe("SessionRecorder — get_last_assistant_content", () => {
  it("sessions=null → null 반환", async () => {
    const recorder = make_recorder({ sessions: null });
    const c = await recorder.get_last_assistant_content("slack", "C1", "assistant");
    expect(c).toBeNull();
  });

  it("assistant 메시지 없음 → null 반환", async () => {
    const recorder = make_recorder({
      sessions: make_sessions([
        { role: "user", content: "hello" },
      ]),
    });
    const c = await recorder.get_last_assistant_content("slack", "C1", "assistant");
    expect(c).toBeNull();
  });

  it("마지막 assistant 메시지 content 반환", async () => {
    const recorder = make_recorder({
      sessions: make_sessions([
        { role: "user", content: "hello" },
        { role: "assistant", content: "first reply" },
        { role: "user", content: "more" },
        { role: "assistant", content: "last reply" },
      ]),
    });
    const c = await recorder.get_last_assistant_content("slack", "C1", "assistant");
    expect(c).toBe("last reply");
  });

  it("get_or_create throw → catch → null 반환", async () => {
    const sessions = {
      get_or_create: vi.fn().mockRejectedValue(new Error("fail")),
      append_message: vi.fn(),
    };
    const recorder = make_recorder({ sessions });
    const c = await recorder.get_last_assistant_content("slack", "C1", "assistant");
    expect(c).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// emit_mirror — on_mirror 예외 격리
// ══════════════════════════════════════════════════════════

describe("SessionRecorder — emit_mirror 예외 격리", () => {
  it("on_mirror_message throw → 예외 전파 없음", async () => {
    const on_mirror = vi.fn().mockImplementation(() => { throw new Error("mirror fail"); });
    const sessions = make_sessions([]);
    const recorder = make_recorder({ sessions, on_mirror_message: on_mirror });
    // record_user → emit_mirror → on_mirror throw → 격리됨
    await expect(
      recorder.record_user("slack", make_message(), "assistant")
    ).resolves.toBeUndefined();
    expect(on_mirror).toHaveBeenCalled();
  });

  it("on_mirror_message=null → emit_mirror no-op", async () => {
    const sessions = make_sessions([]);
    const recorder = make_recorder({ sessions, on_mirror_message: undefined });
    await expect(
      recorder.record_user("slack", make_message(), "assistant")
    ).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// L167: append_daily_memory throw → catch → logger.warn (L167)
// ══════════════════════════════════════════════════════════

describe("SessionRecorder — append_daily_memory throw → logger.warn (L167)", () => {
  it("daily_memory.append_daily_memory throw → logger.warn 호출 (L167)", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const daily_memory = {
      append_daily_memory: vi.fn().mockRejectedValue(new Error("disk full")),
    };
    const sessions = make_sessions([]);
    const recorder = new SessionRecorder({
      sessions, daily_memory,
      sanitize_for_storage: (s) => s,
      logger,
    });
    // record_user → append_daily → append_daily_memory throw → catch → logger.warn
    await expect(
      recorder.record_user("slack", make_message({ content: "hello" }), "assistant")
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith("daily memory write failed", expect.any(Object));
  });
});

// ══════════════════════════════════════════════════════════
// record_user
// ══════════════════════════════════════════════════════════

describe("SessionRecorder — record_user", () => {
  it("sessions=null → 즉시 반환", async () => {
    const recorder = make_recorder({ sessions: null });
    await expect(recorder.record_user("slack", make_message(), "assistant")).resolves.toBeUndefined();
  });

  it("metadata fields → 메시지에 포함", async () => {
    const sessions = make_sessions([]);
    const recorder = make_recorder({ sessions });
    await recorder.record_user("slack", make_message(), "assistant");
    expect(sessions.append_message).toHaveBeenCalledOnce();
  });
});
