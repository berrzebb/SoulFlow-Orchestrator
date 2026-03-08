/**
 * MemoryHandler — 모든 action 경로 커버리지.
 * handle() guard: command && !args → guide 반환 (spec 동작).
 * action 실행: /memory <subcommand> 형태로 args 포함.
 */
import { describe, it, expect, vi } from "vitest";
import { MemoryHandler } from "@src/channels/commands/memory.handler.js";
import type { MemoryStoreLike, MemoryAccess } from "@src/channels/commands/memory.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";

function make_memory(overrides: Partial<MemoryStoreLike> = {}): MemoryStoreLike {
  return {
    search: vi.fn().mockResolvedValue([]),
    read_daily: vi.fn().mockResolvedValue(null),
    read_longterm: vi.fn().mockResolvedValue(null),
    list_daily: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function make_access(memory: MemoryStoreLike | null): MemoryAccess {
  return { get_memory_store: () => memory };
}

function make_ctx(opts: {
  content?: string;
  command_name?: string;
  command_args?: string[];
  provider?: string;
}): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  const { content = "", command_name, command_args = [], provider = "telegram" } = opts;
  return {
    provider: provider as any,
    message: {
      content,
      sender_id: "user1",
      chat_id: "chat-1",
      message_id: "msg-1",
      provider: provider as any,
    } as any,
    command: command_name
      ? { name: command_name, raw: `/${command_name}`, args: command_args, args_lower: command_args.map(s => s.toLowerCase()) }
      : null,
    text: content,
    send_reply: async (msg: string) => { replies.push(msg); },
    replies,
  };
}

// ══════════════════════════════════════════
// can_handle
// ══════════════════════════════════════════

describe("MemoryHandler — can_handle", () => {
  const handler = new MemoryHandler(make_access(make_memory()));

  it("memory 커맨드 → true", () => {
    const ctx = make_ctx({ command_name: "memory" });
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("memory-search 커맨드 → true", () => {
    const ctx = make_ctx({ command_name: "memory-search" });
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("알 수 없는 커맨드 → false", () => {
    const ctx = make_ctx({ command_name: "unknown", content: "hello" });
    expect(handler.can_handle(ctx)).toBe(false);
  });
});

// ══════════════════════════════════════════
// handle() guard — no-args → guide
// ══════════════════════════════════════════

describe("MemoryHandler — guide 경로 (args 없음)", () => {
  it("/memory args 없음 → guide 반환", async () => {
    const handler = new MemoryHandler(make_access(make_memory()));
    const ctx = make_ctx({ command_name: "memory", command_args: [] });
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("/memory");
  });
});

// ══════════════════════════════════════════
// memory unavailable
// ══════════════════════════════════════════

describe("MemoryHandler — memory null", () => {
  it("memory store 없음 → unavailable 메시지", async () => {
    const handler = new MemoryHandler(make_access(null));
    // args 포함해야 guide 경로 건너뜀
    const ctx = make_ctx({ command_name: "memory", command_args: ["status"] });
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("unavailable");
  });
});

// ══════════════════════════════════════════
// action: search — /memory search <query>
// ══════════════════════════════════════════

describe("MemoryHandler — search action", () => {
  it("쿼리 있음 + 결과 있음 → 결과 목록 반환", async () => {
    const memory = make_memory({
      search: vi.fn().mockResolvedValue([
        { file: "sqlite://memory/daily/2026-01-01", line: 5, text: "important note" },
        { file: "longterm", line: 1, text: "another entry" },
      ]),
    });
    const handler = new MemoryHandler(make_access(memory));
    // /memory search important
    const ctx = make_ctx({ command_name: "memory", command_args: ["search", "important"] });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("daily/2026-01-01");
    expect(ctx.replies[0]).toContain("important note");
  });

  it("쿼리 있음 + 결과 없음 → 없음 메시지", async () => {
    const memory = make_memory({ search: vi.fn().mockResolvedValue([]) });
    const handler = new MemoryHandler(make_access(memory));
    const ctx = make_ctx({ command_name: "memory", command_args: ["search", "noresult"] });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
    expect(ctx.replies[0]).toContain("noresult");
  });

  it("search 쿼리 없음 → usage 안내", async () => {
    const memory = make_memory();
    const handler = new MemoryHandler(make_access(memory));
    // /memory search (no query text)
    const ctx = make_ctx({ command_name: "memory", command_args: ["search"] });
    await handler.handle(ctx);
    expect(ctx.replies.length).toBe(1);
  });
});

// ══════════════════════════════════════════
// action: today — /memory today
// ══════════════════════════════════════════

describe("MemoryHandler — today action", () => {
  it("오늘 메모리 있음 → 본문 표시", async () => {
    const memory = make_memory({ read_daily: vi.fn().mockResolvedValue("Today's notes here") });
    const handler = new MemoryHandler(make_access(memory));
    const ctx = make_ctx({ command_name: "memory", command_args: ["today"] });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("오늘 메모리");
    expect(ctx.replies[0]).toContain("Today's notes here");
  });

  it("오늘 메모리 없음 → 비어 있습니다 메시지", async () => {
    const memory = make_memory({ read_daily: vi.fn().mockResolvedValue(null) });
    const handler = new MemoryHandler(make_access(memory));
    const ctx = make_ctx({ command_name: "memory", command_args: ["today"] });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("비어 있습니다");
  });
});

// ══════════════════════════════════════════
// action: longterm — /memory longterm
// ══════════════════════════════════════════

describe("MemoryHandler — longterm action", () => {
  it("장기 메모리 있음 → 본문 표시", async () => {
    const memory = make_memory({ read_longterm: vi.fn().mockResolvedValue("Longterm knowledge") });
    const handler = new MemoryHandler(make_access(memory));
    const ctx = make_ctx({ command_name: "memory", command_args: ["longterm"] });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("장기 메모리");
    expect(ctx.replies[0]).toContain("Longterm knowledge");
  });

  it("장기 메모리 없음 → 비어 있습니다 메시지", async () => {
    const memory = make_memory({ read_longterm: vi.fn().mockResolvedValue(null) });
    const handler = new MemoryHandler(make_access(memory));
    const ctx = make_ctx({ command_name: "memory", command_args: ["longterm"] });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("비어 있습니다");
  });
});

// ══════════════════════════════════════════
// action: list — /memory list
// ══════════════════════════════════════════

describe("MemoryHandler — list action", () => {
  it("daily 파일 있음 → 목록 반환 (최신 20개 역순)", async () => {
    const files = ["2026-01-01", "2026-01-02", "2026-01-03"];
    const memory = make_memory({ list_daily: vi.fn().mockResolvedValue(files) });
    const handler = new MemoryHandler(make_access(memory));
    const ctx = make_ctx({ command_name: "memory", command_args: ["list"] });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("daily memory 목록");
    expect(ctx.replies[0]).toContain("2026-01-03");
  });

  it("daily 파일 없음 → 없습니다 메시지", async () => {
    const memory = make_memory({ list_daily: vi.fn().mockResolvedValue([]) });
    const handler = new MemoryHandler(make_access(memory));
    const ctx = make_ctx({ command_name: "memory", command_args: ["list"] });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
  });
});

// ══════════════════════════════════════════
// action: status (default) — /memory status
// ══════════════════════════════════════════

describe("MemoryHandler — status (default) action", () => {
  it("status 반환 — 파일 수/오늘 키/롱텀 문자수 포함", async () => {
    const memory = make_memory({
      list_daily: vi.fn().mockResolvedValue(["2026-01-01", "2026-01-02"]),
      read_longterm: vi.fn().mockResolvedValue("some longterm content"),
      read_daily: vi.fn().mockResolvedValue("line1\nline2\nline3"),
    });
    const handler = new MemoryHandler(make_access(memory));
    const ctx = make_ctx({ command_name: "memory", command_args: ["status"] });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("메모리 상태");
    expect(ctx.replies[0]).toContain("daily_files: 2");
    expect(ctx.replies[0]).toContain("longterm_chars:");
  });

  it("command 없는 경우 → 빈 메모리 상태 반환", async () => {
    const memory = make_memory();
    const handler = new MemoryHandler(make_access(memory));
    // command=null, content="memory" → parse_memory_quick_action 텍스트 기반 null → "status"
    const ctx = make_ctx({ content: "memory status" });
    await handler.handle(ctx);
    // null command → 결과는 memory store에서 status 조회
    expect(ctx.replies.length).toBe(1);
  });
});

// ══════════════════════════════════════════
// Slack provider — @멘션 접두어 포함
// ══════════════════════════════════════════

describe("MemoryHandler — slack provider @mention", () => {
  it("slack provider → @user 접두어", async () => {
    const memory = make_memory({ list_daily: vi.fn().mockResolvedValue([]) });
    const handler = new MemoryHandler(make_access(memory));
    const ctx = make_ctx({ command_name: "memory", command_args: ["list"], provider: "slack" });
    await handler.handle(ctx);
    expect(ctx.replies[0]).toContain("@user1");
  });
});
