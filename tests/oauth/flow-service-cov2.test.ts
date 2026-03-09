/**
 * OAuthFlowService — 미커버 분기 보충.
 * handle_callback: 만료 플로우, exchange 에러,
 * refresh_token: 실패, test_token: HTTP 에러/fetch 에러,
 * get_valid_access_token: 만료 후 refresh 실패,
 * _post_token: basic auth, _prune_expired, load/register/unregister preset.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OAuthFlowService } from "@src/oauth/flow-service.js";
import type { OAuthIntegrationStore, OAuthIntegrationConfig } from "@src/oauth/integration-store.js";
import { register_preset, unregister_preset } from "@src/oauth/presets.js";

// ── mock 헬퍼 ──────────────────────────────────────────────────

function make_config(overrides: Partial<OAuthIntegrationConfig> = {}): OAuthIntegrationConfig {
  return {
    instance_id: "inst-1",
    service_type: "github",
    label: "GitHub Test",
    enabled: true,
    scopes: ["read:user"],
    auth_url: "https://github.com/login/oauth/authorize",
    token_url: "https://github.com/login/oauth/access_token",
    redirect_uri: "https://app.example.com/callback",
    expires_at: null,
    settings: {},
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function make_store(overrides: Partial<OAuthIntegrationStore> = {}): OAuthIntegrationStore {
  return {
    list: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    upsert: vi.fn(),
    delete: vi.fn(),
    update_settings: vi.fn().mockReturnValue(false),
    update_expires_at: vi.fn(),
    is_expired: vi.fn().mockReturnValue(false),
    get_access_token: vi.fn().mockResolvedValue(null),
    get_refresh_token: vi.fn().mockResolvedValue(null),
    get_client_id: vi.fn().mockResolvedValue("client-id"),
    get_client_secret: vi.fn().mockResolvedValue("client-secret"),
    set_tokens: vi.fn(),
    load_presets: vi.fn().mockReturnValue([]),
    save_preset: vi.fn(),
    remove_preset: vi.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as OAuthIntegrationStore;
}

let service: OAuthFlowService;
let store: OAuthIntegrationStore;
let fetch_mock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = make_store();
  service = new OAuthFlowService(store);
  fetch_mock = vi.fn();
  vi.stubGlobal("fetch", fetch_mock);
});

afterEach(() => {
  service.close();
  vi.unstubAllGlobals();
});

// ══════════════════════════════════════════
// handle_callback — 만료된 플로우
// ══════════════════════════════════════════

describe("OAuthFlowService — handle_callback 만료 플로우", () => {
  it("TTL 만료된 state → flow_expired 에러", async () => {
    const state = "expired-state";
    (service as any).pending_flows.set(state, {
      instance_id: "inst-1",
      created_at: Date.now() - 11 * 60 * 1000, // 11분 전
    });

    const r = await service.handle_callback("some-code", state);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("flow_expired");
  });
});

// ══════════════════════════════════════════
// handle_callback — integration not found
// ══════════════════════════════════════════

describe("OAuthFlowService — handle_callback integration_not_found", () => {
  it("pending flow 있지만 integration 없음 → integration_not_found", async () => {
    const state = "orphan-state";
    (service as any).pending_flows.set(state, {
      instance_id: "nonexistent",
      created_at: Date.now(),
    });
    // store.get는 기본 null 반환

    const r = await service.handle_callback("some-code", state);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("integration_not_found");
  });
});

// ══════════════════════════════════════════
// handle_callback — missing_client_id
// ══════════════════════════════════════════

describe("OAuthFlowService — handle_callback missing_client_id", () => {
  it("client_id null → missing_client_id", async () => {
    const config = make_config();
    store = make_store({
      get: vi.fn().mockReturnValue(config),
      get_client_id: vi.fn().mockResolvedValue(null),
    });
    service = new OAuthFlowService(store);

    const state = "no-client-state";
    (service as any).pending_flows.set(state, { instance_id: "inst-1", created_at: Date.now() });

    const r = await service.handle_callback("code", state);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_client_id");
  });
});

// ══════════════════════════════════════════
// handle_callback — exchange 에러
// ══════════════════════════════════════════

describe("OAuthFlowService — handle_callback exchange 에러", () => {
  it("token exchange fetch 실패 → error 반환", async () => {
    fetch_mock.mockRejectedValueOnce(new Error("Network error"));

    const config = make_config();
    store = make_store({ get: vi.fn().mockReturnValue(config) });
    service = new OAuthFlowService(store);

    const state = "exchange-fail-state";
    (service as any).pending_flows.set(state, { instance_id: "inst-1", created_at: Date.now() });

    const r = await service.handle_callback("code", state);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Network error");
  });

  it("token exchange 응답에 error 필드 → throw", async () => {
    fetch_mock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant", error_description: "Code expired" }),
    });

    const config = make_config();
    store = make_store({ get: vi.fn().mockReturnValue(config) });
    service = new OAuthFlowService(store);

    const state = "bad-code-state";
    (service as any).pending_flows.set(state, { instance_id: "inst-1", created_at: Date.now() });

    const r = await service.handle_callback("bad-code", state);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Code expired");
  });
});

// ══════════════════════════════════════════
// refresh_token — 실패 경로
// ══════════════════════════════════════════

describe("OAuthFlowService — refresh_token 실패", () => {
  it("no refresh_token → no_refresh_token", async () => {
    store = make_store({
      get: vi.fn().mockReturnValue(make_config()),
      get_refresh_token: vi.fn().mockResolvedValue(null),
    });
    service = new OAuthFlowService(store);

    const r = await service.refresh_token("inst-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no_refresh_token");
  });

  it("missing client credentials → missing_client_credentials", async () => {
    store = make_store({
      get: vi.fn().mockReturnValue(make_config()),
      get_refresh_token: vi.fn().mockResolvedValue("refresh-token"),
      get_client_id: vi.fn().mockResolvedValue(null),
    });
    service = new OAuthFlowService(store);

    const r = await service.refresh_token("inst-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_client_credentials");
  });

  it("fetch 실패 → error 반환", async () => {
    fetch_mock.mockRejectedValueOnce(new Error("Refresh network error"));
    store = make_store({
      get: vi.fn().mockReturnValue(make_config()),
      get_refresh_token: vi.fn().mockResolvedValue("refresh-token"),
    });
    service = new OAuthFlowService(store);

    const r = await service.refresh_token("inst-1");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Refresh network error");
  });
});

// ══════════════════════════════════════════
// test_token — HTTP 에러/fetch 에러
// ══════════════════════════════════════════

describe("OAuthFlowService — test_token 에러 경로", () => {
  beforeEach(() => {
    // test_url을 가진 프리셋 등록
    register_preset({
      service_type: "test_with_url",
      label: "Test With URL",
      auth_url: "https://test.example.com/auth",
      token_url: "https://test.example.com/token",
      scopes_available: [],
      default_scopes: [],
      supports_refresh: true,
      test_url: "https://test.example.com/me",
    });
  });

  afterEach(() => {
    unregister_preset("test_with_url");
  });

  it("HTTP 500 응답 → 'HTTP 500' 에러", async () => {
    fetch_mock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    store = make_store({
      get: vi.fn().mockReturnValue(make_config({ service_type: "test_with_url", token_url: "https://test.example.com/token" })),
      get_access_token: vi.fn().mockResolvedValue("some-token"),
    });
    service = new OAuthFlowService(store);

    const r = await service.test_token("inst-1");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("HTTP 500");
  });

  it("HTTP 401 응답 → token_invalid_or_expired", async () => {
    fetch_mock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    store = make_store({
      get: vi.fn().mockReturnValue(make_config({ service_type: "test_with_url" })),
      get_access_token: vi.fn().mockResolvedValue("some-token"),
    });
    service = new OAuthFlowService(store);

    const r = await service.test_token("inst-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("token_invalid_or_expired");
  });

  it("fetch throw → error 반환", async () => {
    fetch_mock.mockRejectedValueOnce(new Error("fetch failed"));

    store = make_store({
      get: vi.fn().mockReturnValue(make_config({ service_type: "test_with_url" })),
      get_access_token: vi.fn().mockResolvedValue("some-token"),
    });
    service = new OAuthFlowService(store);

    const r = await service.test_token("inst-1");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("fetch failed");
  });
});

// ══════════════════════════════════════════
// get_valid_access_token — 만료 후 refresh 실패
// ══════════════════════════════════════════

describe("OAuthFlowService — get_valid_access_token 만료 refresh 실패", () => {
  it("토큰 만료 → refresh 실패 → token=null", async () => {
    fetch_mock.mockRejectedValueOnce(new Error("Refresh failed"));

    store = make_store({
      get: vi.fn().mockReturnValue(make_config()),
      is_expired: vi.fn().mockReturnValue(true),
      get_refresh_token: vi.fn().mockResolvedValue("expired-refresh"),
    });
    service = new OAuthFlowService(store);

    const r = await service.get_valid_access_token("inst-1");
    expect(r.token).toBeNull();
    expect(r.error).toContain("refresh_failed");
  });

  it("integration_not_found → token=null", async () => {
    const r = await service.get_valid_access_token("nonexistent");
    expect(r.token).toBeNull();
    expect(r.error).toBe("integration_not_found");
  });
});

// ══════════════════════════════════════════
// _post_token — basic auth 메서드
// ══════════════════════════════════════════

describe("OAuthFlowService — _post_token basic auth", () => {
  it("token_auth_method='basic' → Authorization: Basic 헤더 사용", async () => {
    register_preset({
      service_type: "test_basic_preset",
      label: "Test Basic",
      auth_url: "https://basic.example.com/auth",
      token_url: "https://basic.example.com/token",
      scopes_available: [],
      default_scopes: [],
      supports_refresh: true,
      token_auth_method: "basic",
    });

    let captured_headers: Record<string, string> = {};
    fetch_mock.mockImplementationOnce(async (_url: string, opts: { headers?: Record<string, string> }) => {
      captured_headers = opts?.headers || {};
      return { ok: true, status: 200, json: async () => ({ access_token: "new-token", expires_in: 3600 }) };
    });

    store = make_store({
      get: vi.fn().mockReturnValue(make_config({ service_type: "test_basic_preset", token_url: "https://basic.example.com/token" })),
      get_refresh_token: vi.fn().mockResolvedValue("valid-refresh"),
    });
    service = new OAuthFlowService(store);

    await service.refresh_token("inst-1");

    expect(captured_headers["Authorization"]).toMatch(/^Basic /);

    unregister_preset("test_basic_preset");
  });
});

// ══════════════════════════════════════════
// _prune_expired — 만료 플로우 정리
// ══════════════════════════════════════════

describe("OAuthFlowService — _prune_expired 만료 정리", () => {
  it("만료된 pending flow 제거", () => {
    (service as any).pending_flows.set("old-state", {
      instance_id: "old",
      created_at: Date.now() - 15 * 60 * 1000, // 15분 전
    });
    (service as any).pending_flows.set("fresh-state", {
      instance_id: "fresh",
      created_at: Date.now(),
    });

    (service as any)._prune_expired();

    expect((service as any).pending_flows.has("old-state")).toBe(false);
    expect((service as any).pending_flows.has("fresh-state")).toBe(true);
  });
});

// ══════════════════════════════════════════
// 커스텀 프리셋 관리
// ══════════════════════════════════════════

describe("OAuthFlowService — 커스텀 프리셋 관리", () => {
  it("load_custom_presets → store.load_presets 결과 레지스트리에 로드", () => {
    store = make_store({
      load_presets: vi.fn().mockReturnValue([{
        service_type: "loaded_preset",
        label: "Loaded",
        auth_url: "https://loaded.example.com/auth",
        token_url: "https://loaded.example.com/token",
        scopes_available: [],
        default_scopes: [],
        supports_refresh: false,
      }]),
    });
    service = new OAuthFlowService(store);

    expect(() => service.load_custom_presets()).not.toThrow();
    unregister_preset("loaded_preset");
  });

  it("register_custom_preset → store.save_preset 호출됨", () => {
    service.register_custom_preset({
      service_type: "custom_svc",
      label: "Custom",
      auth_url: "https://custom.example.com/auth",
      token_url: "https://custom.example.com/token",
      scopes_available: [],
      default_scopes: [],
      supports_refresh: true,
    });

    expect(store.save_preset).toHaveBeenCalled();
    unregister_preset("custom_svc");
  });

  it("unregister_custom_preset → store.remove_preset 호출됨", () => {
    (store.remove_preset as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const result = service.unregister_custom_preset("some_service");
    expect(store.remove_preset).toHaveBeenCalledWith("some_service");
    expect(result).toBe(true);
  });

  it("generate_auth_url_with_client_id → client_id가 URL에 포함", () => {
    const config = make_config();
    const url = service.generate_auth_url_with_client_id(config, "my_client_id");
    expect(url).toContain("client_id=my_client_id");
  });
});

// ══════════════════════════════════════════
// L238: exchange_code_for_token — access_token 없음 → throw
// ══════════════════════════════════════════

describe("OAuthFlowService — _exchange_code: access_token 없음 (L238)", () => {
  it("_post_token이 access_token 없는 응답 → throw Error (L238)", async () => {
    const config = make_config();
    (service as any)._post_token = vi.fn().mockResolvedValue({
      error: "invalid_client",
      error_description: "bad client credentials",
    });
    await expect(
      (service as any)._exchange_code(config, "auth_code", "client_id", "client_secret"),
    ).rejects.toThrow("bad client credentials");
  });

  it("error_description 없음 → error 필드 사용 (L238)", async () => {
    const config = make_config();
    (service as any)._post_token = vi.fn().mockResolvedValue({
      error: "access_denied",
    });
    await expect(
      (service as any)._exchange_code(config, "auth_code", "client_id", "client_secret"),
    ).rejects.toThrow("access_denied");
  });
});
