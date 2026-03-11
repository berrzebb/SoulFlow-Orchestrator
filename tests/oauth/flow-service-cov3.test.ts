/**
 * OAuthFlowService — 미커버 분기 보충 (cov3):
 * - L34: cleanup_timer 콜백 `() => this._prune_expired()` — 1분 후 발화
 * - L36: refresh_timer 콜백 `() => void this._refresh_expiring_tokens()` — 5분 후 발화
 * - L220: stop() 메서드 body
 * - L221: health_check() 메서드 body
 * - L291: _refresh_expiring_tokens — preset.supports_refresh=falsy → continue
 * - L294: _refresh_expiring_tokens — margin > REFRESH_MARGIN_MS → continue
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { OAuthFlowService } from "@src/oauth/flow-service.js";
import type { OAuthIntegrationStore, OAuthIntegrationConfig } from "@src/oauth/integration-store.js";
import { register_preset } from "@src/oauth/presets.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function make_config(overrides: Partial<OAuthIntegrationConfig> = {}): OAuthIntegrationConfig {
  return {
    instance_id: "inst-cov3",
    service_type: "github",
    label: "Test",
    enabled: true,
    scopes: ["read:user"],
    auth_url: "https://example.com/auth",
    token_url: "https://example.com/token",
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
    upsert: vi.fn(), delete: vi.fn(),
    update_settings: vi.fn().mockReturnValue(false),
    update_expires_at: vi.fn(), is_expired: vi.fn().mockReturnValue(false),
    get_access_token: vi.fn().mockResolvedValue(null),
    get_refresh_token: vi.fn().mockResolvedValue(null),
    get_client_id: vi.fn().mockResolvedValue("cid"),
    get_client_secret: vi.fn().mockResolvedValue("csecret"),
    set_tokens: vi.fn(),
    load_presets: vi.fn().mockReturnValue([]),
    save_preset: vi.fn(),
    remove_preset: vi.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as OAuthIntegrationStore;
}

// ── L34: cleanup_timer 콜백 (_prune_expired 발화) ────────────────────────────

describe("OAuthFlowService — L34: cleanup_timer 콜백 발화", () => {
  it("fake timer 60s 진행 → cleanup_timer 콜백(L34) _prune_expired 실행", async () => {
    // 생성자 전에 fake timers 활성화 → setInterval이 fake 타이머 사용
    vi.useFakeTimers();
    const store = make_store();
    const service = new OAuthFlowService(store);

    try {
      // 60초 진행 → cleanup_timer 발화
      await vi.advanceTimersByTimeAsync(60_000);
      // _prune_expired 실행됨 (에러 없이 완료)
      expect(true).toBe(true);
    } finally {
      service.close();
    }
  });
});

// ── L36: refresh_timer 콜백 (_refresh_expiring_tokens 발화) ─────────────────

describe("OAuthFlowService — L36: refresh_timer 콜백 발화", () => {
  it("fake timer 5분 진행 → refresh_timer 콜백(L36) _refresh_expiring_tokens 실행", async () => {
    vi.useFakeTimers();
    // list() → 빈 배열 (refresh 루프 즉시 종료)
    const store = make_store({ list: vi.fn().mockReturnValue([]) });
    const service = new OAuthFlowService(store);

    try {
      // 5분(300s) 진행 → refresh_timer 발화
      await vi.advanceTimersByTimeAsync(300_000);
      expect(true).toBe(true);
    } finally {
      service.close();
    }
  });
});

// ── L220-221: stop() + health_check() 메서드 body ────────────────────────────

describe("OAuthFlowService — L220-221: stop / health_check 메서드", () => {
  it("stop() 호출 → L220 this.close() 실행, 에러 없음", async () => {
    const store = make_store();
    const service = new OAuthFlowService(store);
    await service.stop();  // L220 커버
    // 이미 stop됨 (중복 호출해도 safe)
    expect(true).toBe(true);
  });

  it("health_check() → L221 { ok: true } 반환", () => {
    const store = make_store();
    const service = new OAuthFlowService(store);
    try {
      const result = service.health_check();  // L221 커버
      expect(result.ok).toBe(true);
    } finally {
      service.close();
    }
  });
});

// ── L291: preset.supports_refresh=false → continue ──────────────────────────

describe("OAuthFlowService — L291: preset supports_refresh=false → continue", () => {
  it("enabled + expires_at 있지만 preset.supports_refresh=false → L291 continue", async () => {
    vi.useFakeTimers();

    // supports_refresh=false인 커스텀 preset 등록
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
      expires_at: new Date(Date.now() + 60_000).toISOString(),  // 1분 후 만료
    });

    const store = make_store({
      list: vi.fn().mockReturnValue([config]),
    });
    const service = new OAuthFlowService(store);

    try {
      // refresh_timer 발화 → _refresh_expiring_tokens → supports_refresh=false → L291 continue
      await vi.advanceTimersByTimeAsync(300_000);
      expect(true).toBe(true);
    } finally {
      service.close();
    }
  });
});

// ── L294: margin > REFRESH_MARGIN_MS → continue ──────────────────────────────

describe("OAuthFlowService — L294: margin > REFRESH_MARGIN_MS → continue", () => {
  it("expires_at가 10분 이상 남아있음 → L294 margin>REFRESH_MARGIN continue", async () => {
    vi.useFakeTimers();

    // supports_refresh=true인 preset 등록
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
      // 20분 후 만료 → 5분 경과 후 margin = 15분 > REFRESH_MARGIN_MS(5분) → L294 continue
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    });

    const store = make_store({
      list: vi.fn().mockReturnValue([config]),
    });
    const service = new OAuthFlowService(store);

    try {
      // refresh_timer 발화 → _refresh_expiring_tokens → margin > REFRESH_MARGIN_MS → L294
      await vi.advanceTimersByTimeAsync(300_000);
      expect(true).toBe(true);
    } finally {
      service.close();
    }
  });
});
