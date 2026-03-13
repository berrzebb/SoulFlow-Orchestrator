/**
 * mirror 라우트 스코핑 테스트.
 * 멀티테넌트 환경에서 외부 채널 세션 접근 제어 검증.
 *
 * 대상: src/dashboard/routes/chat.ts (handle_chat — mirror 경로)
 */
import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "@src/dashboard/route-context.js";
import type { ChatSession } from "@src/dashboard/service.types.js";
import type { JwtPayload } from "@src/auth/auth-service.js";
import type { TeamRole } from "@src/auth/team-store.js";
import { handle_chat } from "@src/dashboard/routes/chat.js";

const MANAGER: JwtPayload = { sub: "mgr", usr: "manager", role: "user", tid: "team_1", wdir: "tenants/team_1/users/mgr", iat: 0, exp: 0 };
const MEMBER: JwtPayload = { sub: "usr", usr: "member", role: "user", tid: "team_1", wdir: "tenants/team_1/users/usr", iat: 0, exp: 0 };
const SUPERADMIN: JwtPayload = { sub: "admin", usr: "admin", role: "superadmin", tid: "default", wdir: "tenants/default/users/admin", iat: 0, exp: 0 };

type JsonSpy = { status: number; data: unknown };

function make_mirror_ctx(overrides: {
  method: string;
  path: string;
  auth_user?: JwtPayload | null;
  team_role?: TeamRole;
  auth_enabled?: boolean;
  enabled_channels?: string[];
  session_entries?: Array<{ key: string; created_at: string; updated_at: string; message_count: number }>;
  session_messages?: Array<{ role: string; content: string; timestamp?: string }>;
  body?: Record<string, unknown> | null;
}): RouteContext & { _json: JsonSpy } {
  const spy: JsonSpy = { status: 0, data: null };
  const auth_user = overrides.auth_user ?? null;
  const auth_enabled = overrides.auth_enabled ?? true;
  const enabled_channels = overrides.enabled_channels ?? ["slack", "telegram"];

  const req = { method: overrides.method, url: overrides.path, headers: {}, on: vi.fn() } as unknown as IncomingMessage;
  const res = { statusCode: 0, setHeader: vi.fn(), write: vi.fn(), end: vi.fn(), writableEnded: false, headersSent: false } as unknown as ServerResponse;
  const url = new URL(overrides.path, "http://localhost");

  const session_store = {
    list_by_prefix: vi.fn(async () => overrides.session_entries ?? []),
    get_or_create: vi.fn(async () => ({
      key: "", created_at: "2026-01-01T00:00:00Z", messages: overrides.session_messages ?? [],
    })),
    append_message: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
  };

  return {
    req, res, url,
    options: {
      auth_svc: auth_enabled ? {} : null,
      channels: { get_status: () => ({ enabled_channels, mention_loop_running: false }), get_channel_health: () => [], get_active_run_count: () => 0 },
    } as any,
    auth_user,
    team_context: auth_user?.tid
      ? { team_id: auth_user.tid, team_role: overrides.team_role ?? "member" }
      : null,
    workspace_runtime: null,
    workspace_layers: [],
    personal_dir: "/tmp",
    json: (_res: ServerResponse, status: number, data: unknown) => { spy.status = status; spy.data = data; },
    read_body: vi.fn().mockResolvedValue(overrides.body ?? null),
    add_sse_client: vi.fn(),
    build_state: vi.fn().mockResolvedValue({}),
    build_merged_tasks: vi.fn().mockResolvedValue([]),
    recent_messages: [],
    metrics: {} as any,
    chat_sessions: new Map<string, ChatSession>(),
    session_store,
    session_store_key: (id: string) => `web:${auth_user?.tid ?? ""}:${auth_user?.sub ?? ""}:${id}:default:main`,
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

const ENTRIES = [
  { key: "slack:C1:bot:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 5 },
  { key: "telegram:123:bot:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 3 },
  { key: "web:team_1:user_a:s1:default:main", created_at: "2026-01-01", updated_at: "2026-01-01", message_count: 1 },
];

// ══════════════════════════════════════════
// GET /api/chat/mirror — 역할 기반 접근 제어
// ══════════════════════════════════════════

describe("GET /api/chat/mirror — role-based access", () => {
  it("auth 비활성 (싱글 유저 모드) → 전체 목록 반환", async () => {
    const ctx = make_mirror_ctx({
      method: "GET", path: "/api/chat/mirror",
      auth_enabled: false, session_entries: ENTRIES,
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    const list = ctx._json.data as any[];
    // web: 프리픽스 세션은 제외됨
    expect(list).toHaveLength(2);
  });

  it("superadmin → 전체 목록 반환", async () => {
    const ctx = make_mirror_ctx({
      method: "GET", path: "/api/chat/mirror",
      auth_user: SUPERADMIN, team_role: "owner",
      session_entries: ENTRIES,
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    expect((ctx._json.data as any[]).length).toBe(2);
  });

  it("team_manager → 활성 채널 세션만 반환", async () => {
    const ctx = make_mirror_ctx({
      method: "GET", path: "/api/chat/mirror",
      auth_user: MANAGER, team_role: "manager",
      enabled_channels: ["slack"],
      session_entries: ENTRIES,
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    const list = ctx._json.data as any[];
    expect(list).toHaveLength(1);
    expect(list[0].provider).toBe("slack");
  });

  it("일반 member → GET은 허용 (require_team_manager_for_write는 GET 통과)", async () => {
    const ctx = make_mirror_ctx({
      method: "GET", path: "/api/chat/mirror",
      auth_user: MEMBER, team_role: "member",
      session_entries: ENTRIES,
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("enabled_channels가 비면 모든 provider 세션 반환", async () => {
    const ctx = make_mirror_ctx({
      method: "GET", path: "/api/chat/mirror",
      auth_user: MANAGER, team_role: "manager",
      enabled_channels: [],
      session_entries: ENTRIES,
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    expect((ctx._json.data as any[]).length).toBe(2);
  });

  it("session_store 없음 → 빈 배열", async () => {
    const ctx = make_mirror_ctx({
      method: "GET", path: "/api/chat/mirror",
      auth_enabled: false,
    });
    // session_store.list_by_prefix가 있으므로 제거
    (ctx as any).session_store = null;
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    expect(ctx._json.data).toEqual([]);
  });
});

// ══════════════════════════════════════════
// GET /api/chat/mirror/:key — 세션 메시지 조회
// ══════════════════════════════════════════

describe("GET /api/chat/mirror/:key — access control", () => {
  it("superadmin → 세션 메시지 조회 성공", async () => {
    const ctx = make_mirror_ctx({
      method: "GET",
      path: "/api/chat/mirror/slack%3AC1%3Abot%3Amain",
      auth_user: SUPERADMIN, team_role: "owner",
      session_messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    const data = ctx._json.data as { messages: any[] };
    expect(data.messages).toHaveLength(2);
  });

  it("session_store 없음 → 503", async () => {
    const ctx = make_mirror_ctx({
      method: "GET",
      path: "/api/chat/mirror/slack%3AC1%3Abot%3Amain",
      auth_enabled: false,
    });
    (ctx as any).session_store = null;
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(503);
  });
});

// ══════════════════════════════════════════
// POST /api/chat/mirror/:key/messages — 릴레이 접근 제어
// ══════════════════════════════════════════

describe("POST /api/chat/mirror/:key/messages — write access", () => {
  it("team_manager → 메시지 릴레이 성공", async () => {
    const ctx = make_mirror_ctx({
      method: "POST",
      path: "/api/chat/mirror/slack%3AC1%3Abot%3Amain/messages",
      auth_user: MANAGER, team_role: "manager",
      body: { content: "relay this" },
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
    expect((ctx._json.data as any).ok).toBe(true);
  });

  it("일반 member → 403 (team_manager_required)", async () => {
    const ctx = make_mirror_ctx({
      method: "POST",
      path: "/api/chat/mirror/slack%3AC1%3Abot%3Amain/messages",
      auth_user: MEMBER, team_role: "member",
      body: { content: "attack" },
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(403);
  });

  it("superadmin → 릴레이 성공", async () => {
    const ctx = make_mirror_ctx({
      method: "POST",
      path: "/api/chat/mirror/slack%3AC1%3Abot%3Amain/messages",
      auth_user: SUPERADMIN, team_role: "owner",
      body: { content: "admin relay" },
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("auth 비활성 → 릴레이 성공", async () => {
    const ctx = make_mirror_ctx({
      method: "POST",
      path: "/api/chat/mirror/slack%3AC1%3Abot%3Amain/messages",
      auth_enabled: false,
      body: { content: "single user" },
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(200);
  });

  it("빈 content → 400", async () => {
    const ctx = make_mirror_ctx({
      method: "POST",
      path: "/api/chat/mirror/slack%3AC1%3Abot%3Amain/messages",
      auth_user: MANAGER, team_role: "manager",
      body: { content: "" },
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(400);
  });

  it("잘못된 session_key → 400", async () => {
    const ctx = make_mirror_ctx({
      method: "POST",
      path: "/api/chat/mirror/invalid/messages",
      auth_user: MANAGER, team_role: "manager",
      body: { content: "test" },
    });
    await handle_chat(ctx);
    expect(ctx._json.status).toBe(400);
  });
});
