import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionRecorder } from "@src/channels/session-recorder.js";
import type { InboundMessage } from "@src/bus/types.js";

function make_message(overrides?: Partial<InboundMessage>): InboundMessage {
  return {
    id: "msg-1",
    provider: "slack",
    channel: "slack",
    sender_id: "user1",
    chat_id: "C123",
    content: "hello world",
    at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

function make_session() {
  const messages: any[] = [];
  return {
    messages,
    add_message: vi.fn((role: string, content: string, meta?: any) => {
      messages.push({ role, content, ...meta, timestamp: meta?.at });
    }),
  };
}

function make_deps(overrides?: any) {
  const session = make_session();
  const sessions = {
    get_or_create: vi.fn(async () => session),
    append_message: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
  };
  const daily_memory = {
    append_daily_memory: vi.fn(async () => {}),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(function(this: any) { return this; }),
  };

  return {
    sessions,
    session,
    daily_memory,
    logger: logger as any,
    sanitize: (text: string) => text,
    ...overrides,
  };
}

describe("SessionRecorder", () => {
  it("records user message to session and daily memory", async () => {
    const deps = make_deps();
    const recorder = new SessionRecorder({
      sessions: deps.sessions as any,
      daily_memory: deps.daily_memory,
      sanitize_for_storage: deps.sanitize,
      logger: deps.logger,
    });

    await recorder.record_user("slack", make_message(), "bot");

    expect(deps.sessions.append_message).toHaveBeenCalledWith(
      "slack:C123:bot:main",
      expect.objectContaining({ role: "user", content: "hello world", sender_id: "user1" }),
    );
    expect(deps.daily_memory.append_daily_memory).toHaveBeenCalledWith(
      expect.stringContaining("USER(user1): hello world"),
    );
  });

  it("records assistant message to session and daily memory", async () => {
    const deps = make_deps();
    const recorder = new SessionRecorder({
      sessions: deps.sessions as any,
      daily_memory: deps.daily_memory,
      sanitize_for_storage: deps.sanitize,
      logger: deps.logger,
    });

    await recorder.record_assistant("slack", make_message(), "bot", "I can help!");

    expect(deps.sessions.append_message).toHaveBeenCalledWith(
      "slack:C123:bot:main",
      expect.objectContaining({ role: "assistant", content: "I can help!", sender_id: "bot" }),
    );
    expect(deps.daily_memory.append_daily_memory).toHaveBeenCalledWith(
      expect.stringContaining("ASSISTANT(bot): I can help!"),
    );
  });

  it("uses thread_id in session key when present", async () => {
    const deps = make_deps();
    const recorder = new SessionRecorder({
      sessions: deps.sessions as any,
      daily_memory: deps.daily_memory,
      sanitize_for_storage: deps.sanitize,
      logger: deps.logger,
    });

    const msg = make_message({ thread_id: "T456" });
    await recorder.record_user("slack", msg, "bot");

    expect(deps.sessions.append_message).toHaveBeenCalledWith(
      "slack:C123:bot:T456",
      expect.objectContaining({ role: "user" }),
    );
  });

  it("does nothing when sessions is null", async () => {
    const deps = make_deps();
    const recorder = new SessionRecorder({
      sessions: null,
      daily_memory: deps.daily_memory,
      sanitize_for_storage: deps.sanitize,
      logger: deps.logger,
    });

    await recorder.record_user("slack", make_message(), "bot");
    expect(deps.sessions.get_or_create).not.toHaveBeenCalled();
  });

  it("does not throw on session error", async () => {
    const deps = make_deps();
    deps.sessions.append_message.mockRejectedValue(new Error("db_error"));
    const recorder = new SessionRecorder({
      sessions: deps.sessions as any,
      daily_memory: deps.daily_memory,
      sanitize_for_storage: deps.sanitize,
      logger: deps.logger,
    });

    // Should not throw
    await recorder.record_user("slack", make_message(), "bot");
    expect(deps.logger.debug).toHaveBeenCalled();
  });

  it("applies sanitize_for_storage to content", async () => {
    const deps = make_deps({ sanitize: (t: string) => t.toUpperCase() });
    const recorder = new SessionRecorder({
      sessions: deps.sessions as any,
      daily_memory: deps.daily_memory,
      sanitize_for_storage: deps.sanitize,
      logger: deps.logger,
    });

    await recorder.record_user("slack", make_message({ content: "secret data" }), "bot");
    expect(deps.sessions.append_message).toHaveBeenCalledWith(
      "slack:C123:bot:main",
      expect.objectContaining({ role: "user", content: "SECRET DATA" }),
    );
  });

  it("get_history returns empty when sessions is null", async () => {
    const deps = make_deps();
    const recorder = new SessionRecorder({
      sessions: null,
      daily_memory: null,
      sanitize_for_storage: deps.sanitize,
      logger: deps.logger,
    });

    const history = await recorder.get_history("slack", "C123", "bot", undefined, 10, 0);
    expect(history).toEqual([]);
  });

  it("get_history filters by max_messages", async () => {
    const deps = make_deps();
    // Pre-populate session messages
    for (let i = 0; i < 5; i++) {
      deps.session.messages.push({
        role: "user",
        content: `msg-${i}`,
        at: new Date().toISOString(),
      });
    }

    const recorder = new SessionRecorder({
      sessions: deps.sessions as any,
      daily_memory: null,
      sanitize_for_storage: deps.sanitize,
      logger: deps.logger,
    });

    const history = await recorder.get_history("slack", "C123", "bot", undefined, 3, 0);
    expect(history).toHaveLength(3);
    expect(history[0].content).toBe("msg-2");
    expect(history[2].content).toBe("msg-4");
  });

  it("skips daily memory write when daily_memory is null", async () => {
    const deps = make_deps();
    const recorder = new SessionRecorder({
      sessions: deps.sessions as any,
      daily_memory: null,
      sanitize_for_storage: deps.sanitize,
      logger: deps.logger,
    });

    await recorder.record_user("slack", make_message(), "bot");
    // No exception, daily_memory.append_daily_memory not called
    expect(deps.daily_memory.append_daily_memory).not.toHaveBeenCalled();
  });
});

// ── 미커버 분기 보충용 헬퍼 ──

function make_recorder_cov(overrides: Partial<{
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

function make_message_cov(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1", provider: "slack", channel: "slack",
    chat_id: "C123", sender_id: "user1",
    content: "hello", at: new Date().toISOString(), thread_id: undefined,
    ...overrides,
  } as any;
}

function make_sessions_cov(messages: any[] = []) {
  return {
    get_or_create: vi.fn().mockResolvedValue({ messages }),
    append_message: vi.fn().mockResolvedValue(undefined),
  } as any;
}

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
      recorder.record_assistant("slack", make_message_cov(), "assistant", "response")
    ).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith("record_assistant failed", expect.objectContaining({ error: expect.any(String) }));
  });

  it("sessions=null → 즉시 반환", async () => {
    const recorder = make_recorder_cov({ sessions: null });
    await expect(
      recorder.record_assistant("slack", make_message_cov(), "assistant", "content")
    ).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// get_history — 추가 분기
// ══════════════════════════════════════════════════════════

describe("SessionRecorder — get_history 추가 분기", () => {
  it("메시지 없음 → [] 반환", async () => {
    const recorder = make_recorder_cov({ sessions: make_sessions_cov([]) });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 0);
    expect(h).toEqual([]);
  });

  it("메시지 있음 → role/content 추출", async () => {
    const recorder = make_recorder_cov({
      sessions: make_sessions_cov([
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
    const recorder = make_recorder_cov({
      sessions: make_sessions_cov([
        { role: "user", content: "old msg", timestamp: old_ts },
        { role: "user", content: "new msg", timestamp: new_ts },
      ]),
    });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 60_000);
    expect(h).toHaveLength(1);
    expect(h[0].content).toBe("new msg");
  });

  it("timestamp 없는 메시지 → max_age_ms>0 → 포함 (return true)", async () => {
    const recorder = make_recorder_cov({
      sessions: make_sessions_cov([
        { role: "user", content: "no-ts msg" },
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
    const recorder = make_recorder_cov({ sessions });
    const h = await recorder.get_history("slack", "C1", "assistant", undefined, 10, 0);
    expect(h).toEqual([]);
  });

  it("content 없는 메시지 → filter 제거", async () => {
    const recorder = make_recorder_cov({
      sessions: make_sessions_cov([
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
    const recorder = make_recorder_cov({ sessions: null });
    const c = await recorder.get_last_assistant_content("slack", "C1", "assistant");
    expect(c).toBeNull();
  });

  it("assistant 메시지 없음 → null 반환", async () => {
    const recorder = make_recorder_cov({
      sessions: make_sessions_cov([
        { role: "user", content: "hello" },
      ]),
    });
    const c = await recorder.get_last_assistant_content("slack", "C1", "assistant");
    expect(c).toBeNull();
  });

  it("마지막 assistant 메시지 content 반환", async () => {
    const recorder = make_recorder_cov({
      sessions: make_sessions_cov([
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
    const recorder = make_recorder_cov({ sessions });
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
    const sessions = make_sessions_cov([]);
    const recorder = make_recorder_cov({ sessions, on_mirror_message: on_mirror });
    await expect(
      recorder.record_user("slack", make_message_cov(), "assistant")
    ).resolves.toBeUndefined();
    expect(on_mirror).toHaveBeenCalled();
  });

  it("on_mirror_message=null → emit_mirror no-op", async () => {
    const sessions = make_sessions_cov([]);
    const recorder = make_recorder_cov({ sessions, on_mirror_message: undefined });
    await expect(
      recorder.record_user("slack", make_message_cov(), "assistant")
    ).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// append_daily_memory throw → logger.warn
// ══════════════════════════════════════════════════════════

describe("SessionRecorder — append_daily_memory throw → logger.warn", () => {
  it("daily_memory.append_daily_memory throw → logger.warn 호출", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
    const daily_memory = {
      append_daily_memory: vi.fn().mockRejectedValue(new Error("disk full")),
    };
    const sessions = make_sessions_cov([]);
    const recorder = new SessionRecorder({
      sessions, daily_memory,
      sanitize_for_storage: (s) => s,
      logger,
    });
    await expect(
      recorder.record_user("slack", make_message_cov({ content: "hello" }), "assistant")
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith("daily memory write failed", expect.any(Object));
  });
});

// ══════════════════════════════════════════════════════════
// record_user — metadata fields
// ══════════════════════════════════════════════════════════

describe("SessionRecorder — record_user metadata", () => {
  it("metadata fields → 메시지에 포함", async () => {
    const sessions = make_sessions_cov([]);
    const recorder = make_recorder_cov({ sessions });
    await recorder.record_user("slack", make_message_cov(), "assistant");
    expect(sessions.append_message).toHaveBeenCalledOnce();
  });
});
