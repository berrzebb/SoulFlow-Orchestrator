/**
 * auth route 핸들러 테스트.
 * DashboardService 전체를 띄우지 않고 handle_auth를 직접 호출한다.
 */
import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AdminStore } from "@src/auth/admin-store.js";
import { AuthService } from "@src/auth/auth-service.js";
import type { JwtPayload } from "@src/auth/auth-service.js";
import { handle_auth } from "@src/dashboard/routes/auth.js";
import type { RouteContext } from "@src/dashboard/route-context.js";

function make_auth_svc(): AuthService {
  const path = join(tmpdir(), `auth-routes-test-${randomUUID()}.db`);
  return new AuthService(new AdminStore(path));
}

function make_ctx(
  method: string,
  pathname: string,
  body: Record<string, unknown> | null = null,
  headers: Record<string, string> = {},
  auth_svc?: AuthService | null,
  auth_user?: JwtPayload | null,
): { ctx: RouteContext; sent: { status: number; data: unknown } } {
  const sent = { status: 0, data: null as unknown };

  const req = {
    method,
    headers,
    url: pathname,
  } as unknown as IncomingMessage;

  const res = {
    statusCode: 0,
    headersSent: false,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;

  const ctx: RouteContext = {
    req,
    res,
    url: new URL(pathname, "http://localhost"),
    options: { auth_svc } as unknown as RouteContext["options"],
    auth_user: auth_user ?? null,
    team_context: null,
    workspace_runtime: null,
    json: (r, status, data) => {
      sent.status = status;
      sent.data = data;
    },
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
  };

  return { ctx, sent };
}

describe("handle_auth — /api/auth/status", () => {
  it("auth_svc 없으면 enabled: false", async () => {
    const { ctx, sent } = make_ctx("GET", "/api/auth/status", null, {}, null);
    await handle_auth(ctx);
    expect(sent.status).toBe(200);
    expect((sent.data as Record<string, unknown>).enabled).toBe(false);
  });

  it("auth_svc 있고 미초기화 → initialized: false", async () => {
    const auth_svc = make_auth_svc();
    const { ctx, sent } = make_ctx("GET", "/api/auth/status", null, {}, auth_svc);
    await handle_auth(ctx);
    expect(sent.status).toBe(200);
    expect((sent.data as Record<string, unknown>).initialized).toBe(false);
  });

  it("auth_svc 있고 초기화됨 → initialized: true", async () => {
    const auth_svc = make_auth_svc();
    await auth_svc.setup_superadmin("admin", "password1");
    const { ctx, sent } = make_ctx("GET", "/api/auth/status", null, {}, auth_svc);
    await handle_auth(ctx);
    expect((sent.data as Record<string, unknown>).initialized).toBe(true);
  });
});

describe("handle_auth — /api/auth/setup", () => {
  it("미초기화 상태에서 setup 성공 → 201, ok: true", async () => {
    const auth_svc = make_auth_svc();
    const { ctx, sent } = make_ctx("POST", "/api/auth/setup",
      { username: "admin", password: "secret1" }, {}, auth_svc);
    await handle_auth(ctx);
    expect(sent.status).toBe(201);
    expect((sent.data as Record<string, unknown>).ok).toBe(true);
    expect((sent.data as Record<string, unknown>).role).toBe("superadmin");
  });

  it("이미 초기화된 경우 → 409", async () => {
    const auth_svc = make_auth_svc();
    await auth_svc.setup_superadmin("admin", "password1");
    const { ctx, sent } = make_ctx("POST", "/api/auth/setup",
      { username: "admin2", password: "password2" }, {}, auth_svc);
    await handle_auth(ctx);
    expect(sent.status).toBe(409);
  });

  it("비밀번호 6자 미만 → 400", async () => {
    const auth_svc = make_auth_svc();
    const { ctx, sent } = make_ctx("POST", "/api/auth/setup",
      { username: "admin", password: "abc" }, {}, auth_svc);
    await handle_auth(ctx);
    expect(sent.status).toBe(400);
  });

  it("auth_svc 없으면 → 503", async () => {
    const { ctx, sent } = make_ctx("POST", "/api/auth/setup",
      { username: "admin", password: "secret1" }, {}, null);
    await handle_auth(ctx);
    expect(sent.status).toBe(503);
  });
});

describe("handle_auth — /api/auth/login", () => {
  it("올바른 자격증명 → 200 + 쿠키 설정", async () => {
    const auth_svc = make_auth_svc();
    await auth_svc.setup_superadmin("admin", "secret123");

    const { ctx, sent } = make_ctx("POST", "/api/auth/login",
      { username: "admin", password: "secret123" }, {}, auth_svc);
    await handle_auth(ctx);
    expect(sent.status).toBe(200);
    expect((sent.data as Record<string, unknown>).ok).toBe(true);
    expect((ctx.res as unknown as { setHeader: ReturnType<typeof vi.fn> }).setHeader).toHaveBeenCalledWith(
      "Set-Cookie", expect.stringContaining("sf_token=")
    );
  });

  it("틀린 비밀번호 → 401", async () => {
    const auth_svc = make_auth_svc();
    await auth_svc.setup_superadmin("admin", "secret123");

    const { ctx, sent } = make_ctx("POST", "/api/auth/login",
      { username: "admin", password: "wrong" }, {}, auth_svc);
    await handle_auth(ctx);
    expect(sent.status).toBe(401);
  });
});

describe("handle_auth — /api/auth/logout", () => {
  it("logout → 200 + 쿠키 삭제 헤더", async () => {
    const { ctx, sent } = make_ctx("POST", "/api/auth/logout", null, {}, null);
    await handle_auth(ctx);
    expect(sent.status).toBe(200);
    expect((ctx.res as unknown as { setHeader: ReturnType<typeof vi.fn> }).setHeader).toHaveBeenCalledWith(
      "Set-Cookie", expect.stringContaining("Max-Age=0")
    );
  });
});

describe("handle_auth — /api/auth/me", () => {
  it("유효한 토큰 → 200 + 사용자 정보 (미들웨어가 auth_user 주입)", async () => {
    const auth_svc = make_auth_svc();
    const result = await auth_svc.setup_superadmin("admin", "secret123");
    // 실제 환경에서는 service.ts 미들웨어가 auth_user를 주입; 테스트에서 직접 주입
    const { ctx, sent } = make_ctx("GET", "/api/auth/me", null,
      {}, auth_svc, result!.payload);
    await handle_auth(ctx);
    expect(sent.status).toBe(200);
    expect((sent.data as Record<string, unknown>).username).toBe("admin");
    expect((sent.data as Record<string, unknown>).role).toBe("superadmin");
    expect((sent.data as Record<string, unknown>).tid).toBe("default");
  });

  it("auth_user 없음 → 401", async () => {
    const auth_svc = make_auth_svc();
    await auth_svc.setup_superadmin("admin", "secret123");
    const { ctx, sent } = make_ctx("GET", "/api/auth/me", null, {}, auth_svc, null);
    await handle_auth(ctx);
    expect(sent.status).toBe(401);
  });
});

describe("handle_auth — 관련 없는 경로는 false 반환", () => {
  it("/api/tasks → false", async () => {
    const { ctx } = make_ctx("GET", "/api/tasks", null, {}, null);
    const result = await handle_auth(ctx);
    expect(result).toBe(false);
  });
});
