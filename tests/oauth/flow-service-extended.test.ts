/**
 * OAuthFlowService — 미커버 경로 보충.
 * extra_auth_params, scope_separator=",", basic auth 헤더,
 * _refresh_expiring_tokens (만료 임박), _prune_expired (TTL 초과),
 * register/unregister_custom_preset.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OAuthFlowService } from "../../src/oauth/flow-service.js";
import type { OAuthIntegrationStore, OAuthIntegrationConfig } from "../../src/oauth/integration-store.js";
import { register_preset, unregister_preset } from "../../src/oauth/presets.js";

function make_config(overrides: Partial<OAuthIntegrationConfig> = {}): OAuthIntegrationConfig {
  return {
    instance_id: "inst-1",
    service_type: "test-svc-flow",
    label: "Test",
    enabled: true,
    scopes: ["read", "write"],
    auth_url: "https://example.com/auth",
    token_url: "https://example.com/token",
    redirect_uri: "https://app.example.com/cb",
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
    get_client_id: vi.fn().mockResolvedValue(null),
    get_client_secret: vi.fn().mockResolvedValue(null),
    set_tokens: vi.fn(),
    load_presets: vi.fn().mockReturnValue([]),
    save_preset: vi.fn(),
    remove_preset: vi.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as OAuthIntegrationStore;
}

let service: OAuthFlowService;
let store: OAuthIntegrationStore;

beforeEach(() => {
  store = make_store();
  service = new OAuthFlowService(store);
});

afterEach(() => {
  service.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  unregister_preset("test-svc-flow");
  unregister_preset("test-svc-basic");
});

// ══════════════════════════════════════════
// generate_auth_url — extra_auth_params + scope_separator
// ══════════════════════════════════════════

describe("OAuthFlowService — generate_auth_url 미커버 경로", () => {
  it("extra_auth_params 있는 프리셋 → URL에 추가 파라미터 포함", () => {
    register_preset({
      service_type: "test-svc-flow",
      label: "Test",
      auth_url: "https://example.com/auth",
      token_url: "https://example.com/token",
      scopes_available: ["read"],
      default_scopes: ["read"],
      supports_refresh: true,
      extra_auth_params: { access_type: "offline", prompt: "consent" },
    });
    const config = make_config();
    const url = service.generate_auth_url(config);
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
  });

  it("scope_separator=',' → 쉼표로 스코프 구분", () => {
    register_preset({
      service_type: "test-svc-flow",
      label: "Test",
      auth_url: "https://example.com/auth",
      token_url: "https://example.com/token",
      scopes_available: ["read", "write"],
      default_scopes: ["read"],
      supports_refresh: true,
      scope_separator: ",",
    });
    const config = make_config({ scopes: ["read", "write"] });
    const url = service.generate_auth_url(config);
    expect(url).toContain("scope=read%2Cwrite"); // URL-encoded comma
  });
});

// ══════════════════════════════════════════
// _post_token — basic auth 헤더
// ══════════════════════════════════════════

describe("OAuthFlowService — Basic Auth 토큰 교환", () => {
  it("token_auth_method=basic → Authorization 헤더 사용", async () => {
    register_preset({
      service_type: "test-svc-basic",
      label: "Basic Auth Svc",
      auth_url: "https://example.com/auth",
      token_url: "https://example.com/token",
      scopes_available: [],
      default_scopes: [],
      supports_refresh: true,
      token_auth_method: "basic",
    });

    const integration = make_config({ service_type: "test-svc-basic", instance_id: "inst-basic" });

    let captured_headers: Record<string, string> = {};
    const mock_fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok-basic", expires_in: 3600 }),
    });
    vi.stubGlobal("fetch", mock_fetch);

    store = make_store({
      get: vi.fn().mockReturnValue(integration),
      get_client_id: vi.fn().mockResolvedValue("my-client-id"),
      get_client_secret: vi.fn().mockResolvedValue("my-secret"),
    });
    service.close();
    service = new OAuthFlowService(store);

    // state를 수동으로 만들기 위해 generate_auth_url 호출 (state 생성 트리거)
    service.generate_auth_url(integration);

    // handle_callback으로 토큰 교환 경로 테스트
    // 하지만 state를 얻으려면 private 필드에 접근해야 함 → 인스턴스로 직접 접근
    const pending = (service as any).pending_flows as Map<string, { instance_id: string; created_at: number }>;
    const [[state]] = [...pending.entries()];

    store = make_store({
      get: vi.fn().mockReturnValue(integration),
      get_client_id: vi.fn().mockResolvedValue("my-client-id"),
      get_client_secret: vi.fn().mockResolvedValue("my-secret"),
      set_tokens: vi.fn(),
    });
    service.close();
    service = new OAuthFlowService(store);
    (service as any).pending_flows.set(state, { instance_id: "inst-basic", created_at: Date.now() });

    const result = await service.handle_callback("auth-code", state);
    expect(mock_fetch).toHaveBeenCalled();

    const call_init = mock_fetch.mock.calls[0][1] as RequestInit;
    const headers = call_init.headers as Record<string, string>;
    // basic auth에서는 Authorization 헤더 포함
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(result.ok).toBe(true);
    unregister_preset("test-svc-basic");
  });
});

// ══════════════════════════════════════════
// _refresh_expiring_tokens — 만료 임박
// ══════════════════════════════════════════

describe("OAuthFlowService — _refresh_expiring_tokens", () => {
  it("만료 임박 토큰 있으면 refresh_token 호출됨", async () => {
    const expiring_at = new Date(Date.now() + 60_000).toISOString(); // 1분 후 만료
    const config = make_config({
      instance_id: "inst-expire",
      service_type: "test-svc-flow",
      enabled: true,
      expires_at: expiring_at,
    });

    register_preset({
      service_type: "test-svc-flow",
      label: "Test",
      auth_url: "https://example.com/auth",
      token_url: "https://example.com/token",
      scopes_available: [],
      default_scopes: [],
      supports_refresh: true,
    });

    const refresh_spy = vi.fn().mockResolvedValue({ ok: true });

    store = make_store({
      list: vi.fn().mockReturnValue([config]),
    });
    service.close();
    service = new OAuthFlowService(store);
    // refresh_token을 spy로 대체
    service.refresh_token = refresh_spy;

    await (service as any)._refresh_expiring_tokens();
    expect(refresh_spy).toHaveBeenCalledWith("inst-expire");
  });

  it("만료 시간 없는 통합 → 스킵됨", async () => {
    const config = make_config({ instance_id: "no-expire", enabled: true, expires_at: null });
    store = make_store({ list: vi.fn().mockReturnValue([config]) });
    service.close();
    service = new OAuthFlowService(store);
    const refresh_spy = vi.fn();
    service.refresh_token = refresh_spy;

    await (service as any)._refresh_expiring_tokens();
    expect(refresh_spy).not.toHaveBeenCalled();
  });

  it("refresh 실패 시 warn만 기록됨 (에러 전파 없음)", async () => {
    const expiring = new Date(Date.now() + 60_000).toISOString();
    const config = make_config({ instance_id: "fail-refresh", enabled: true, expires_at: expiring });

    register_preset({
      service_type: "test-svc-flow",
      label: "T", auth_url: "", token_url: "",
      scopes_available: [], default_scopes: [],
      supports_refresh: true,
    });

    store = make_store({ list: vi.fn().mockReturnValue([config]) });
    service.close();
    service = new OAuthFlowService(store);
    service.refresh_token = vi.fn().mockResolvedValue({ ok: false, error: "network" });

    // 에러 없이 종료되어야 함
    await expect((service as any)._refresh_expiring_tokens()).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════
// _prune_expired — TTL 초과 플로우 제거
// ══════════════════════════════════════════

describe("OAuthFlowService — _prune_expired", () => {
  it("TTL 초과 pending_flow → 제거됨", () => {
    const very_old = Date.now() - 15 * 60 * 1000; // 15분 전 (TTL=10분)
    (service as any).pending_flows.set("expired-state", { instance_id: "i1", created_at: very_old });
    (service as any).pending_flows.set("fresh-state", { instance_id: "i2", created_at: Date.now() });

    (service as any)._prune_expired();

    expect((service as any).pending_flows.has("expired-state")).toBe(false);
    expect((service as any).pending_flows.has("fresh-state")).toBe(true);
  });
});

// ══════════════════════════════════════════
// register/unregister_custom_preset
// ══════════════════════════════════════════

describe("OAuthFlowService — register/unregister_custom_preset", () => {
  it("register_custom_preset → 레지스트리 + DB 저장", () => {
    const preset = {
      service_type: "test-svc-flow",
      label: "Custom", auth_url: "https://custom.com/auth", token_url: "https://custom.com/token",
      scopes_available: ["r"], default_scopes: ["r"], supports_refresh: false,
    };
    service.register_custom_preset(preset);
    expect(store.save_preset).toHaveBeenCalledWith(preset);
  });

  it("unregister_custom_preset → 레지스트리 + DB 제거", () => {
    service.unregister_custom_preset("test-svc-flow");
    expect(store.remove_preset).toHaveBeenCalledWith("test-svc-flow");
  });

  it("load_custom_presets → DB 프리셋 레지스트리에 로드", () => {
    const preset = {
      service_type: "test-svc-flow",
      label: "P", auth_url: "", token_url: "",
      scopes_available: [], default_scopes: [], supports_refresh: false,
    };
    store = make_store({ load_presets: vi.fn().mockReturnValue([preset]) });
    service.close();
    service = new OAuthFlowService(store);
    service.load_custom_presets();
    expect(store.load_presets).toHaveBeenCalled();
  });
});
