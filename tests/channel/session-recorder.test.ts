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

    expect(deps.sessions.get_or_create).toHaveBeenCalledWith("slack:C123:bot:main");
    expect(deps.session.add_message).toHaveBeenCalledWith(
      "user",
      "hello world",
      expect.objectContaining({ sender_id: "user1" }),
    );
    expect(deps.sessions.save).toHaveBeenCalled();
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

    expect(deps.session.add_message).toHaveBeenCalledWith(
      "assistant",
      "I can help!",
      expect.objectContaining({ sender_id: "bot" }),
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

    expect(deps.sessions.get_or_create).toHaveBeenCalledWith("slack:C123:bot:T456");
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
    deps.sessions.get_or_create.mockRejectedValue(new Error("db_error"));
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
    expect(deps.session.add_message).toHaveBeenCalledWith(
      "user",
      "SECRET DATA",
      expect.anything(),
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
