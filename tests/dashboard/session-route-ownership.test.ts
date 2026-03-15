/**
 * 세션·프로세스 상세 라우트 team ownership 검증.
 *
 * GPT 감사 지적:
 * - GET /api/sessions/:key 에서 비-web 세션 우회 가능
 * - GET /api/processes/:id 에서 team ownership 검사 부재
 */
import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "@src/dashboard/route-context.js";
import type { JwtPayload } from "@src/auth/auth-service.js";
import type { TeamRole } from "@src/auth/team-store.js";
import { handle_session } from "@src/dashboard/routes/session.js";
import { handle_process } from "@src/dashboard/routes/process.js";

type JsonSpy = { status: number; data: unknown };

function make_ctx(overrides: {
  method: string;
  path: string;
  auth_user?: JwtPayload | null;
  team_role?: TeamRole;
  auth_enabled?: boolean;
  session_store?: unknown;
  process_tracker?: unknown;
}): RouteContext & { _json: JsonSpy } {
  const spy: JsonSpy = { status: 0, data: null };
  const auth_user = overrides.auth_user ?? null;
  const auth_enabled = overrides.auth_enabled ?? true;

  const req = { method: overrides.method, url: overrides.path, headers: {}, on: vi.fn() } as unknown as IncomingMessage;
  const res = { statusCode: 0, setHeader: vi.fn(), write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false } as unknown as ServerResponse;
  const url = new URL(overrides.path, "http://localhost");

  return {
    req, res, url,
    options: {
      auth_svc: auth_enabled ? {} : null,
      process_tracker: overrides.process_tracker ?? null,
    } as any,
    auth_user,
    team_context: auth_user?.tid
      ? { team_id: auth_user.tid, team_role: overrides.team_role ?? "member" }
      : null,
    workspace_runtime: null,
    workspace_layers: [],
    personal_dir: "/tmp",
    json: (_res: ServerResponse, status: number, data: unknown) => { spy.status = status; spy.data = data; },
    read_body: vi.fn().mockResolvedValue(null),
    add_sse_client: vi.fn(),
    build_state: vi.fn().mockResolvedValue({}),
    build_merged_tasks: vi.fn().mockResolvedValue([]),
    recent_messages: [],
    metrics: {} as any,
    chat_sessions: new Map(),
    session_store: overrides.session_store as any ?? null,
    session_store_key: vi.fn(),
    register_media_token: vi.fn().mockReturnValue(null),
    oauth_callback_handler: undefined,
    oauth_callback_html: vi.fn().mockReturnValue(""),
    resolve_request_origin: vi.fn().mockReturnValue("http://localhost"),
    bus: { publish_inbound: vi.fn().mockResolvedValue(undefined) } as any,
    add_rich_stream_listener: vi.fn().mockReturnValue(() => {}),
    get_scoped_memory_ops: vi.fn().mockReturnValue(null),
    correlation: {} as any,
    _json: spy,
  };
}

const TEAM_A: JwtPayload = { sub: "u1", usr: "user1", role: "user", tid: "team_a", wdir: "tenants/team_a/users/u1", iat: 0, exp: 0 };
const SUPERADMIN: JwtPayload = { sub: "admin", usr: "admin", role: "superadmin", tid: "default", wdir: "tenants/default/users/admin", iat: 0, exp: 0 };

const mock_session_store = {
  list_by_prefix: vi.fn(async () => []),
  get_or_create: vi.fn(async () => ({
    key: "", created_at: "2026-01-01T00:00:00Z", messages: [{ role: "user", content: "hello" }],
  })),
};

// ══════════════════════════════════════════
// GET /api/sessions/:key — team ownership
// ══════════════════════════════════════════

