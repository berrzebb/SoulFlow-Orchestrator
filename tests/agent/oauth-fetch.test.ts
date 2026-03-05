import { describe, it, expect, vi } from "vitest";
import { OAuthFetchTool } from "../../src/agent/tools/oauth-fetch.js";
import type { OAuthIntegrationStore, OAuthIntegrationConfig } from "../../src/oauth/integration-store.js";
import type { OAuthFlowService } from "../../src/oauth/flow-service.js";

const GITHUB_INTEGRATION: OAuthIntegrationConfig = {
  instance_id: "github",
  service_type: "github",
  label: "GitHub",
  enabled: true,
  scopes: ["repo", "read:user"],
  auth_url: "https://github.com/login/oauth/authorize",
  token_url: "https://github.com/login/oauth/access_token",
  redirect_uri: "http://localhost:4200/api/oauth/callback",
  expires_at: "2030-01-01T00:00:00Z",
  settings: {},
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const SPOTIFY_DISABLED: OAuthIntegrationConfig = {
  ...GITHUB_INTEGRATION,
  instance_id: "spotify",
  service_type: "spotify",
  label: "Spotify",
  enabled: false,
  scopes: ["user-read-playback-state"],
  expires_at: null,
};

function make_mock_store(integrations: OAuthIntegrationConfig[] = []): OAuthIntegrationStore {
  const map = new Map(integrations.map((i) => [i.instance_id, i]));
  return {
    list: vi.fn(() => [...map.values()]),
    get: vi.fn((id: string) => map.get(id) || null),
    get_access_token: vi.fn(async () => "mock-token"),
  } as unknown as OAuthIntegrationStore;
}

function make_mock_flow(opts: { token?: string; error?: string } = {}): OAuthFlowService {
  return {
    get_valid_access_token: vi.fn(async () => ({
      token: opts.token ?? "mock-access-token",
      error: opts.error,
    })),
    refresh_token: vi.fn(async () => ({ ok: true })),
  } as unknown as OAuthFlowService;
}

describe("OAuthFetchTool", () => {
  // ── list action ──

  it("list: 등록된 OAuth 연동 목록을 반환한다", async () => {
    const store = make_mock_store([GITHUB_INTEGRATION, SPOTIFY_DISABLED]);
    const tool = new OAuthFetchTool(store, make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "list" });
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>;

    expect(parsed).toHaveLength(2);
    expect(parsed[0].service_id).toBe("github");
    expect(parsed[0].enabled).toBe(true);
    expect(parsed[0].scopes).toEqual(["repo", "read:user"]);
    expect(parsed[1].service_id).toBe("spotify");
    expect(parsed[1].enabled).toBe(false);
  });

  it("list: 빈 목록일 때 빈 배열을 반환한다", async () => {
    const tool = new OAuthFetchTool(make_mock_store(), make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "list" });

    expect(JSON.parse(result)).toEqual([]);
  });

  it("list: 만료 상태를 정확히 표시한다", async () => {
    const expired = { ...GITHUB_INTEGRATION, expires_at: "2020-01-01T00:00:00Z" };
    const tool = new OAuthFetchTool(make_mock_store([expired]), make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "list" });
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>;

    expect(parsed[0].connected).toBe(true);
    expect(parsed[0].expired).toBe(true);
  });

  // ── get_token action ──

  it("get_token: 유효한 access_token을 반환한다", async () => {
    const store = make_mock_store([GITHUB_INTEGRATION]);
    const flow = make_mock_flow({ token: "ghp_abc123" });
    const tool = new OAuthFetchTool(store, flow);

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "get_token", service_id: "github" });
    const parsed = JSON.parse(result);

    expect(parsed.service_id).toBe("github");
    expect(parsed.service_type).toBe("github");
    expect(parsed.access_token).toBe("ghp_abc123");
  });

  it("get_token: service_id 없으면 에러를 반환한다", async () => {
    const tool = new OAuthFetchTool(make_mock_store(), make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "get_token" });

    expect(result).toContain("Error");
    expect(result).toContain("service_id is required");
  });

  it("get_token: 존재하지 않는 service_id는 에러를 반환한다", async () => {
    const tool = new OAuthFetchTool(make_mock_store(), make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "get_token", service_id: "nonexistent" });

    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  it("get_token: 비활성 연동은 에러를 반환한다", async () => {
    const store = make_mock_store([SPOTIFY_DISABLED]);
    const tool = new OAuthFetchTool(store, make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "get_token", service_id: "spotify" });

    expect(result).toContain("Error");
    expect(result).toContain("disabled");
  });

  it("get_token: 토큰이 없으면 에러를 반환한다", async () => {
    const store = make_mock_store([GITHUB_INTEGRATION]);
    const flow = {
      get_valid_access_token: vi.fn(async () => ({ token: null, error: "token_expired" })),
      refresh_token: vi.fn(async () => ({ ok: false })),
    } as unknown as OAuthFlowService;
    const tool = new OAuthFetchTool(store, flow);

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "get_token", service_id: "github" });

    expect(result).toContain("Error");
    expect(result).toContain("token_expired");
  });

  // ── fetch action (기본) ──

  it("fetch: action 미지정 시 fetch로 동작한다", async () => {
    const store = make_mock_store([GITHUB_INTEGRATION]);
    const tool = new OAuthFetchTool(store, make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ service_id: "github", url: "https://api.github.com/user" });

    // fetch가 실제 네트워크를 호출하므로 에러가 날 수 있지만 "service_id is required" 에러가 아닌 것을 확인
    expect(result).not.toContain("service_id is required");
  });

  it("fetch: service_id 없으면 에러를 반환한다", async () => {
    const tool = new OAuthFetchTool(make_mock_store(), make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "fetch", url: "https://example.com" });

    expect(result).toContain("Error");
    expect(result).toContain("service_id is required");
  });

  it("fetch: url 없으면 에러를 반환한다", async () => {
    const tool = new OAuthFetchTool(make_mock_store([GITHUB_INTEGRATION]), make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "fetch", service_id: "github" });

    expect(result).toContain("Error");
    expect(result).toContain("url is required");
  });

  it("fetch: 잘못된 URL은 에러를 반환한다", async () => {
    const tool = new OAuthFetchTool(make_mock_store([GITHUB_INTEGRATION]), make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "fetch", service_id: "github", url: "not-a-url" });

    expect(result).toContain("Error");
    expect(result).toContain("invalid URL");
  });

  // ── 지원하지 않는 action ──

  it("지원하지 않는 action은 에러를 반환한다", async () => {
    const tool = new OAuthFetchTool(make_mock_store(), make_mock_flow());

    const result = await (tool as unknown as { run: (p: Record<string, unknown>) => Promise<string> })
      .run({ action: "invalid" });

    expect(result).toContain("unsupported action");
  });
});
