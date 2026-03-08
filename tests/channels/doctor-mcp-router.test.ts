/**
 * DoctorHandler / McpHandler / CommandRouter 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { DoctorHandler, type DoctorAccess } from "@src/channels/commands/doctor.handler.js";
import { McpHandler, type McpAccess } from "@src/channels/commands/mcp.handler.js";
import { CommandRouter } from "@src/channels/commands/router.js";
import type { CommandContext } from "@src/channels/commands/types.js";

// ── 헬퍼 ─────────────────────────────────────────

function make_ctx(
  command_name: string,
  args: string[] = [],
  provider = "slack",
  sender_id = "U123",
): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider,
    message: {
      id: "msg-1",
      provider,
      channel: provider,
      sender_id,
      chat_id: "C001",
      content: `/${command_name} ${args.join(" ")}`,
      at: new Date().toISOString(),
    },
    command: {
      raw: `/${command_name} ${args.join(" ")}`,
      name: command_name,
      args,
      args_lower: args.map((a) => a.toLowerCase()),
    },
    text: args.join(" "),
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

function make_doctor_access(overrides: Partial<DoctorAccess> = {}): DoctorAccess {
  return {
    get_tool_count: () => 42,
    get_skill_count: () => 10,
    get_active_task_count: () => 2,
    get_active_loop_count: () => 1,
    list_backends: () => ["claude_sdk", "codex_cli"],
    list_mcp_servers: () => [
      { name: "memory", connected: true, tool_count: 5 },
      { name: "search", connected: false, tool_count: 0, error: "timeout" },
    ],
    get_cron_job_count: () => 3,
    ...overrides,
  };
}

function make_mcp_access(overrides: Partial<McpAccess> = {}): McpAccess {
  return {
    list_servers: () => [
      { name: "memory", connected: true, tool_count: 5 },
      { name: "search", connected: false, tool_count: 0, error: "ETIMEDOUT" },
    ],
    reconnect: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// ══════════════════════════════════════════
// DoctorHandler — can_handle
// ══════════════════════════════════════════

describe("DoctorHandler — can_handle", () => {
  it("'doctor' → true", () => {
    const h = new DoctorHandler(make_doctor_access());
    expect(h.can_handle(make_ctx("doctor"))).toBe(true);
  });

  it("'health' → true", () => {
    const h = new DoctorHandler(make_doctor_access());
    expect(h.can_handle(make_ctx("health"))).toBe(true);
  });

  it("'진단' → true", () => {
    const h = new DoctorHandler(make_doctor_access());
    expect(h.can_handle(make_ctx("진단"))).toBe(true);
  });

  it("'unknown' → false", () => {
    const h = new DoctorHandler(make_doctor_access());
    expect(h.can_handle(make_ctx("unknown"))).toBe(false);
  });
});

// ══════════════════════════════════════════
// DoctorHandler — handle
// ══════════════════════════════════════════

describe("DoctorHandler — handle", () => {
  it("action=mcp → MCP 서버 상태 출력", async () => {
    const h = new DoctorHandler(make_doctor_access());
    const ctx = make_ctx("doctor", ["mcp"]);
    const result = await h.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("MCP");
    expect(ctx.replies[0]).toContain("memory");
  });

  it("action=providers → 백엔드 목록 출력", async () => {
    const h = new DoctorHandler(make_doctor_access());
    const ctx = make_ctx("doctor", ["providers"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("백엔드");
    expect(ctx.replies[0]).toContain("claude_sdk");
  });

  it("action=backends → 백엔드 목록 출력 (alias)", async () => {
    const h = new DoctorHandler(make_doctor_access());
    const ctx = make_ctx("doctor", ["backends"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("백엔드");
  });

  it("백엔드 없음 → '없습니다'", async () => {
    const h = new DoctorHandler(make_doctor_access({ list_backends: () => [] }));
    const ctx = make_ctx("doctor", ["backends"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
  });

  it("action 없음 → 가이드 또는 overview 출력", async () => {
    const h = new DoctorHandler(make_doctor_access());
    const ctx = make_ctx("doctor", []);
    await h.handle(ctx);
    // 가이드(format_subcommand_guide)가 있으면 가이드 출력, 없으면 overview 출력
    expect(ctx.replies.length).toBeGreaterThan(0);
  });

  it("MCP 서버 없음 → '없습니다'", async () => {
    const h = new DoctorHandler(make_doctor_access({ list_mcp_servers: () => [] }));
    const ctx = make_ctx("doctor", ["mcp"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
  });

  it("MCP 서버 오류 → error 텍스트 포함", async () => {
    const h = new DoctorHandler(make_doctor_access());
    const ctx = make_ctx("doctor", ["mcp"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("timeout");
  });

  it("get_cron_job_count async → format_overview에서 7 포함", async () => {
    const h = new DoctorHandler(make_doctor_access({
      get_cron_job_count: () => Promise.resolve(7),
    }));
    // 알 수 없는 action → format_overview 실행
    const ctx = make_ctx("doctor", ["unknown_action"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("7");
  });

  it("알 수 없는 action → format_overview 실행", async () => {
    const h = new DoctorHandler(make_doctor_access());
    const ctx = make_ctx("doctor", ["nonexistent"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("시스템 진단");
  });
});

// ══════════════════════════════════════════
// McpHandler — can_handle
// ══════════════════════════════════════════

describe("McpHandler — can_handle", () => {
  it("'mcp' → true", () => {
    const h = new McpHandler(make_mcp_access());
    expect(h.can_handle(make_ctx("mcp"))).toBe(true);
  });

  it("'mcp-server' → true", () => {
    const h = new McpHandler(make_mcp_access());
    expect(h.can_handle(make_ctx("mcp-server"))).toBe(true);
  });

  it("'doctor' → false", () => {
    const h = new McpHandler(make_mcp_access());
    expect(h.can_handle(make_ctx("doctor"))).toBe(false);
  });
});

// ══════════════════════════════════════════
// McpHandler — handle
// ══════════════════════════════════════════

describe("McpHandler — handle", () => {
  it("action=reconnect + name → reconnect 호출 성공", async () => {
    const access = make_mcp_access();
    const h = new McpHandler(access);
    const ctx = make_ctx("mcp", ["reconnect", "memory"]);
    await h.handle(ctx);
    expect(access.reconnect).toHaveBeenCalledWith("memory");
    expect(ctx.replies[0]).toContain("재연결 완료");
  });

  it("action=reconnect + name → 실패", async () => {
    const access = make_mcp_access({ reconnect: vi.fn().mockResolvedValue(false) });
    const h = new McpHandler(access);
    const ctx = make_ctx("mcp", ["reconnect", "unknown-server"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("실패");
  });

  it("action=reconnect + name 없음 → usage 안내", async () => {
    const h = new McpHandler(make_mcp_access());
    const ctx = make_ctx("mcp", ["reconnect"]);
    await h.handle(ctx);
    // name 없으면 usage 안내 (reconnect 미호출)
    expect((make_mcp_access().reconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("action 없음 → 가이드 또는 서버 목록 출력", async () => {
    const h = new McpHandler(make_mcp_access());
    const ctx = make_ctx("mcp", []);
    await h.handle(ctx);
    // 가이드 있으면 가이드 반환, 없으면 서버 목록 반환
    expect(ctx.replies.length).toBeGreaterThan(0);
  });

  it("알 수 없는 action → 서버 목록 출력", async () => {
    const h = new McpHandler(make_mcp_access());
    const ctx = make_ctx("mcp", ["unknown_action"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("MCP");
    expect(ctx.replies[0]).toContain("memory");
  });

  it("서버 없음 → '없습니다' (action=unknown)", async () => {
    const h = new McpHandler(make_mcp_access({ list_servers: () => [] }));
    const ctx = make_ctx("mcp", ["unknown_action"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
  });

  it("서버 목록에 연결/비연결 아이콘 포함 (action=unknown)", async () => {
    const h = new McpHandler(make_mcp_access());
    const ctx = make_ctx("mcp", ["unknown_action"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("🟢"); // connected
    expect(ctx.replies[0]).toContain("🔴"); // disconnected
  });

  it("서버 오류 메시지 표시 (action=unknown)", async () => {
    const h = new McpHandler(make_mcp_access());
    const ctx = make_ctx("mcp", ["unknown_action"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("ETIMEDOUT");
  });
});

// ══════════════════════════════════════════
// CommandRouter
// ══════════════════════════════════════════

function make_handler(name: string, handles: boolean, reply = "handled") {
  return {
    name,
    can_handle: vi.fn().mockReturnValue(handles),
    handle: vi.fn().mockImplementation(async (ctx: CommandContext & { replies: string[] }) => {
      ctx.replies.push(reply);
      return handles;
    }),
  };
}

/** can_handle이 커맨드 이름과 정확히 매칭할 때만 true를 반환하는 핸들러 */
function make_strict_handler(handler_name: string, reply = "handled") {
  return {
    name: handler_name,
    can_handle: vi.fn().mockImplementation((ctx: CommandContext) => ctx.command?.name === handler_name),
    handle: vi.fn().mockImplementation(async (ctx: CommandContext & { replies: string[] }) => {
      ctx.replies.push(reply);
      return true;
    }),
  };
}

