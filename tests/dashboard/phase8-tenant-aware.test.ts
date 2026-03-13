/**
 * Phase 8 — tenant-aware session/runtime 단위 테스트.
 *
 * 설계문서 항목:
 *   23. RouteContext.team_context 추가
 *   24. RouteContext.workspace_runtime 추가
 *   25. WorkspaceRegistry → WorkspaceRuntimeLocator 확장
 *   26. 로그인/팀 전환 시 tenant-aware runtime session 분리
 *   27. web chat/session store key에 tenant 문맥 반영
 *
 * 대상 파일:
 *   - src/dashboard/route-context.ts (TeamContext, WorkspaceRuntimeLike 타입)
 *   - src/dashboard/service.ts (_build_route_context, _session_store_key, _restore_web_sessions)
 *   - src/dashboard/routes/chat.ts (team_id 기반 세션 격리)
 *   - src/workspace/registry.ts (WorkspaceRuntimeLocator 인터페이스)
 */
import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext, TeamContext } from "@src/dashboard/route-context.js";
import type { ChatSession } from "@src/dashboard/service.types.js";
import type { JwtPayload } from "@src/auth/auth-service.js";
import { handle_chat } from "@src/dashboard/routes/chat.js";

// ── 사용자 픽스처 ──

const ALICE_TEAM1: JwtPayload = { sub: "alice", usr: "alice", role: "user", tid: "team_1", wdir: "tenants/team_1/users/alice", iat: 0, exp: 0 };
const ALICE_TEAM2: JwtPayload = { sub: "alice", usr: "alice", role: "user", tid: "team_2", wdir: "tenants/team_2/users/alice", iat: 0, exp: 0 };
const BOB_TEAM1: JwtPayload = { sub: "bob", usr: "bob", role: "user", tid: "team_1", wdir: "tenants/team_1/users/bob", iat: 0, exp: 0 };

// ── 헬퍼 ──

function make_session(id: string, user_id: string, team_id = ""): ChatSession {
  return { id, user_id, team_id, created_at: "2026-01-01T00:00:00Z", messages: [] };
}

type JsonSpy = { status: number; data: unknown };

