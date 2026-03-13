/**
 * Phase 8 — 런타임/세션 레이어 통합 테스트.
 *
 * 설계문서 "다음 작업" 항목:
 *   1. get_runtime() → RouteContext.workspace_runtime 주입
 *   2. WorkspaceRegistry → per-user runtime locator
 *   3. login/switch-team 시 런타임/세션 재바인딩
 *   4. 교차 팀 런타임 분리 + tenant-aware 세션 복구 테스트
 *
 * 대상: routes/chat.ts, routes/auth.ts, service.ts, workspace/runtime.ts
 */
import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "@src/dashboard/route-context.js";
import type { ChatSession } from "@src/dashboard/service.types.js";
import type { JwtPayload } from "@src/auth/auth-service.js";
import { handle_chat } from "@src/dashboard/routes/chat.js";
import { WorkspaceRuntime } from "@src/workspace/runtime.js";

// ── 사용자 픽스처 ──

const ALICE_T1: JwtPayload = { sub: "alice", usr: "alice", role: "user", tid: "team_1", wdir: "tenants/team_1/users/alice", iat: 0, exp: 0 };
const ALICE_T2: JwtPayload = { sub: "alice", usr: "alice", role: "user", tid: "team_2", wdir: "tenants/team_2/users/alice", iat: 0, exp: 0 };
const BOB_T1: JwtPayload = { sub: "bob", usr: "bob", role: "user", tid: "team_1", wdir: "tenants/team_1/users/bob", iat: 0, exp: 0 };

function make_session(id: string, user_id: string, team_id = ""): ChatSession {
  return { id, user_id, team_id, created_at: "2026-01-01T00:00:00Z", messages: [] };
}

type JsonSpy = { status: number; data: unknown };

function make_ctx(overrides: {
  method: string;
  path: string;
  auth_user?: JwtPayload | null;
  chat_sessions?: Map<string, ChatSession>;
  body?: Record<string, unknown> | null;
  workspace_runtime?: WorkspaceRuntime | null;
}): RouteContext & { _json: JsonSpy } {
  const spy: JsonSpy = { status: 0, data: null };
  const auth = overrides.auth_user ?? null;
  const tid = auth?.tid ?? "";
  const uid = auth?.sub ?? "";

  return {
    req: { method: overrides.method, url: overrides.path, headers: {}, on: vi.fn() } as unknown as IncomingMessage,
    res: { statusCode: 0, setHeader: vi.fn(), write: vi.fn(), end: vi.fn(), writableEnded: false } as unknown as ServerResponse,
    url: new URL(overrides.path, "http://localhost"),
    options: {} as any,
    auth_user: auth,
    team_context: tid ? { team_id: tid, team_role: "member" as const } : null,
    workspace_layers: [],
    personal_dir: "/tmp",
    workspace_runtime: overrides.workspace_runtime ?? null,
    json: (_r: ServerResponse, s: number, d: unknown) => { spy.status = s; spy.data = d; },
    read_body: vi.fn().mockResolvedValue(overrides.body ?? null),
    add_sse_client: vi.fn(),
    build_state: vi.fn().mockResolvedValue({}),
    build_merged_tasks: vi.fn().mockResolvedValue([]),
    recent_messages: [],
    metrics: {} as any,
    chat_sessions: overrides.chat_sessions ?? new Map(),
    session_store: null,
    session_store_key: (id: string) => `web:${tid}:${uid}:${id}:default:main`,
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
// 교차 팀 세션 격리 — GET /api/chat/sessions
// ══════════════════════════════════════════

describe("GET /api/chat/sessions — team_id 필터링", () => {
  it("같은 유저라도 다른 팀 세션은 목록에서 제외", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "alice", "team_1"));
    sessions.set("s2", make_session("s2", "alice", "team_2"));
    sessions.set("s3", make_session("s3", "alice", "team_1"));

    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions",
      auth_user: ALICE_T1,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);

    expect(ctx._json.status).toBe(200);
    const list = ctx._json.data as Array<{ id: string }>;
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id).sort()).toEqual(["s1", "s3"]);
  });

  it("team_2 컨텍스트 → team_2 세션만 반환", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "alice", "team_1"));
    sessions.set("s2", make_session("s2", "alice", "team_2"));

    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions",
      auth_user: ALICE_T2,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);

    const list = ctx._json.data as Array<{ id: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("s2");
  });
});

// ══════════════════════════════════════════
// 세션 생성 시 team_id 설정
// ══════════════════════════════════════════

