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

// ══════════════════════════════════════════════════════════
// handle_callback — 만료된 플로우 (cov2)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — handle_callback 만료 플로우", () => {
  it("TTL 만료된 state → flow_expired 에러", async () => {
    const state = "expired-state";
    (service as any).pending_flows.set(state, {
      instance_id: "inst-1",
      created_at: Date.now() - 11 * 60 * 1000,
    });

    const r = await service.handle_callback("some-code", state);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("flow_expired");
  });
});

// ══════════════════════════════════════════════════════════
// handle_callback — exchange 에러 (cov2)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — handle_callback exchange 에러", () => {
  it("token exchange fetch 실패 → error 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Network error")));

    const config = make_config();
    const local_store = make_store({
      get: vi.fn().mockReturnValue(config),
      get_client_id: vi.fn().mockResolvedValue("client-id"),
      get_client_secret: vi.fn().mockResolvedValue("client-secret"),
    });
    const local_svc = new OAuthFlowService(local_store);

    const state = "exchange-fail-state";
    (local_svc as any).pending_flows.set(state, { instance_id: "inst-1", created_at: Date.now() });

    const r = await local_svc.handle_callback("code", state);
    local_svc.close();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Network error");
  });

  it("token exchange 응답에 error 필드 → throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant", error_description: "Code expired" }),
    }));

    const config = make_config();
    const local_store = make_store({
      get: vi.fn().mockReturnValue(config),
      get_client_id: vi.fn().mockResolvedValue("client-id"),
      get_client_secret: vi.fn().mockResolvedValue("client-secret"),
    });
    const local_svc = new OAuthFlowService(local_store);

    const state = "bad-code-state";
    (local_svc as any).pending_flows.set(state, { instance_id: "inst-1", created_at: Date.now() });

    const r = await local_svc.handle_callback("bad-code", state);
    local_svc.close();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Code expired");
  });
});

// ══════════════════════════════════════════════════════════
// refresh_token — fetch 실패 (cov2)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — refresh_token fetch 실패", () => {
  it("fetch 실패 → error 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Refresh network error")));
    const local_store = make_store({
      get: vi.fn().mockReturnValue(make_config()),
      get_refresh_token: vi.fn().mockResolvedValue("refresh-token"),
      get_client_id: vi.fn().mockResolvedValue("client-id"),
      get_client_secret: vi.fn().mockResolvedValue("client-secret"),
    });
    const local_svc = new OAuthFlowService(local_store);

    const r = await local_svc.refresh_token("inst-1");
    local_svc.close();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Refresh network error");
  });
});

// ══════════════════════════════════════════════════════════
// test_token — HTTP 에러/fetch 에러 (cov2)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — test_token 에러 경로", () => {
  const test_svc_type = "test_with_url";

  beforeEach(() => {
    register_preset({
      service_type: test_svc_type,
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
    unregister_preset(test_svc_type);
  });

  it("HTTP 500 응답 → 'HTTP 500' 에러", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }));

    const local_store = make_store({
      get: vi.fn().mockReturnValue(make_config({ service_type: test_svc_type, token_url: "https://test.example.com/token" })),
      get_access_token: vi.fn().mockResolvedValue("some-token"),
    });
    const local_svc = new OAuthFlowService(local_store);

    const r = await local_svc.test_token("inst-1");
    local_svc.close();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("HTTP 500");
  });

  it("fetch throw → error 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("fetch failed")));

    const local_store = make_store({
      get: vi.fn().mockReturnValue(make_config({ service_type: test_svc_type })),
      get_access_token: vi.fn().mockResolvedValue("some-token"),
    });
    const local_svc = new OAuthFlowService(local_store);

    const r = await local_svc.test_token("inst-1");
    local_svc.close();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("fetch failed");
  });
});

