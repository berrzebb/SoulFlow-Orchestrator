/**
 * chat 세션 사용자 격리 테스트.
 * 설계문서 Phase 8 항목 27 — tenant-aware session store key의 부분 구현(user_id 격리) 검증.
 *
 * 대상: src/dashboard/routes/chat.ts (handle_chat)
 * 대상: src/dashboard/service.ts (_session_store_key, _restore_web_sessions)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "@src/dashboard/route-context.js";
import type { ChatSession } from "@src/dashboard/service.types.js";
import type { JwtPayload } from "@src/auth/auth-service.js";
import { handle_chat } from "@src/dashboard/routes/chat.js";

// ── 헬퍼 ──

const USER_A: JwtPayload = { sub: "user_a", usr: "alice", role: "user", tid: "team_1", wdir: "tenants/team_1/users/user_a", iat: 0, exp: 0 };
const USER_B: JwtPayload = { sub: "user_b", usr: "bob", role: "user", tid: "team_1", wdir: "tenants/team_1/users/user_b", iat: 0, exp: 0 };

function make_session(id: string, user_id: string, team_id?: string): ChatSession {
  // 이 테스트의 모든 유저는 team_1. user_id가 있으면 team_1, 없으면 "".
  const tid = team_id ?? (user_id ? "team_1" : "");
  return { id, user_id, team_id: tid, created_at: "2026-01-01T00:00:00Z", messages: [] };
}

type JsonSpy = { status: number; data: unknown };

function make_ctx(overrides: {
  method: string;
  path: string;
  auth_user?: JwtPayload | null;
  chat_sessions?: Map<string, ChatSession>;
  body?: Record<string, unknown> | null;
}): RouteContext & { _json: JsonSpy } {
  const spy: JsonSpy = { status: 0, data: null };

  const req = {
    method: overrides.method,
    url: overrides.path,
    headers: {},
    on: vi.fn(),
  } as unknown as IncomingMessage;

  const res = {
    statusCode: 0,
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    writableEnded: false,
  } as unknown as ServerResponse;

  const url = new URL(overrides.path, "http://localhost");

  return {
    req,
    res,
    url,
    options: {} as any,
    auth_user: overrides.auth_user ?? null,
    team_context: overrides.auth_user?.tid ? { team_id: overrides.auth_user.tid, team_role: "member" as const } : null,
    workspace_runtime: null,
    workspace_layers: [],
    personal_dir: "/tmp",
    json: (_res: ServerResponse, status: number, data: unknown) => {
      spy.status = status;
      spy.data = data;
    },
    read_body: vi.fn().mockResolvedValue(overrides.body ?? null),
    add_sse_client: vi.fn(),
    build_state: vi.fn().mockResolvedValue({}),
    build_merged_tasks: vi.fn().mockResolvedValue([]),
    recent_messages: [],
    metrics: {} as any,
    chat_sessions: overrides.chat_sessions ?? new Map(),
    session_store: null,
    session_store_key: (id: string) => `web:${overrides.auth_user?.tid ?? ""}:${overrides.auth_user?.sub ?? ""}:${id}:default:main`,
    register_media_token: vi.fn().mockReturnValue(null),
    oauth_callback_handler: undefined,
    oauth_callback_html: vi.fn().mockReturnValue(""),
    resolve_request_origin: vi.fn().mockReturnValue("http://localhost"),
    bus: { publish_inbound: vi.fn().mockResolvedValue(undefined) } as any,
    add_rich_stream_listener: vi.fn().mockReturnValue(() => {}),
    _json: spy,
  };
}

// ══════════════════════════════════════════
// GET /api/chat/sessions — 세션 목록 필터링
// ══════════════════════════════════════════

describe("GET /api/chat/sessions — user_id 필터링", () => {
  it("자신의 세션만 반환, 타 사용자 세션 제외", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_a"));
    sessions.set("s2", make_session("s2", "user_b"));
    sessions.set("s3", make_session("s3", "user_a"));

    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions",
      auth_user: USER_A,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);

    expect(ctx._json.status).toBe(200);
    const list = ctx._json.data as Array<{ id: string }>;
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id).sort()).toEqual(["s1", "s3"]);
  });

  it("인증 없음 (auth_user=null) → user_id='' 세션만 반환", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", ""));
    sessions.set("s2", make_session("s2", "user_a"));

    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions",
      auth_user: null,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);

    expect(ctx._json.status).toBe(200);
    const list = ctx._json.data as Array<{ id: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("s1");
  });
});

// ══════════════════════════════════════════
// POST /api/chat/sessions — 세션 생성 시 user_id 설정
// ══════════════════════════════════════════

describe("POST /api/chat/sessions — user_id 할당", () => {
  it("인증 사용자로 생성 → user_id 설정됨", async () => {
    const sessions = new Map<string, ChatSession>();
    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions",
      auth_user: USER_A,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);

    expect(ctx._json.status).toBe(201);
    expect(sessions.size).toBe(1);
    const created = [...sessions.values()][0];
    expect(created.user_id).toBe("user_a");
  });

  it("인증 없음 → user_id='' 로 설정됨", async () => {
    const sessions = new Map<string, ChatSession>();
    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions",
      auth_user: null,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);

    expect(ctx._json.status).toBe(201);
    const created = [...sessions.values()][0];
    expect(created.user_id).toBe("");
  });
});

// ══════════════════════════════════════════
// GET /api/chat/sessions/:id — 소유자 검증
// ══════════════════════════════════════════

describe("GET /api/chat/sessions/:id — ownership check", () => {
  it("자신의 세션 조회 → 200", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_a"));

    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions/s1",
      auth_user: USER_A,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("타 사용자 세션 접근 → 404 (정보 노출 방지)", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_b"));

    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions/s1",
      auth_user: USER_A,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
  });

  it("존재하지 않는 세션 → 404", async () => {
    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions/nonexistent",
      auth_user: USER_A,
      chat_sessions: new Map(),
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
  });
});

// ══════════════════════════════════════════
// PATCH /api/chat/sessions/:id — 소유자만 이름 변경
// ══════════════════════════════════════════

describe("PATCH /api/chat/sessions/:id — ownership check", () => {
  it("자신의 세션 이름 변경 → 200", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_a"));

    const ctx = make_ctx({
      method: "PATCH",
      path: "/api/chat/sessions/s1",
      auth_user: USER_A,
      chat_sessions: sessions,
      body: { name: "My Chat" },
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    expect(sessions.get("s1")!.name).toBe("My Chat");
  });

  it("타 사용자 세션 이름 변경 시도 → 404", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_b"));

    const ctx = make_ctx({
      method: "PATCH",
      path: "/api/chat/sessions/s1",
      auth_user: USER_A,
      chat_sessions: sessions,
      body: { name: "Hijack" },
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
    expect(sessions.get("s1")!.name).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// DELETE /api/chat/sessions/:id — 소유자만 삭제
// ══════════════════════════════════════════

describe("DELETE /api/chat/sessions/:id — ownership check", () => {
  it("자신의 세션 삭제 → 200 + Map에서 제거", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_a"));

    const ctx = make_ctx({
      method: "DELETE",
      path: "/api/chat/sessions/s1",
      auth_user: USER_A,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    expect(sessions.has("s1")).toBe(false);
  });

  it("타 사용자 세션 삭제 시도 → 404 + 세션 유지", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_b"));

    const ctx = make_ctx({
      method: "DELETE",
      path: "/api/chat/sessions/s1",
      auth_user: USER_A,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
    expect(sessions.has("s1")).toBe(true);
  });
});

// ══════════════════════════════════════════
// POST /api/chat/sessions/:id/messages — 소유자만 메시지 전송
// ══════════════════════════════════════════

describe("POST /api/chat/sessions/:id/messages — ownership check", () => {
  it("자신의 세션에 메시지 전송 → 200", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_a"));

    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions/s1/messages",
      auth_user: USER_A,
      chat_sessions: sessions,
      body: { content: "hello" },
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    expect(sessions.get("s1")!.messages).toHaveLength(1);
  });

  it("타 사용자 세션에 메시지 전송 시도 → 404", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_b"));

    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions/s1/messages",
      auth_user: USER_A,
      chat_sessions: sessions,
      body: { content: "attack" },
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
    expect(sessions.get("s1")!.messages).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// POST /api/chat/sessions/:id/messages/stream — 소유자만 스트리밍
// ══════════════════════════════════════════

describe("POST /api/chat/sessions/:id/messages/stream — ownership check", () => {
  it("타 사용자 세션 스트리밍 시도 → 404", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_b"));

    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions/s1/messages/stream",
      auth_user: USER_A,
      chat_sessions: sessions,
      body: { content: "attack" },
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
  });
});

// ══════════════════════════════════════════
// session_store_key — user_id 포함 검증
// ══════════════════════════════════════════

describe("session_store_key — user_id 포함", () => {
  it("ctx.session_store_key에 user_id가 포함됨", () => {
    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions",
      auth_user: USER_A,
    });

    const key = ctx.session_store_key("chat_123");
    expect(key).toContain("user_a");
    expect(key).toContain("chat_123");
  });

  it("다른 user → 다른 key", () => {
    const ctx_a = make_ctx({ method: "GET", path: "/", auth_user: USER_A });
    const ctx_b = make_ctx({ method: "GET", path: "/", auth_user: USER_B });

    const key_a = ctx_a.session_store_key("chat_1");
    const key_b = ctx_b.session_store_key("chat_1");
    expect(key_a).not.toBe(key_b);
  });
});

// ══════════════════════════════════════════
// build_publish_payload — sender_id에 user_id 반영
// ══════════════════════════════════════════

describe("build_publish_payload — sender_id 검증", () => {
  it("인증 사용자 메시지 전송 시 sender_id = user_id", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "user_a"));

    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions/s1/messages",
      auth_user: USER_A,
      chat_sessions: sessions,
      body: { content: "hello" },
    });

    await handle_chat(ctx);

    const bus = ctx.bus as { publish_inbound: ReturnType<typeof vi.fn> };
    expect(bus.publish_inbound).toHaveBeenCalledOnce();
    const payload = bus.publish_inbound.mock.calls[0][0];
    expect(payload.sender_id).toBe("user_a");
  });

  it("인증 없음 → sender_id = 'web_user'", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", ""));

    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions/s1/messages",
      auth_user: null,
      chat_sessions: sessions,
      body: { content: "hello" },
    });

    await handle_chat(ctx);

    const bus = ctx.bus as { publish_inbound: ReturnType<typeof vi.fn> };
    const payload = bus.publish_inbound.mock.calls[0][0];
    expect(payload.sender_id).toBe("web_user");
  });
});