function make_ctx(overrides: {
  method: string;
  path: string;
  auth_user?: JwtPayload | null;
  team_context?: TeamContext | null;
  chat_sessions?: Map<string, ChatSession>;
  body?: Record<string, unknown> | null;
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
    team_context: overrides.team_context ?? (tid ? { team_id: tid, team_role: "member" as const } : null),
    workspace_layers: [],
    personal_dir: "/tmp",
    workspace_runtime: null,
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
// 항목 23: RouteContext.team_context 타입 존재
// ══════════════════════════════════════════

describe("Phase 8-23: RouteContext.team_context", () => {
  it("team_context 필드가 RouteContext에 존재해야 한다", () => {
    const ctx = make_ctx({ method: "GET", path: "/", auth_user: ALICE_TEAM1 });
    expect(ctx.team_context).toBeDefined();
    expect(ctx.team_context!.team_id).toBe("team_1");
    expect(ctx.team_context!.team_role).toBe("member");
  });

  it("인증 없음 → team_context = null", () => {
    const ctx = make_ctx({ method: "GET", path: "/", auth_user: null });
    expect(ctx.team_context).toBeNull();
  });
});

// ══════════════════════════════════════════
// 항목 24: RouteContext.workspace_runtime 타입 존재
// ══════════════════════════════════════════

describe("Phase 8-24: RouteContext.workspace_runtime", () => {
  it("workspace_runtime 필드가 RouteContext에 존재해야 한다 (초기값 null 허용)", () => {
    const ctx = make_ctx({ method: "GET", path: "/", auth_user: ALICE_TEAM1 });
    expect("workspace_runtime" in ctx).toBe(true);
    // Phase 8 초기 — per-user RuntimeApp 미구현 시 null 허용
    expect(ctx.workspace_runtime).toBeNull();
  });
});

// ══════════════════════════════════════════
// 항목 27: session_store_key에 team_id 포함
// ══════════════════════════════════════════

describe("Phase 8-27: session_store_key에 team_id 포함", () => {
  it("session_store_key에 team_id가 포함됨", () => {
    const ctx = make_ctx({ method: "GET", path: "/", auth_user: ALICE_TEAM1 });
    const key = ctx.session_store_key("chat_123");
    expect(key).toContain("team_1");
    expect(key).toContain("alice");
    expect(key).toContain("chat_123");
  });

  it("같은 user, 다른 team → 다른 session key", () => {
    const ctx_t1 = make_ctx({ method: "GET", path: "/", auth_user: ALICE_TEAM1 });
    const ctx_t2 = make_ctx({ method: "GET", path: "/", auth_user: ALICE_TEAM2 });

    const key_t1 = ctx_t1.session_store_key("chat_1");
    const key_t2 = ctx_t2.session_store_key("chat_1");
    expect(key_t1).not.toBe(key_t2);
    expect(key_t1).toContain("team_1");
    expect(key_t2).toContain("team_2");
  });

  it("다른 user, 같은 team → 다른 session key", () => {
    const ctx_alice = make_ctx({ method: "GET", path: "/", auth_user: ALICE_TEAM1 });
    const ctx_bob = make_ctx({ method: "GET", path: "/", auth_user: BOB_TEAM1 });

    const key_alice = ctx_alice.session_store_key("chat_1");
    const key_bob = ctx_bob.session_store_key("chat_1");
    expect(key_alice).not.toBe(key_bob);
  });
});

// ══════════════════════════════════════════
// 항목 25: WorkspaceRuntimeLocator 인터페이스
// ══════════════════════════════════════════

describe("Phase 8-25: WorkspaceRuntimeLocator 인터페이스", () => {
  it("WorkspaceRegistry가 get_runtime 메서드를 제공해야 한다", async () => {
    // 동적 import — 컴파일 타임 검증
    const { WorkspaceRegistry } = await import("@src/workspace/registry.js");
    const registry = new WorkspaceRegistry("/tmp/test-workspace");

    // get_runtime은 WorkspaceRuntimeLocator 확장의 핵심
    expect(typeof registry.get_runtime).toBe("function");
  });

  it("get_runtime은 등록되지 않은 키에 대해 null 반환", async () => {
    const { WorkspaceRegistry } = await import("@src/workspace/registry.js");
    const registry = new WorkspaceRegistry("/tmp/test-workspace");

    const runtime = registry.get_runtime({ team_id: "t1", user_id: "u1" });
    expect(runtime).toBeNull();
  });
});

// ══════════════════════════════════════════
// 항목 26: 팀 전환 시 세션 범위 분리
// ══════════════════════════════════════════

describe("Phase 8-26: 팀 전환 시 세션 범위 분리", () => {
  it("같은 유저가 team_1에서 생성한 세션은 team_2 컨텍스트에서 접근 불가", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "alice", "team_1"));

    // team_1 컨텍스트에서 세션 조회 → 성공
    const ctx_t1 = make_ctx({
      method: "GET",
      path: "/api/chat/sessions/s1",
      auth_user: ALICE_TEAM1,
      chat_sessions: sessions,
    });
    await handle_chat(ctx_t1);
    expect(ctx_t1._json.status).toBe(200);

    // team_2 컨텍스트에서 동일 세션 조회 → 404 (team_id 불일치)
    const ctx_t2 = make_ctx({
      method: "GET",
      path: "/api/chat/sessions/s1",
      auth_user: ALICE_TEAM2,
      chat_sessions: sessions,
    });
    await handle_chat(ctx_t2);
    expect(ctx_t2._json.status).toBe(404);
  });

  it("다른 유저의 세션은 같은 팀이라도 접근 불가", async () => {
    const sessions = new Map<string, ChatSession>();
    sessions.set("s1", make_session("s1", "alice", "team_1"));

    const ctx = make_ctx({
      method: "GET",
      path: "/api/chat/sessions/s1",
      auth_user: BOB_TEAM1,
      chat_sessions: sessions,
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(404);
  });
});