describe("CommandRouter — 기본 라우팅", () => {
  it("첫 번째 매칭 핸들러에 위임", async () => {
    const h1 = make_handler("one", false);
    const h2 = make_handler("two", true);
    const router = new CommandRouter([h1, h2]);
    const ctx = make_ctx("two");
    const result = await router.try_handle(ctx);
    expect(result).toBe(true);
    expect(h2.handle).toHaveBeenCalledOnce();
  });

  it("매칭 없음 → false", async () => {
    const h = make_handler("foo", false);
    const router = new CommandRouter([h]);
    const ctx = make_ctx("bar");
    const result = await router.try_handle(ctx);
    expect(result).toBe(false);
  });

  it("add_handler → 이후 라우팅에 사용됨", async () => {
    const router = new CommandRouter([]);
    const h = make_handler("late", true);
    router.add_handler(h);
    const ctx = make_ctx("late");
    const result = await router.try_handle(ctx);
    expect(result).toBe(true);
  });
});

describe("CommandRouter — 퍼지 매칭", () => {
  it("오타 1개 → 올바른 핸들러 선택", async () => {
    const h = make_strict_handler("doctor");
    const router = new CommandRouter([h]);
    const ctx = make_ctx("docotr"); // 오타 1개
    const result = await router.try_handle(ctx);
    expect(result).toBe(true);
  });

  it("오타 2개 → 여전히 매칭", async () => {
    const h = make_strict_handler("help");
    const router = new CommandRouter([h]);
    const ctx = make_ctx("hepp"); // 2개 오타
    const result = await router.try_handle(ctx);
    expect(result).toBe(true);
  });

  it("오타 3개 이상 → 매칭 없음", async () => {
    const h = make_strict_handler("help");
    const router = new CommandRouter([h]);
    const ctx = make_ctx("xxxxx"); // 거리 5 이상
    const result = await router.try_handle(ctx);
    expect(result).toBe(false);
  });

  it("커맨드 없음 → 퍼지 시도 안 함 → false", async () => {
    const h = make_strict_handler("help");
    const router = new CommandRouter([h]);
    const ctx = make_ctx("help");
    (ctx as any).command = undefined;
    const result = await router.try_handle(ctx);
    expect(result).toBe(false);
  });

  it("정확 매칭 → 퍼지 없이 1번만 호출", async () => {
    const h = make_strict_handler("status");
    const router = new CommandRouter([h]);
    const ctx = make_ctx("status");
    await router.try_handle(ctx);
    expect(h.handle).toHaveBeenCalledOnce();
  });
});