describe("GET /api/sessions/:key — team ownership", () => {
  it("web 세션: 같은 팀 → 200", async () => {
    const ctx = make_ctx({
      method: "GET",
      path: "/api/sessions/web%3Ateam_a%3Au1%3As1%3Adefault%3Amain",
      auth_user: TEAM_A, team_role: "member",
      session_store: mock_session_store,
    });
    await handle_session(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("web 세션: 다른 팀 → 404", async () => {
    const ctx = make_ctx({
      method: "GET",
      path: "/api/sessions/web%3Ateam_b%3Au2%3As1%3Adefault%3Amain",
      auth_user: TEAM_A, team_role: "member",
      session_store: mock_session_store,
    });
    await handle_session(ctx);
    expect(ctx._json.status).toBe(404);
  });

  it("외부 세션(slack): 다른 팀 → 404", async () => {
    // slack:team_b:C123:bot:main — parts[1]=team_b ≠ team_a
    const ctx = make_ctx({
      method: "GET",
      path: "/api/sessions/slack%3Ateam_b%3AC123%3Abot%3Amain",
      auth_user: TEAM_A, team_role: "member",
      session_store: mock_session_store,
    });
    await handle_session(ctx);
    expect(ctx._json.status).toBe(404);
  });

  it("외부 세션(slack): 같은 팀 → 200", async () => {
    const ctx = make_ctx({
      method: "GET",
      path: "/api/sessions/slack%3Ateam_a%3AC123%3Abot%3Amain",
      auth_user: TEAM_A, team_role: "member",
      session_store: mock_session_store,
    });
    await handle_session(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("superadmin → 전체 접근 허용", async () => {
    const ctx = make_ctx({
      method: "GET",
      path: "/api/sessions/slack%3Ateam_b%3AC123%3Abot%3Amain",
      auth_user: SUPERADMIN, team_role: "owner",
      session_store: mock_session_store,
    });
    await handle_session(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("auth 비활성 → 전체 접근 허용", async () => {
    const ctx = make_ctx({
      method: "GET",
      path: "/api/sessions/slack%3Ateam_b%3AC123%3Abot%3Amain",
      auth_enabled: false,
      session_store: mock_session_store,
    });
    await handle_session(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("session_store 없음 → 503", async () => {
    const ctx = make_ctx({
      method: "GET",
      path: "/api/sessions/slack%3Ateam_a%3AC123%3Abot%3Amain",
      auth_user: TEAM_A, team_role: "member",
      session_store: null,
    });
    await handle_session(ctx);
    expect(ctx._json.status).toBe(503);
  });
});

// ══════════════════════════════════════════
// FE-6: GET /api/sessions — user_id 필터 + parse_session_key
// ══════════════════════════════════════════

describe("GET /api/sessions — user_id 필터 (FE-6)", () => {
  it("web 6파트 키: 본인 세션만 반환", async () => {
    const store = {
      ...mock_session_store,
      list_by_prefix: vi.fn(async () => [
        { key: "web:team_a:u1:chat1:bot:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 5 },
        { key: "web:team_a:u2:chat2:bot:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 3 },
      ]),
    };
    const ctx = make_ctx({
      method: "GET", path: "/api/sessions",
      auth_user: TEAM_A, team_role: "member",
      session_store: store,
    });
    await handle_session(ctx);
    expect(ctx._json.status).toBe(200);
    const list = ctx._json.data as Array<{ user_id?: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].user_id).toBe("u1");
  });

  it("web 6파트 키: chat_id가 올바르게 파싱됨 (user_id와 혼동 없음)", async () => {
    const store = {
      ...mock_session_store,
      list_by_prefix: vi.fn(async () => [
        { key: "web:team_a:u1:the-real-chat:alias:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 1 },
      ]),
    };
    const ctx = make_ctx({
      method: "GET", path: "/api/sessions",
      auth_user: TEAM_A, team_role: "member",
      session_store: store,
    });
    await handle_session(ctx);
    const list = ctx._json.data as Array<{ chat_id: string; user_id?: string }>;
    expect(list[0].chat_id).toBe("the-real-chat");
    expect(list[0].user_id).toBe("u1");
  });

  it("external 5파트 키: user_id 없이 반환 (필터 통과)", async () => {
    const store = {
      ...mock_session_store,
      list_by_prefix: vi.fn(async () => [
        { key: "slack:team_a:C123:bot:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 2 },
      ]),
    };
    const ctx = make_ctx({
      method: "GET", path: "/api/sessions",
      auth_user: TEAM_A, team_role: "member",
      session_store: store,
    });
    await handle_session(ctx);
    const list = ctx._json.data as Array<{ user_id?: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].user_id).toBeUndefined();
  });

  it("superadmin: 모든 user_id의 세션 반환", async () => {
    const store = {
      ...mock_session_store,
      list_by_prefix: vi.fn(async () => [
        { key: "web:team_a:u1:c1:a:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 1 },
        { key: "web:team_a:u2:c2:a:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 1 },
        { key: "web:team_b:u3:c3:a:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 1 },
      ]),
    };
    const ctx = make_ctx({
      method: "GET", path: "/api/sessions",
      auth_user: SUPERADMIN, team_role: "owner",
      session_store: store,
    });
    await handle_session(ctx);
    const list = ctx._json.data as Array<{ user_id?: string }>;
    expect(list).toHaveLength(3);
  });
});

// ══════════════════════════════════════════
// GET /api/processes/:id — team ownership
// ══════════════════════════════════════════

describe("GET /api/processes/:id — team ownership", () => {
  const make_tracker = (entry: Record<string, unknown> | null) => ({
    get: vi.fn(() => entry),
    list_active: vi.fn(() => []),
    list_recent: vi.fn(() => []),
    cancel: vi.fn(async () => ({ cancelled: false })),
  });

  it("같은 팀 프로세스 → 200", async () => {
    const tracker = make_tracker({ run_id: "r1", team_id: "team_a", provider: "slack", status: "running" });
    const ctx = make_ctx({
      method: "GET", path: "/api/processes/r1",
      auth_user: TEAM_A, team_role: "member",
      process_tracker: tracker,
    });
    await handle_process(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("다른 팀 프로세스 → 404", async () => {
    const tracker = make_tracker({ run_id: "r1", team_id: "team_b", provider: "slack", status: "running" });
    const ctx = make_ctx({
      method: "GET", path: "/api/processes/r1",
      auth_user: TEAM_A, team_role: "member",
      process_tracker: tracker,
    });
    await handle_process(ctx);
    expect(ctx._json.status).toBe(404);
  });

  it("superadmin → 전체 접근 허용", async () => {
    const tracker = make_tracker({ run_id: "r1", team_id: "team_b", provider: "slack", status: "running" });
    const ctx = make_ctx({
      method: "GET", path: "/api/processes/r1",
      auth_user: SUPERADMIN, team_role: "owner",
      process_tracker: tracker,
    });
    await handle_process(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("auth 비활성 → 전체 접근 허용", async () => {
    const tracker = make_tracker({ run_id: "r1", team_id: "team_b", provider: "slack", status: "running" });
    const ctx = make_ctx({
      method: "GET", path: "/api/processes/r1",
      auth_enabled: false,
      process_tracker: tracker,
    });
    await handle_process(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("프로세스 없음 → 404", async () => {
    const tracker = make_tracker(null);
    const ctx = make_ctx({
      method: "GET", path: "/api/processes/nonexistent",
      auth_user: TEAM_A, team_role: "member",
      process_tracker: tracker,
    });
    await handle_process(ctx);
    expect(ctx._json.status).toBe(404);
  });
});
