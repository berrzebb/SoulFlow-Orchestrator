/**
 * AgentHandler — 미커버 분기 커버리지.
 * - format_list: 20개 초과, 미지원 status icon
 * - format_running: 실행중 없음, 있음 + label
 * - format_status: id 없음, agent 없음, 모든 필드, last_result 200자 트리밍
 * - do_cancel: id 없음, all/전체, all 없음
 * - do_send: id 없음, text 없음, ok=false
 * - handle: 각 action 분기
 */
import { describe, it, expect, vi } from "vitest";
import { AgentHandler } from "@src/channels/commands/agent.handler.js";

// ─── format_subcommand_guide / usage mock ─────────────────────────────────────

vi.mock("@src/channels/commands/registry.js", () => ({
  format_subcommand_guide: vi.fn().mockReturnValue(null),
  format_subcommand_usage: (_cmd: string, sub: string) => `Usage: /${_cmd} ${sub} <id>`,
}));

vi.mock("@src/channels/slash-command.js", () => ({
  slash_name_in: (_name: string, aliases: string[]) => aliases.includes(_name),
}));

vi.mock("@src/channels/commands/types.js", () => ({
  format_mention: (_provider: string, sender_id: string) => `@${sender_id} `,
}));

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function make_agent(overrides: Partial<{
  id: string; role: string; status: string; label?: string;
  model?: string; session_id?: string; created_at?: string;
  updated_at?: string; last_error?: string; last_result?: string;
}> = {}): { id: string; role: string; status: string; [k: string]: unknown } {
  return { id: "a1", role: "worker", status: "running", ...overrides };
}

function make_access(overrides: Partial<{
  list: () => ReturnType<typeof make_agent>[];
  list_running: () => ReturnType<typeof make_agent>[];
  get: (id: string) => ReturnType<typeof make_agent> | null;
  cancel: (id: string) => boolean;
  send_input: (id: string, text: string) => boolean;
  get_running_count: () => number;
}> = {}) {
  return {
    list: vi.fn().mockReturnValue([]),
    list_running: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    cancel: vi.fn().mockReturnValue(false),
    send_input: vi.fn().mockReturnValue(false),
    get_running_count: vi.fn().mockReturnValue(0),
    ...overrides,
  } as any;
}