describe("POST /api/chat/sessions — team_id 설정", () => {
  it("인증 사용자 → team_id = auth_user.tid", async () => {
    const sessions = new Map<string, ChatSession>();
    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions",
      auth_user: ALICE_T1,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);

    expect(ctx._json.status).toBe(201);
    const created = [...sessions.values()][0];
    expect(created.team_id).toBe("team_1");
    expect(created.user_id).toBe("alice");
  });

  it("인증 없음 → team_id = ''", async () => {
    const sessions = new Map<string, ChatSession>();
    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions",
      auth_user: null,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);

    const created = [...sessions.values()][0];
    expect(created.team_id).toBe("");
  });
});

// ══════════════════════════════════════════
// 교차 팀 세션 접근 차단
// ══════════════════════════════════════════

describe("교차 팀 세션 접근 — ownership check에 team_id 포함", () => {
  it("같은 유저, 다른 팀 세션 GET → 404", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "alice", "team_2"));

    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions/s1",
      auth_user: ALICE_T1,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
  });

  it("같은 유저, 같은 팀 세션 GET → 200", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "alice", "team_1"));

    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions/s1",
      auth_user: ALICE_T1,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("같은 유저, 다른 팀 세션 DELETE → 404 + 세션 유지", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "alice", "team_2"));

    const ctx = make_ctx({
      method: "DELETE",
      path: "/api/chat/sessions/s1",
      auth_user: ALICE_T1,
      chat_sessions: sessions,
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
    expect(sessions.has("s1")).toBe(true);
  });

  it("같은 유저, 다른 팀 세션 메시지 전송 → 404", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "alice", "team_2"));

    const ctx = make_ctx({
      method: "POST",
      path: "/api/chat/sessions/s1/messages",
      auth_user: ALICE_T1,
      chat_sessions: sessions,
      body: { content: "cross-team" },
    });

    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
    expect(sessions.get("s1")!.messages).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// workspace_runtime 주입 검증
// ══════════════════════════════════════════

describe("RouteContext.workspace_runtime 통합", () => {
  it("WorkspaceRuntime 인스턴스가 RouteContext에 주입 가능", () => {
    const rt = new WorkspaceRuntime("team_1", "alice", "/ws/team_1/alice");
    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions",
      auth_user: ALICE_T1,
      workspace_runtime: rt,
    });

    expect(ctx.workspace_runtime).toBe(rt);
    expect(ctx.workspace_runtime!.team_id).toBe("team_1");
    expect(ctx.workspace_runtime!.is_active).toBe(true);
  });

  it("인증 없음 → workspace_runtime null", () => {
    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions",
      auth_user: null,
    });

    expect(ctx.workspace_runtime).toBeNull();
  });
});

// ══════════════════════════════════════════
// 팀 전환 시나리오 — 세션 범위 전환
// ══════════════════════════════════════════

describe("팀 전환 시 세션 범위 전환", () => {
  it("team_1에서 세션 생성 → team_2로 전환 → team_1 세션 보이지 않음", async () => {
    const sessions = new Map<string, ChatSession>();

    // team_1에서 세션 생성
    const ctx_create = make_ctx({
      method: "POST",
      path: "/api/chat/sessions",
      auth_user: ALICE_T1,
      chat_sessions: sessions,
    });
    await handle_chat(ctx_create);
    expect(sessions.size).toBe(1);

    // team_2로 전환 후 세션 목록 조회
    const ctx_list = make_ctx({
      method: "GET",
      path: "/api/chat/sessions",
      auth_user: ALICE_T2,
      chat_sessions: sessions,
    });
    await handle_chat(ctx_list);

    const list = ctx_list._json.data as Array<{ id: string }>;
    expect(list).toHaveLength(0);
  });

  it("team_2에서 세션 생성 → team_1에서 접근 불가", async () => {
    const sessions = new Map<string, ChatSession>();

    // team_2에서 세션 생성
    const ctx_create = make_ctx({
      method: "POST",
      path: "/api/chat/sessions",
      auth_user: ALICE_T2,
      chat_sessions: sessions,
    });
    await handle_chat(ctx_create);

    const created_id = [...sessions.keys()][0];

    // team_1에서 접근 시도
    const ctx_get = make_ctx({
      method: "GET",
      path: `/api/chat/sessions/${created_id}`,
      auth_user: ALICE_T1,
      chat_sessions: sessions,
    });
    await handle_chat(ctx_get);
    expect(ctx_get._json.status).toBe(404);
  });
});
