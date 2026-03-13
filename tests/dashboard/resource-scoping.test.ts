/**
 * Step 5: 3-tier resource scoping — superadmin guard + secret namespacing 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import type { RouteContext } from "@src/dashboard/route-context.ts";
import { handle_config } from "@src/dashboard/routes/config.ts";
import { handle_models } from "@src/dashboard/routes/models.ts";
import { handle_oauth } from "@src/dashboard/routes/oauth.ts";
import { handle_channel } from "@src/dashboard/routes/channel.ts";
import { handle_agent_provider } from "@src/dashboard/routes/agent-provider.ts";
import { handle_secret } from "@src/dashboard/routes/secret.ts";

// ── helpers ──

function make_res() {
  const data: { status: number; body: unknown } = { status: 0, body: null };
  return {
    _data: data,
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    end: vi.fn(),
  };
}

function make_ctx(overrides: Record<string, unknown> = {}): RouteContext {
  const res = overrides.res ?? make_res();
  const responses: Array<{ status: number; body: unknown }> = [];
  return {
    req: {
      method: overrides.method ?? "GET",
      headers: {},
      on: vi.fn(),
    },
    res,
    url: new URL(String(overrides.pathname ?? "/"), "http://localhost"),
    options: {
      auth_svc: Object.prototype.hasOwnProperty.call(overrides, "auth_svc") ? overrides.auth_svc : {},
      config_ops: Object.prototype.hasOwnProperty.call(overrides, "config_ops") ? overrides.config_ops : null,
      model_ops: Object.prototype.hasOwnProperty.call(overrides, "model_ops") ? overrides.model_ops : null,
      oauth_ops: Object.prototype.hasOwnProperty.call(overrides, "oauth_ops") ? overrides.oauth_ops : null,
      channel_ops: Object.prototype.hasOwnProperty.call(overrides, "channel_ops") ? overrides.channel_ops : null,
      agent_provider_ops: Object.prototype.hasOwnProperty.call(overrides, "agent_provider_ops") ? overrides.agent_provider_ops : null,
      secrets: Object.prototype.hasOwnProperty.call(overrides, "secrets") ? overrides.secrets : null,
    },
    auth_user: overrides.auth_user ?? null,
    team_context: overrides.team_context ?? null,
    workspace_runtime: null,
    workspace_layers: [],
    personal_dir: "",
    json: vi.fn((_res: unknown, status: number, body: unknown) => {
      responses.push({ status, body });
    }),
    read_body: vi.fn(async () => overrides.body ?? null),
    add_sse_client: vi.fn(),
    build_state: vi.fn(),
    build_merged_tasks: vi.fn(),
    recent_messages: [],
    metrics: {} as never,
    chat_sessions: new Map(),
    session_store: null,
    session_store_key: () => "",
    register_media_token: () => null,
    oauth_callback_html: () => "",
    resolve_request_origin: () => "http://localhost",
    bus: null,
    add_rich_stream_listener: () => () => {},
    _responses: responses,
  } as unknown as RouteContext & { _responses: Array<{ status: number; body: unknown }> };
}

function last_response(ctx: RouteContext & { _responses?: Array<{ status: number; body: unknown }> }) {
  const arr = (ctx as unknown as { _responses: Array<{ status: number; body: unknown }> })._responses;
  return arr[arr.length - 1];
}

// ══════════════════════════════════════════
// Infrastructure guards — config, models, oauth
// ══════════════════════════════════════════

describe("config.ts — superadmin guard", () => {
  it("GET /api/config → 일반 유저도 접근 가능", async () => {
    const ctx = make_ctx({
      method: "GET",
      pathname: "/api/config",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      config_ops: { get_current_config: () => ({}), get_sections: async () => [] },
    });
    const handled = await handle_config(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(200);
  });

  it("PUT /api/config/values → 비superadmin 403", async () => {
    const ctx = make_ctx({
      method: "PUT",
      pathname: "/api/config/values",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      config_ops: { set_value: vi.fn() },
      body: { path: "some.key", value: "val" },
    });
    const handled = await handle_config(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(403);
  });

  it("PUT /api/config/values → superadmin 허용", async () => {
    const ctx = make_ctx({
      method: "PUT",
      pathname: "/api/config/values",
      auth_user: { role: "superadmin", sub: "admin1" },
      config_ops: { set_value: vi.fn() },
      body: { path: "some.key", value: "val" },
    });
    const handled = await handle_config(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(200);
  });
});

describe("models.ts — superadmin guard", () => {
  it("GET /api/models → 일반 유저도 접근 가능", async () => {
    const ctx = make_ctx({
      method: "GET",
      pathname: "/api/models",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      model_ops: { list: async () => [] },
    });
    const handled = await handle_models(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(200);
  });

  it("DELETE /api/models/test-model → 비superadmin 403", async () => {
    const ctx = make_ctx({
      method: "DELETE",
      pathname: "/api/models/test-model",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      model_ops: { delete: vi.fn() },
    });
    const handled = await handle_models(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(403);
  });
});

describe("oauth.ts — superadmin guard", () => {
  it("GET /api/oauth/presets → 일반 유저도 접근 가능", async () => {
    const ctx = make_ctx({
      method: "GET",
      pathname: "/api/oauth/presets",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      oauth_ops: { list_presets: () => [] },
    });
    const handled = await handle_oauth(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(200);
  });

  it("POST /api/oauth/integrations → 비superadmin 403", async () => {
    const ctx = make_ctx({
      method: "POST",
      pathname: "/api/oauth/integrations",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      oauth_ops: { create: vi.fn() },
      body: { service_type: "github", label: "GH" },
    });
    const handled = await handle_oauth(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(403);
  });
});

// ══════════════════════════════════════════
// Resource guards — channel, agent-provider
// ══════════════════════════════════════════

describe("channel.ts — team manager permission", () => {
  it("GET /api/channels/status → 일반 유저도 접근 가능", async () => {
    const ctx = make_ctx({
      method: "GET",
      pathname: "/api/channels/status",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      channel_ops: { list: async () => [] },
    });
    const handled = await handle_channel(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(200);
  });

  it("POST /api/channels/instances → member(비manager) 403", async () => {
    const ctx = make_ctx({
      method: "POST",
      pathname: "/api/channels/instances",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: { team_id: "t1", team_role: "member" },
      channel_ops: { create: vi.fn(async () => ({ ok: true })) },
      body: { instance_id: "ch1", provider: "slack" },
    });
    const handled = await handle_channel(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(403);
  });

  it("POST /api/channels/instances → team manager 허용", async () => {
    const create_spy = vi.fn(async () => ({ ok: true }));
    const ctx = make_ctx({
      method: "POST",
      pathname: "/api/channels/instances",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: { team_id: "t1", team_role: "manager" },
      channel_ops: { create: create_spy },
      body: { instance_id: "ch1", provider: "slack" },
    });
    const handled = await handle_channel(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(201);
  });

  it("POST /api/channels/instances → team owner 허용", async () => {
    const create_spy = vi.fn(async () => ({ ok: true }));
    const ctx = make_ctx({
      method: "POST",
      pathname: "/api/channels/instances",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: { team_id: "t1", team_role: "owner" },
      channel_ops: { create: create_spy },
      body: { instance_id: "ch1", provider: "slack" },
    });
    const handled = await handle_channel(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(201);
  });

  it("PUT /api/channels/instances/:id → team manager 허용", async () => {
    const update_spy = vi.fn(async () => ({ ok: true }));
    const ctx = make_ctx({
      method: "PUT",
      pathname: "/api/channels/instances/ch1",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: { team_id: "t1", team_role: "manager" },
      channel_ops: { update: update_spy },
      body: { label: "updated" },
    });
    const handled = await handle_channel(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(200);
  });

  it("DELETE /api/channels/instances/:id → viewer 403", async () => {
    const ctx = make_ctx({
      method: "DELETE",
      pathname: "/api/channels/instances/ch1",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: { team_id: "t1", team_role: "viewer" },
      channel_ops: { remove: vi.fn(async () => ({ ok: true })) },
    });
    const handled = await handle_channel(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(403);
  });

  it("POST /api/channels/instances → superadmin 허용", async () => {
    const create_spy = vi.fn(async () => ({ ok: true }));
    const ctx = make_ctx({
      method: "POST",
      pathname: "/api/channels/instances",
      auth_user: { role: "superadmin", sub: "admin1" },
      channel_ops: { create: create_spy },
      body: { instance_id: "ch1", provider: "slack" },
    });
    const handled = await handle_channel(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(201);
  });

  it("auth 비활성(싱글유저) → 쓰기 통과", async () => {
    const create_spy = vi.fn(async () => ({ ok: true }));
    const ctx = make_ctx({
      method: "POST",
      pathname: "/api/channels/instances",
      auth_svc: null,
      channel_ops: { create: create_spy },
      body: { instance_id: "ch1", provider: "slack" },
    });
    const handled = await handle_channel(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(201);
  });
});

describe("agent-provider.ts — superadmin guard for mutations", () => {
  it("GET /api/agents/providers → 일반 유저도 접근 가능", async () => {
    const ctx = make_ctx({
      method: "GET",
      pathname: "/api/agents/providers",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      agent_provider_ops: { list: async () => [] },
    });
    const handled = await handle_agent_provider(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(200);
  });

  it("POST /api/agents/providers → 비superadmin 403", async () => {
    const ctx = make_ctx({
      method: "POST",
      pathname: "/api/agents/providers",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      agent_provider_ops: { create: vi.fn() },
      body: { instance_id: "p1", provider_type: "openai" },
    });
    const handled = await handle_agent_provider(ctx);
    expect(handled).toBe(true);
    expect(last_response(ctx).status).toBe(403);
  });
});

// ══════════════════════════════════════════
// Secret namespacing
// ══════════════════════════════════════════

describe("secret.ts — team-scoped namespacing", () => {
  it("POST /api/secrets → 비superadmin: team prefix 자동 추가", async () => {
    const put_spy = vi.fn(async () => ({ ok: true }));
    const ctx = make_ctx({
      method: "POST",
      pathname: "/api/secrets",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: { team_id: "team-alpha", team_role: "member" },
      secrets: { put_secret: put_spy, list_names: vi.fn(), remove_secret: vi.fn() },
      body: { name: "my_key", value: "secret123" },
    });
    const handled = await handle_secret(ctx);
    expect(handled).toBe(true);
    expect(put_spy).toHaveBeenCalledWith("team:team-alpha:my_key", "secret123");
  });

  it("GET /api/secrets → 비superadmin: 자기 팀 시크릿만 표시 (prefix strip)", async () => {
    const list_spy = vi.fn(async () => [
      "team:team-alpha:key1",
      "team:team-alpha:key2",
      "team:team-beta:other",
      "global_key",
    ]);
    const ctx = make_ctx({
      method: "GET",
      pathname: "/api/secrets",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: { team_id: "team-alpha", team_role: "member" },
      secrets: { list_names: list_spy, put_secret: vi.fn(), remove_secret: vi.fn() },
    });
    const handled = await handle_secret(ctx);
    expect(handled).toBe(true);
    const resp = last_response(ctx);
    expect(resp.status).toBe(200);
    // 자기 팀 시크릿만 보이고, prefix가 strip됨
    expect((resp.body as { names: string[] }).names).toEqual(["key1", "key2"]);
  });

  it("GET /api/secrets → superadmin: 모든 시크릿 원본 이름 표시", async () => {
    const list_spy = vi.fn(async () => [
      "team:team-alpha:key1",
      "team:team-beta:other",
      "global_key",
    ]);
    const ctx = make_ctx({
      method: "GET",
      pathname: "/api/secrets",
      auth_user: { role: "superadmin", sub: "admin1" },
      secrets: { list_names: list_spy, put_secret: vi.fn(), remove_secret: vi.fn() },
    });
    const handled = await handle_secret(ctx);
    expect(handled).toBe(true);
    const resp = last_response(ctx);
    expect(resp.status).toBe(200);
    // superadmin은 모든 시크릿을 원본 이름으로 봄
    expect((resp.body as { names: string[] }).names).toEqual([
      "team:team-alpha:key1",
      "team:team-beta:other",
      "global_key",
    ]);
  });

  it("DELETE /api/secrets/:name → 비superadmin: team prefix 자동 추가", async () => {
    const remove_spy = vi.fn(async () => true);
    const ctx = make_ctx({
      method: "DELETE",
      pathname: "/api/secrets/my_key",
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: { team_id: "team-alpha", team_role: "member" },
      secrets: { remove_secret: remove_spy, list_names: vi.fn(), put_secret: vi.fn() },
    });
    const handled = await handle_secret(ctx);
    expect(handled).toBe(true);
    expect(remove_spy).toHaveBeenCalledWith("team:team-alpha:my_key");
  });
});