function make_ctx(args: string[] = [], command_name = "agent") {
  return {
    provider: "slack",
    message: { sender_id: "U1", chat_id: "C1" },
    command: { name: command_name, args },
    send_reply: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// ══════════════════════════════════════════════════════
// format_list 분기
// ══════════════════════════════════════════════════════

describe("AgentHandler — format_list", () => {
  it("에이전트 없음 → '등록된 서브에이전트가 없습니다'", async () => {
    const h = new AgentHandler(make_access());
    const ctx = make_ctx();
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("등록된 서브에이전트가 없습니다");
  });

  it("에이전트 20개 초과 → '외 N개' 출력", async () => {
    const agents = Array.from({ length: 25 }, (_, i) => make_agent({ id: `a${i}`, status: "idle" }));
    const h = new AgentHandler(make_access({ list: vi.fn().mockReturnValue(agents), get_running_count: vi.fn().mockReturnValue(0) }));
    const ctx = make_ctx();
    await h.handle(ctx);
    const reply: string = ctx.send_reply.mock.calls[0][0];
    expect(reply).toContain("외 5개");
  });

  it("미지원 status → ❓ 아이콘", async () => {
    const h = new AgentHandler(make_access({
      list: vi.fn().mockReturnValue([make_agent({ status: "unknown_status" })]),
      get_running_count: vi.fn().mockReturnValue(0),
    }));
    const ctx = make_ctx();
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("❓");
  });

  it("label 있음 → (label) 표시", async () => {
    const h = new AgentHandler(make_access({
      list: vi.fn().mockReturnValue([make_agent({ label: "리서치봇" })]),
      get_running_count: vi.fn().mockReturnValue(1),
    }));
    const ctx = make_ctx();
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("(리서치봇)");
  });
});

// ══════════════════════════════════════════════════════
// format_running
// ══════════════════════════════════════════════════════

describe("AgentHandler — running 액션", () => {
  it("실행중 없음 → '실행 중인 서브에이전트가 없습니다'", async () => {
    const h = new AgentHandler(make_access({ list_running: vi.fn().mockReturnValue([]) }));
    const ctx = make_ctx(["running"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("실행 중인 서브에이전트가 없습니다");
  });

  it("실행중 있음 + label → label 포함", async () => {
    const h = new AgentHandler(make_access({
      list_running: vi.fn().mockReturnValue([make_agent({ label: "리서치" })]),
    }));
    const ctx = make_ctx(["running"]);
    await h.handle(ctx);
    const reply: string = ctx.send_reply.mock.calls[0][0];
    expect(reply).toContain("실행 중 1개");
    expect(reply).toContain("(리서치)");
  });

  it("실행중 있음 label 없음 → 기본 형식", async () => {
    const h = new AgentHandler(make_access({
      list_running: vi.fn().mockReturnValue([make_agent()]),
    }));
    const ctx = make_ctx(["실행중"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("🔄");
  });
});

// ══════════════════════════════════════════════════════
// format_status
// ══════════════════════════════════════════════════════

describe("AgentHandler — status 액션", () => {
  it("id 없음 → usage 반환", async () => {
    const h = new AgentHandler(make_access());
    const ctx = make_ctx(["status"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("Usage:");
  });

  it("agent 없음 → '찾을 수 없습니다'", async () => {
    const h = new AgentHandler(make_access({ get: vi.fn().mockReturnValue(null) }));
    const ctx = make_ctx(["status", "agent-x"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("찾을 수 없습니다");
  });

  it("agent 있음 — 모든 필드 표시", async () => {
    const a = make_agent({
      id: "a1", role: "coder", status: "completed",
      label: "라벨1", model: "claude-3", session_id: "sess-1",
      created_at: "2024-01-01", updated_at: "2024-01-02",
      last_error: "timeout", last_result: "result text",
    });
    const h = new AgentHandler(make_access({ get: vi.fn().mockReturnValue(a) }));
    const ctx = make_ctx(["status", "a1"]);
    await h.handle(ctx);
    const reply: string = ctx.send_reply.mock.calls[0][0];
    expect(reply).toContain("coder");
    expect(reply).toContain("claude-3");
    expect(reply).toContain("sess-1");
    expect(reply).toContain("timeout");
    expect(reply).toContain("result text");
  });

  it("last_result 200자 초과 → 200자로 트리밍", async () => {
    const long_result = "x".repeat(300);
    const a = make_agent({ status: "completed", last_result: long_result });
    const h = new AgentHandler(make_access({ get: vi.fn().mockReturnValue(a) }));
    const ctx = make_ctx(["상태", "a1"]);
    await h.handle(ctx);
    const reply: string = ctx.send_reply.mock.calls[0][0];
    // last_result 슬라이스(0,200)가 포함되어야 함
    expect(reply).toContain("x".repeat(200));
    expect(reply).not.toContain("x".repeat(201));
  });
});

// ══════════════════════════════════════════════════════
// do_cancel
// ══════════════════════════════════════════════════════

describe("AgentHandler — cancel 액션", () => {
  it("id 없음 → usage", async () => {
    const h = new AgentHandler(make_access());
    const ctx = make_ctx(["cancel"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("Usage:");
  });

  it("id='all' 실행중 없음 → '취소할 실행 중인 서브에이전트가 없습니다'", async () => {
    const h = new AgentHandler(make_access({ list_running: vi.fn().mockReturnValue([]) }));
    const ctx = make_ctx(["cancel", "all"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("취소할 실행 중인 서브에이전트가 없습니다");
  });

  it("id='전체' → 전체 취소", async () => {
    const cancel = vi.fn().mockReturnValue(true);
    const h = new AgentHandler(make_access({
      list_running: vi.fn().mockReturnValue([make_agent({ id: "a1" }), make_agent({ id: "a2" })]),
      cancel,
    }));
    const ctx = make_ctx(["취소", "전체"]);
    await h.handle(ctx);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("2/2개");
  });

  it("특정 id cancel=true → '✅ 서브에이전트 취소됨'", async () => {
    const h = new AgentHandler(make_access({ cancel: vi.fn().mockReturnValue(true) }));
    const ctx = make_ctx(["cancel", "a1"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("✅ 서브에이전트 취소됨");
  });

  it("특정 id cancel=false → '취소할 수 없습니다'", async () => {
    const h = new AgentHandler(make_access({ cancel: vi.fn().mockReturnValue(false) }));
    const ctx = make_ctx(["cancel", "a1"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("취소할 수 없습니다");
  });
});

// ══════════════════════════════════════════════════════
// do_send
// ══════════════════════════════════════════════════════

describe("AgentHandler — send 액션", () => {
  it("id 없음 → usage", async () => {
    const h = new AgentHandler(make_access());
    const ctx = make_ctx(["send"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("Usage:");
  });

  it("text 없음 → '전송할 텍스트를 입력하세요'", async () => {
    const h = new AgentHandler(make_access());
    const ctx = make_ctx(["send", "a1"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("전송할 텍스트를 입력하세요");
  });

  it("send_input=true → '✅ 입력 전송됨'", async () => {
    const h = new AgentHandler(make_access({ send_input: vi.fn().mockReturnValue(true) }));
    const ctx = make_ctx(["전송", "a1", "hello", "world"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("✅ 입력 전송됨");
  });

  it("send_input=false → '전송할 수 없습니다'", async () => {
    const h = new AgentHandler(make_access({ send_input: vi.fn().mockReturnValue(false) }));
    const ctx = make_ctx(["send", "a1", "hello"]);
    await h.handle(ctx);
    expect(ctx.send_reply.mock.calls[0][0]).toContain("전송할 수 없습니다");
  });
});

// ══════════════════════════════════════════════════════
// handle — can_handle / action="" with guide
// ══════════════════════════════════════════════════════

describe("AgentHandler — can_handle / default", () => {
  it("command name 'agents'도 처리", async () => {
    const h = new AgentHandler(make_access());
    const ctx = make_ctx([], "agents");
    const handled = await h.handle(ctx);
    expect(handled).toBe(true);
  });

  it("action 없음 guide 없음 → format_list 호출", async () => {
    const h = new AgentHandler(make_access());
    const ctx = make_ctx([]);
    await h.handle(ctx);
    // format_list 호출 → 에이전트 없음 메시지
    expect(ctx.send_reply.mock.calls[0][0]).toContain("등록된 서브에이전트가 없습니다");
  });
});
