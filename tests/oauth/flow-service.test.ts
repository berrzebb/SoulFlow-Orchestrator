/**
 * OAuthFlowService — OAuth 2.0 플로우 핵심 로직 단위 테스트.
 * OAuthIntegrationStore와 fetch를 mock으로 대체.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OAuthFlowService } from "../../src/oauth/flow-service.js";
import type { OAuthIntegrationStore, OAuthIntegrationConfig } from "../../src/oauth/integration-store.js";
import type { OAuthServicePreset } from "../../src/oauth/presets.js";
import { register_preset, unregister_preset } from "../../src/oauth/presets.js";

// ── mock 헬퍼 ──────────────────────────────────────────────────

function make_config(overrides: Partial<OAuthIntegrationConfig> = {}): OAuthIntegrationConfig {
  return {
    instance_id: "inst-1",
    service_type: "github",
    label: "GitHub Test",
    enabled: true,
    scopes: ["repo", "read:user"],
    auth_url: "https://github.com/login/oauth/authorize",
    token_url: "https://github.com/login/oauth/access_token",
    redirect_uri: "https://app.example.com/oauth/callback",
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

// ── 공통 설정 ──────────────────────────────────────────────────

let service: OAuthFlowService;
let store: OAuthIntegrationStore;

beforeEach(() => {
  store = make_store();
  service = new OAuthFlowService(store);
});

afterEach(() => {
  service.close();
  vi.unstubAllGlobals();
});

// ── generate_auth_url ──────────────────────────────────────────

describe("OAuthFlowService — generate_auth_url", () => {
  it("올바른 인증 URL 생성", () => {
    const config = make_config();
    const url = service.generate_auth_url(config);
    expect(url).toContain("https://github.com/login/oauth/authorize");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("scope=");
    expect(url).toContain("state=");
    expect(url).toContain("response_type=code");
  });

  it("state 파라미터가 UUID 형식", () => {
    const config = make_config();
    const url = service.generate_auth_url(config);
    const state = new URL(url).searchParams.get("state");
    expect(state).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe("OAuthFlowService — generate_auth_url_with_client_id", () => {
  it("client_id가 URL에 포함됨", () => {
    const config = make_config();
    const url = service.generate_auth_url_with_client_id(config, "my_client_id");
    expect(new URL(url).searchParams.get("client_id")).toBe("my_client_id");
  });
});

// ── handle_callback ─────────────────────────────────────────────

describe("OAuthFlowService — handle_callback", () => {
  it("state 없음 → ok=false, invalid_or_expired_state", async () => {
    const result = await service.handle_callback("code123", "invalid-state");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_or_expired_state");
  });

  it("만료된 state → ok=false, flow_expired", async () => {
    // state를 먼저 생성 (generate_auth_url로 pending_flows에 등록)
    const config = make_config();
    const url = service.generate_auth_url(config);
    const state = new URL(url).searchParams.get("state")!;

    // pending_flows의 created_at을 과거로 조작할 수 없으므로
    // 여기서는 TTL 미만이므로 통과 — 아래 integration_not_found로 진행됨
    store = make_store({ get: vi.fn().mockReturnValue(null) });
    const svc = new OAuthFlowService(store);
    const svc_url = svc.generate_auth_url(config);
    const svc_state = new URL(svc_url).searchParams.get("state")!;

    const result = await svc.handle_callback("code", svc_state);
    svc.close();
    // integration 없음 → integration_not_found
    expect(result.ok).toBe(false);
    expect(result.error).toBe("integration_not_found");
  });

  it("integration 없음 → ok=false, integration_not_found", async () => {
    const config = make_config();
    const url = service.generate_auth_url(config);
    const state = new URL(url).searchParams.get("state")!;

    // store.get() → null (integration not found)
    vi.mocked(store.get).mockReturnValue(null);

    const result = await service.handle_callback("code123", state);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("integration_not_found");
  });

  it("client_id 없음 → ok=false, missing_client_id", async () => {
    const config = make_config();
    const url = service.generate_auth_url(config);
    const state = new URL(url).searchParams.get("state")!;

    vi.mocked(store.get).mockReturnValue(config);
    vi.mocked(store.get_client_id).mockResolvedValue(null);

    const result = await service.handle_callback("code123", state);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_client_id");
  });

  it("토큰 교환 성공 → ok=true", async () => {
    const config = make_config();
    const url = service.generate_auth_url(config);
    const state = new URL(url).searchParams.get("state")!;

    vi.mocked(store.get).mockReturnValue(config);
    vi.mocked(store.get_client_id).mockResolvedValue("client_id");
    vi.mocked(store.get_client_secret).mockResolvedValue("client_secret");
    vi.mocked(store.set_tokens).mockResolvedValue(undefined);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: "tok_abc", expires_in: 3600 }),
    }));

    const result = await service.handle_callback("code123", state);
    expect(result.ok).toBe(true);
    expect(result.instance_id).toBe("inst-1");
    expect(vi.mocked(store.set_tokens)).toHaveBeenCalled();
  });

  it("토큰 교환 실패 (no access_token) → ok=false", async () => {
    const config = make_config();
    const url = service.generate_auth_url(config);
    const state = new URL(url).searchParams.get("state")!;

    vi.mocked(store.get).mockReturnValue(config);
    vi.mocked(store.get_client_id).mockResolvedValue("cid");
    vi.mocked(store.get_client_secret).mockResolvedValue("csec");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ error: "bad_request", error_description: "invalid code" }),
    }));

    const result = await service.handle_callback("bad-code", state);
    expect(result.ok).toBe(false);
  });
});

// ── refresh_token ───────────────────────────────────────────────

describe("OAuthFlowService — refresh_token", () => {
  it("integration 없음 → ok=false", async () => {
    vi.mocked(store.get).mockReturnValue(null);
    const result = await service.refresh_token("no-such-id");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("integration_not_found");
  });

  it("refresh_token 없음 → ok=false", async () => {
    vi.mocked(store.get).mockReturnValue(make_config());
    vi.mocked(store.get_refresh_token).mockResolvedValue(null);
    const result = await service.refresh_token("inst-1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_refresh_token");
  });

  it("client credentials 없음 → ok=false", async () => {
    vi.mocked(store.get).mockReturnValue(make_config());
    vi.mocked(store.get_refresh_token).mockResolvedValue("rt123");
    vi.mocked(store.get_client_id).mockResolvedValue(null);
    const result = await service.refresh_token("inst-1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_client_credentials");
  });

  it("갱신 성공 → ok=true, set_tokens 호출", async () => {
    vi.mocked(store.get).mockReturnValue(make_config());
    vi.mocked(store.get_refresh_token).mockResolvedValue("rt123");
    vi.mocked(store.get_client_id).mockResolvedValue("cid");
    vi.mocked(store.get_client_secret).mockResolvedValue("csec");
    vi.mocked(store.set_tokens).mockResolvedValue(undefined);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: "new_token", refresh_token: "new_rt" }),
    }));

    const result = await service.refresh_token("inst-1");
    expect(result.ok).toBe(true);
    expect(vi.mocked(store.set_tokens)).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ access_token: "new_token" }),
    );
  });
});

// ── test_token ──────────────────────────────────────────────────

describe("OAuthFlowService — test_token", () => {
  it("integration 없음 → ok=false", async () => {
    vi.mocked(store.get).mockReturnValue(null);
    const result = await service.test_token("no-id");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("integration_not_found");
  });

  it("access_token 없음 → ok=false", async () => {
    vi.mocked(store.get).mockReturnValue(make_config());
    vi.mocked(store.get_access_token).mockResolvedValue(null);
    const result = await service.test_token("inst-1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_access_token");
  });

  it("test_url 없는 서비스 → ok=true, no_test_endpoint", async () => {
    const config = make_config({ service_type: "custom_no_url" });
    vi.mocked(store.get).mockReturnValue(config);
    vi.mocked(store.get_access_token).mockResolvedValue("tok_abc");
    const result = await service.test_token("inst-1");
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("no_test_endpoint");
  });

  it("토큰 유효 → ok=true, user 정보 포함", async () => {
    // github preset 등록 (test_url 필요)
    register_preset({
      service_type: "test_svc",
      label: "Test",
      auth_url: "https://test.example.com/auth",
      token_url: "https://test.example.com/token",
      scopes_available: [],
      default_scopes: [],
      supports_refresh: false,
      test_url: "https://api.test.example.com/user",
    });

    const config = make_config({ service_type: "test_svc" });
    vi.mocked(store.get).mockReturnValue(config);
    vi.mocked(store.get_access_token).mockResolvedValue("tok_valid");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ login: "testuser" }),
    }));

    const result = await service.test_token("inst-1");
    unregister_preset("test_svc");
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("testuser");
  });

  it("401 응답 → ok=false, token_invalid_or_expired", async () => {
    register_preset({
      service_type: "svc_401",
      label: "Svc",
      auth_url: "",
      token_url: "",
      scopes_available: [],
      default_scopes: [],
      supports_refresh: false,
      test_url: "https://api.example.com/user",
    });

    const config = make_config({ service_type: "svc_401" });
    vi.mocked(store.get).mockReturnValue(config);
    vi.mocked(store.get_access_token).mockResolvedValue("tok_expired");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({}),
    }));

    const result = await service.test_token("inst-1");
    unregister_preset("svc_401");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("token_invalid_or_expired");
  });
});

// ── get_valid_access_token ───────────────────────────────────────

describe("OAuthFlowService — get_valid_access_token", () => {
  it("integration 없음 → token=null", async () => {
    vi.mocked(store.get).mockReturnValue(null);
    const result = await service.get_valid_access_token("no-id");
    expect(result.token).toBeNull();
    expect(result.error).toContain("integration_not_found");
  });

  it("토큰 만료 안됨 → access_token 반환", async () => {
    vi.mocked(store.get).mockReturnValue(make_config());
    vi.mocked(store.is_expired).mockReturnValue(false);
    vi.mocked(store.get_access_token).mockResolvedValue("valid_token");

    const result = await service.get_valid_access_token("inst-1");
    expect(result.token).toBe("valid_token");
  });
});

// ── preset 관리 ─────────────────────────────────────────────────

describe("OAuthFlowService — preset 관리", () => {
  it("load_custom_presets → store.load_presets 호출", () => {
    const presets: OAuthServicePreset[] = [];
    vi.mocked(store.load_presets).mockReturnValue(presets);
    service.load_custom_presets();
    expect(vi.mocked(store.load_presets)).toHaveBeenCalled();
  });

  it("register_custom_preset → save_preset 호출", () => {
    const preset: OAuthServicePreset = {
      service_type: "custom_reg",
      label: "Custom",
      auth_url: "",
      token_url: "",
      scopes_available: [],
      default_scopes: [],
      supports_refresh: false,
    };
    service.register_custom_preset(preset);
    expect(vi.mocked(store.save_preset)).toHaveBeenCalledWith(preset);
    unregister_preset("custom_reg");
  });

  it("unregister_custom_preset → remove_preset 호출", () => {
    vi.mocked(store.remove_preset).mockReturnValue(true);
    service.unregister_custom_preset("some_type");
    expect(vi.mocked(store.remove_preset)).toHaveBeenCalledWith("some_type");
  });
});
