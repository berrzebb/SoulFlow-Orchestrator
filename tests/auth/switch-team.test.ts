/**
 * TN-4 switch-team 회귀 테스트.
 *
 * 검증 항목:
 *   1. 멤버십 검증 (non-superadmin은 team.db 존재 + membership 필요)
 *   2. JWT 재발급 (새 team_id가 Set-Cookie에 반영)
 *   3. WorkspaceRuntime 사전 생성 (get_or_create 호출)
 *   4. 비멤버 → 403 거부
 *   5. superadmin → 멤버십 없이 전환 가능
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AdminStore } from "@src/auth/admin-store.js";
import { AuthService, type JwtPayload } from "@src/auth/auth-service.js";
import { TeamStore } from "@src/auth/team-store.js";
import { handle_auth } from "@src/dashboard/routes/auth.js";
import type { RouteContext } from "@src/dashboard/route-context.js";

// ── 유틸리티 ──

function make_auth_svc(): AuthService {
  const path = join(tmpdir(), `switch-team-test-${randomUUID()}.db`);
  return new AuthService(new AdminStore(path));
}

function make_workspace(): string {
  const ws = join(tmpdir(), `ws-switch-${randomUUID()}`);
  mkdirSync(ws, { recursive: true });
  return ws;
}

type MockRegistry = {
  get_or_create: ReturnType<typeof vi.fn>;
};

function make_ctx(
  method: string,
  pathname: string,
  body: Record<string, unknown> | null = null,
  auth_svc: AuthService | null = null,
  auth_user: JwtPayload | null = null,
  workspace?: string,
  workspace_registry?: MockRegistry,
): { ctx: RouteContext; sent: { status: number; data: unknown; cookies: string[] } } {
  const sent = { status: 0, data: null as unknown, cookies: [] as string[] };

  const req = { method, headers: {}, url: pathname } as unknown as IncomingMessage;
  const res = {
    statusCode: 0,
    headersSent: false,
    setHeader: vi.fn((name: string, value: string) => {
      if (name === "Set-Cookie") sent.cookies.push(value);
    }),
    end: vi.fn(),
  } as unknown as ServerResponse;

  const ctx: RouteContext = {
    req,
    res,
    url: new URL(pathname, "http://localhost"),
    options: {
      auth_svc,
      workspace,
      workspace_registry: workspace_registry ?? undefined,
    } as unknown as RouteContext["options"],
    auth_user,
    team_context: auth_user?.tid ? { team_id: auth_user.tid, team_role: "member" as const } : null,
    workspace_runtime: null,
    workspace_layers: [],
    personal_dir: "/tmp",
    json: (_r: ServerResponse, status: number, data: unknown) => { sent.status = status; sent.data = data; },
    read_body: vi.fn().mockResolvedValue(body),
    add_sse_client: vi.fn(),
    build_state: vi.fn(),
    build_merged_tasks: vi.fn(),
    recent_messages: [],
    metrics: {} as RouteContext["metrics"],
    chat_sessions: new Map(),
    session_store: null,
    session_store_key: (id) => id,
    register_media_token: vi.fn(),
    oauth_callback_html: vi.fn(),
    resolve_request_origin: vi.fn(),
    bus: null as unknown as RouteContext["bus"],
    add_rich_stream_listener: vi.fn(),
    get_scoped_memory_ops: vi.fn().mockReturnValue(null),
  };

  return { ctx, sent };
}

// ── 테스트 ──

describe("POST /api/auth/switch-team — TN-4 회귀 테스트", () => {
  let auth_svc: AuthService;
  let workspace: string;
  let registry: MockRegistry;
  let alice: JwtPayload;
  let superadmin: JwtPayload;

  beforeEach(async () => {
    auth_svc = make_auth_svc();
    workspace = make_workspace();
    registry = { get_or_create: vi.fn() };

    // superadmin 생성
    const setup_result = await auth_svc.setup_superadmin("admin", "secret123");
    superadmin = setup_result!.payload;

    // team_alpha를 AdminStore에 등록 후 사용자 생성
    (auth_svc as unknown as { store: { ensure_team: (id: string, name: string) => void } }).store.ensure_team("team_alpha", "Team Alpha");
    auth_svc.create_user({ username: "alice", password: "password1", system_role: "user", default_team_id: "team_alpha" });
    const login_result = await auth_svc.login("alice", "password1");
    alice = login_result!.payload;

    // team_alpha의 team.db 생성 + alice 멤버십 등록
    const team_dir = join(workspace, "tenants", "team_alpha");
    mkdirSync(team_dir, { recursive: true });
    const ts = new TeamStore(join(team_dir, "team.db"), "team_alpha");
    ts.upsert_member(alice.sub, "member");
  });

  it("멤버십 있는 팀 전환 → 200 + JWT 쿠키 재발급", async () => {
    const { ctx, sent } = make_ctx(
      "POST", "/api/auth/switch-team",
      { team_id: "team_alpha" },
      auth_svc, alice, workspace, registry,
    );
    await handle_auth(ctx);

    expect(sent.status).toBe(200);
    expect((sent.data as Record<string, unknown>).ok).toBe(true);
    expect((sent.data as Record<string, unknown>).tid).toBe("team_alpha");
    expect(sent.cookies.length).toBeGreaterThan(0);
    expect(sent.cookies[0]).toContain("sf_token=");
  });

  it("팀 전환 시 workspace_registry.get_or_create 호출", async () => {
    const { ctx } = make_ctx(
      "POST", "/api/auth/switch-team",
      { team_id: "team_alpha" },
      auth_svc, alice, workspace, registry,
    );
    await handle_auth(ctx);

    expect(registry.get_or_create).toHaveBeenCalledWith({
      team_id: "team_alpha",
      user_id: alice.sub,
    });
  });

  it("비멤버 팀 전환 시도 → 403 거부", async () => {
    // team_beta에 alice 멤버십 없음 (team.db 자체가 없음)
    const { ctx, sent } = make_ctx(
      "POST", "/api/auth/switch-team",
      { team_id: "team_beta" },
      auth_svc, alice, workspace, registry,
    );
    await handle_auth(ctx);

    expect(sent.status).toBe(403);
    expect((sent.data as Record<string, unknown>).error).toBe("not_a_member");
    expect(registry.get_or_create).not.toHaveBeenCalled();
  });

  it("team.db 존재하지만 멤버십 없음 → 403", async () => {
    // team_gamma 디렉토리/DB만 생성, alice 멤버십은 등록하지 않음
    const gamma_dir = join(workspace, "tenants", "team_gamma");
    mkdirSync(gamma_dir, { recursive: true });
    new TeamStore(join(gamma_dir, "team.db"), "team_gamma"); // DB 생성만

    const { ctx, sent } = make_ctx(
      "POST", "/api/auth/switch-team",
      { team_id: "team_gamma" },
      auth_svc, alice, workspace, registry,
    );
    await handle_auth(ctx);

    expect(sent.status).toBe(403);
    expect((sent.data as Record<string, unknown>).error).toBe("not_a_member");
  });

  it("superadmin → 멤버십 없어도 모든 팀 전환 가능", async () => {
    const { ctx, sent } = make_ctx(
      "POST", "/api/auth/switch-team",
      { team_id: "team_alpha" },
      auth_svc, superadmin, workspace, registry,
    );
    await handle_auth(ctx);

    expect(sent.status).toBe(200);
    expect((sent.data as Record<string, unknown>).ok).toBe(true);
  });

  it("team_id 없음 → 400", async () => {
    const { ctx, sent } = make_ctx(
      "POST", "/api/auth/switch-team",
      { team_id: "" },
      auth_svc, alice, workspace, registry,
    );
    await handle_auth(ctx);

    expect(sent.status).toBe(400);
    expect((sent.data as Record<string, unknown>).error).toBe("team_id_required");
  });

  it("미인증 → 401", async () => {
    const { ctx, sent } = make_ctx(
      "POST", "/api/auth/switch-team",
      { team_id: "team_alpha" },
      auth_svc, null, workspace, registry,
    );
    await handle_auth(ctx);

    expect(sent.status).toBe(401);
  });

  it("auth_svc 없음 → 503", async () => {
    const { ctx, sent } = make_ctx(
      "POST", "/api/auth/switch-team",
      { team_id: "team_alpha" },
      null, alice, workspace, registry,
    );
    await handle_auth(ctx);

    expect(sent.status).toBe(503);
  });
});