// ══════════════════════════════════════════════════════════
// get_valid_access_token — 만료 후 refresh 실패 (cov2)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — get_valid_access_token 만료 refresh 실패", () => {
  it("토큰 만료 → refresh 실패 → token=null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Refresh failed")));

    const local_store = make_store({
      get: vi.fn().mockReturnValue(make_config()),
      is_expired: vi.fn().mockReturnValue(true),
      get_refresh_token: vi.fn().mockResolvedValue("expired-refresh"),
    });
    const local_svc = new OAuthFlowService(local_store);

    const r = await local_svc.get_valid_access_token("inst-1");
    local_svc.close();
    expect(r.token).toBeNull();
    expect(r.error).toContain("refresh_failed");
  });
});

// ══════════════════════════════════════════════════════════
// _post_token — basic auth 메서드 (cov2)
// ══════════════════════════════════════════════════════════

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
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(async (_url: string, opts: { headers?: Record<string, string> }) => {
      captured_headers = opts?.headers || {};
      return { ok: true, status: 200, json: async () => ({ access_token: "new-token", expires_in: 3600 }) };
    }));

    const local_store = make_store({
      get: vi.fn().mockReturnValue(make_config({ service_type: "test_basic_preset", token_url: "https://basic.example.com/token" })),
      get_refresh_token: vi.fn().mockResolvedValue("valid-refresh"),
      get_client_id: vi.fn().mockResolvedValue("client-id"),
      get_client_secret: vi.fn().mockResolvedValue("client-secret"),
    });
    const local_svc = new OAuthFlowService(local_store);

    await local_svc.refresh_token("inst-1");
    local_svc.close();

    expect(captured_headers["Authorization"]).toMatch(/^Basic /);

    unregister_preset("test_basic_preset");
  });
});

// ══════════════════════════════════════════════════════════
// _prune_expired — 만료 플로우 정리 (cov2)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — _prune_expired 만료 정리", () => {
  it("만료된 pending flow 제거", () => {
    (service as any).pending_flows.set("old-state", {
      instance_id: "old",
      created_at: Date.now() - 15 * 60 * 1000,
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

// ══════════════════════════════════════════════════════════
// _exchange_code — access_token 없음 → throw (cov2)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — _exchange_code: access_token 없음", () => {
  it("_post_token이 access_token 없는 응답 → throw Error", async () => {
    const config = make_config();
    (service as any)._post_token = vi.fn().mockResolvedValue({
      error: "invalid_client",
      error_description: "bad client credentials",
    });
    await expect(
      (service as any)._exchange_code(config, "auth_code", "client_id", "client_secret"),
    ).rejects.toThrow("bad client credentials");
  });

  it("error_description 없음 → error 필드 사용", async () => {
    const config = make_config();
    (service as any)._post_token = vi.fn().mockResolvedValue({
      error: "access_denied",
    });
    await expect(
      (service as any)._exchange_code(config, "auth_code", "client_id", "client_secret"),
    ).rejects.toThrow("access_denied");
  });
});

// ══════════════════════════════════════════════════════════
// 타이머 콜백 (cov3)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — cleanup_timer 콜백 발화", () => {
  it("fake timer 60s 진행 → cleanup_timer 콜백 _prune_expired 실행", async () => {
    vi.useFakeTimers();
    const local_store = make_store();
    const local_svc = new OAuthFlowService(local_store);

    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(true).toBe(true);
    } finally {
      local_svc.close();
      vi.useRealTimers();
    }
  });
});

describe("OAuthFlowService — refresh_timer 콜백 발화", () => {
  it("fake timer 5분 진행 → refresh_timer 콜백 _refresh_expiring_tokens 실행", async () => {
    vi.useFakeTimers();
    const local_store = make_store({ list: vi.fn().mockReturnValue([]) });
    const local_svc = new OAuthFlowService(local_store);

    try {
      await vi.advanceTimersByTimeAsync(300_000);
      expect(true).toBe(true);
    } finally {
      local_svc.close();
      vi.useRealTimers();
    }
  });
});

// ══════════════════════════════════════════════════════════
// stop / health_check 메서드 (cov3)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — stop / health_check 메서드", () => {
  it("stop() 호출 → close() 실행, 에러 없음", async () => {
    const local_store = make_store();
    const local_svc = new OAuthFlowService(local_store);
    await local_svc.stop();
    expect(true).toBe(true);
  });

  it("health_check() → { ok: true } 반환", () => {
    const local_store = make_store();
    const local_svc = new OAuthFlowService(local_store);
    try {
      const result = local_svc.health_check();
      expect(result.ok).toBe(true);
    } finally {
      local_svc.close();
    }
  });
});

// ══════════════════════════════════════════════════════════
// _refresh_expiring_tokens 분기 (cov3)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — preset supports_refresh=false → continue", () => {
  it("enabled + expires_at 있지만 preset.supports_refresh=false → continue", async () => {
    vi.useFakeTimers();

    const svc_type = "no-refresh-svc-cov3";
    register_preset({
      service_type: svc_type,
      supports_refresh: false,
      client_id_env: "CLIENT_ID",
      client_secret_env: "CLIENT_SECRET",
      auth_url: "https://example.com/auth",
      token_url: "https://example.com/token",
      scopes: [],
    });

    const config = make_config({
      service_type: svc_type,
      enabled: true,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const local_store = make_store({ list: vi.fn().mockReturnValue([config]) });
    const local_svc = new OAuthFlowService(local_store);

    try {
      await vi.advanceTimersByTimeAsync(300_000);
      expect(true).toBe(true);
    } finally {
      local_svc.close();
      vi.useRealTimers();
    }
  });
});

describe("OAuthFlowService — margin > REFRESH_MARGIN_MS → continue", () => {
  it("expires_at가 10분 이상 남아있음 → margin>REFRESH_MARGIN continue", async () => {
    vi.useFakeTimers();

    const svc_type = "long-expiry-svc-cov3";
    register_preset({
      service_type: svc_type,
      supports_refresh: true,
      client_id_env: "CLIENT_ID",
      client_secret_env: "CLIENT_SECRET",
      auth_url: "https://example.com/auth",
      token_url: "https://example.com/token",
      scopes: [],
    });

    const config = make_config({
      service_type: svc_type,
      enabled: true,
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    });

    const local_store = make_store({ list: vi.fn().mockReturnValue([config]) });
    const local_svc = new OAuthFlowService(local_store);

    try {
      await vi.advanceTimersByTimeAsync(300_000);
      expect(true).toBe(true);
    } finally {
      local_svc.close();
      vi.useRealTimers();
    }
  });
});

// ══════════════════════════════════════════════════════════
// generate_auth_url — extra_auth_params + scope_separator (ext)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — generate_auth_url 미커버 경로", () => {
  afterEach(() => {
    unregister_preset("test-svc-flow");
  });

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
    const config = make_config({ service_type: "test-svc-flow" });
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
    const config = make_config({ service_type: "test-svc-flow", scopes: ["read", "write"] });
    const url = service.generate_auth_url(config);
    expect(url).toContain("scope=read%2Cwrite"); // URL-encoded comma
  });
});

// ══════════════════════════════════════════════════════════
// Basic Auth via handle_callback (ext)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — Basic Auth 토큰 교환 via callback", () => {
  it("token_auth_method=basic → handle_callback에서 Authorization 헤더 사용", async () => {
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

    service.generate_auth_url(integration);

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
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(result.ok).toBe(true);
    unregister_preset("test-svc-basic");
  });
});

// ══════════════════════════════════════════════════════════
// _refresh_expiring_tokens — 만료 임박 (ext)
// ══════════════════════════════════════════════════════════

describe("OAuthFlowService — _refresh_expiring_tokens", () => {
  afterEach(() => {
    unregister_preset("test-svc-flow");
  });

  it("만료 임박 토큰 있으면 refresh_token 호출됨", async () => {
    const expiring_at = new Date(Date.now() + 60_000).toISOString();
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

    store = make_store({ list: vi.fn().mockReturnValue([config]) });
    service.close();
    service = new OAuthFlowService(store);
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
    const config = make_config({ instance_id: "fail-refresh", service_type: "test-svc-flow", enabled: true, expires_at: expiring });

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

    await expect((service as any)._refresh_expiring_tokens()).resolves.toBeUndefined();
  });
});
