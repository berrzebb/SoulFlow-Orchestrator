/**
 * OAuthFlowService — OAuth 2.0 Authorization Code 플로우 처리.
 * state 파라미터 기반 CSRF 방지 + 토큰 교환/갱신.
 */

import { randomUUID } from "node:crypto";
import { create_logger } from "../logger.js";
import type { OAuthIntegrationStore, OAuthIntegrationConfig } from "./integration-store.js";
import { get_preset, register_preset, unregister_preset, type OAuthServicePreset } from "./presets.js";

const log = create_logger("oauth");

interface PendingFlow {
  instance_id: string;
  created_at: number;
}

const FLOW_TTL_MS = 10 * 60 * 1000; // 10분
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1분

export class OAuthFlowService {
  private readonly store: OAuthIntegrationStore;
  private readonly pending_flows = new Map<string, PendingFlow>();
  private readonly cleanup_timer: ReturnType<typeof setInterval>;

  constructor(store: OAuthIntegrationStore) {
    this.store = store;
    this.cleanup_timer = setInterval(() => this._prune_expired(), CLEANUP_INTERVAL_MS);
    this.cleanup_timer.unref();
  }

  /** 인증 URL 생성. state를 랜덤 생성하여 pending_flows에 저장. */
  generate_auth_url(integration: OAuthIntegrationConfig): string {
    const state = randomUUID();
    this.pending_flows.set(state, {
      instance_id: integration.instance_id,
      created_at: Date.now(),
    });

    const preset = get_preset(integration.service_type);
    const scope_sep = preset?.scope_separator ?? " ";
    const params = new URLSearchParams({
      client_id: "", // placeholder — 실제 client_id는 아래에서 대체
      redirect_uri: integration.redirect_uri,
      scope: integration.scopes.join(scope_sep),
      state,
      response_type: "code",
    });

    if (preset?.extra_auth_params) {
      for (const [k, v] of Object.entries(preset.extra_auth_params)) {
        params.set(k, v);
      }
    }

    return `${integration.auth_url}?${params.toString()}`;
  }

  /** client_id를 포함한 인증 URL 생성. vault에서 client_id를 미리 가져와야 한다. */
  generate_auth_url_with_client_id(integration: OAuthIntegrationConfig, client_id: string): string {
    const base_url = this.generate_auth_url(integration);
    const url = new URL(base_url);
    url.searchParams.set("client_id", client_id);
    return url.toString();
  }

  /** 콜백 처리: code + state → 토큰 교환 → vault 저장. */
  async handle_callback(code: string, state: string): Promise<{ ok: boolean; instance_id?: string; error?: string }> {
    const flow = this.pending_flows.get(state);
    if (!flow) {
      return { ok: false, error: "invalid_or_expired_state" };
    }

    if (Date.now() - flow.created_at > FLOW_TTL_MS) {
      this.pending_flows.delete(state);
      return { ok: false, error: "flow_expired" };
    }

    this.pending_flows.delete(state);
    const { instance_id } = flow;

    const integration = this.store.get(instance_id);
    if (!integration) {
      return { ok: false, error: "integration_not_found" };
    }

    const client_id = await this.store.get_client_id(instance_id);
    if (!client_id) {
      return { ok: false, error: "missing_client_id" };
    }
    const client_secret = await this.store.get_client_secret(instance_id) ?? "";

    try {
      const token_response = await this._exchange_code(integration, code, client_id, client_secret);
      await this.store.set_tokens(instance_id, token_response);
      log.info("token exchange ok", { instance_id, service: integration.service_type });
      return { ok: true, instance_id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("token exchange failed", { instance_id, error: msg });
      return { ok: false, instance_id, error: msg };
    }
  }

  /** 만료된 토큰 갱신. */
  async refresh_token(instance_id: string): Promise<{ ok: boolean; error?: string }> {
    const integration = this.store.get(instance_id);
    if (!integration) return { ok: false, error: "integration_not_found" };

    const refresh_token = await this.store.get_refresh_token(instance_id);
    if (!refresh_token) return { ok: false, error: "no_refresh_token" };

    const client_id = await this.store.get_client_id(instance_id);
    const client_secret = await this.store.get_client_secret(instance_id);
    if (!client_id || !client_secret) return { ok: false, error: "missing_client_credentials" };

    try {
      const data = await this._post_token(
        integration,
        { grant_type: "refresh_token", refresh_token },
        client_id,
        client_secret,
      );

      await this.store.set_tokens(instance_id, {
        access_token: String(data.access_token),
        refresh_token: data.refresh_token ? String(data.refresh_token) : undefined,
        expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
      });

      log.info("token refreshed", { instance_id });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("token refresh failed", { instance_id, error: msg });
      return { ok: false, error: msg };
    }
  }

  /** 토큰 유효성 테스트 (서비스별 간단한 API 호출). */
  async test_token(instance_id: string): Promise<{ ok: boolean; detail?: string; error?: string }> {
    const integration = this.store.get(instance_id);
    if (!integration) return { ok: false, error: "integration_not_found" };

    const access_token = await this.store.get_access_token(instance_id);
    if (!access_token) return { ok: false, error: "no_access_token" };

    const test_url = get_preset(integration.service_type)?.test_url ?? null;
    if (!test_url) return { ok: true, detail: "no_test_endpoint_for_service_type" };

    try {
      const res = await fetch(test_url, {
        headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
      });

      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const detail_value = data.login ?? data.display_name ?? data.email ?? data.id ?? "valid";
        const detail = `user: ${detail_value}`;
        return { ok: true, detail };
      }

      if (res.status === 401) {
        return { ok: false, error: "token_invalid_or_expired" };
      }

      return { ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 만료 시 자동 갱신을 시도하고 access_token 반환. */
  async get_valid_access_token(instance_id: string): Promise<{ token: string | null; error?: string }> {
    const integration = this.store.get(instance_id);
    if (!integration) return { token: null, error: "integration_not_found" };

    if (this.store.is_expired(instance_id)) {
      const refresh_result = await this.refresh_token(instance_id);
      if (!refresh_result.ok) {
        return { token: null, error: `refresh_failed: ${refresh_result.error}` };
      }
    }

    const token = await this.store.get_access_token(instance_id);
    return { token };
  }

  /** 서버 시작 시 DB에 저장된 커스텀 프리셋을 레지스트리에 로드. */
  load_custom_presets(): void {
    for (const preset of this.store.load_presets()) {
      register_preset(preset);
    }
  }

  /** 커스텀 프리셋을 레지스트리 + DB에 즉시 등록. */
  register_custom_preset(preset: OAuthServicePreset): void {
    register_preset(preset);
    this.store.save_preset(preset);
  }

  /** 커스텀 프리셋을 레지스트리 + DB에서 제거. */
  unregister_custom_preset(service_type: string): boolean {
    unregister_preset(service_type);
    return this.store.remove_preset(service_type);
  }

  close(): void {
    clearInterval(this.cleanup_timer);
  }

  // ── private ──

  private async _exchange_code(
    integration: OAuthIntegrationConfig,
    code: string,
    client_id: string,
    client_secret: string,
  ): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
    const data = await this._post_token(
      integration,
      { grant_type: "authorization_code", code, redirect_uri: integration.redirect_uri },
      client_id,
      client_secret,
    );

    if (!data.access_token) {
      throw new Error(String(data.error_description || data.error || "token exchange failed: no access_token"));
    }

    return {
      access_token: String(data.access_token),
      refresh_token: data.refresh_token ? String(data.refresh_token) : undefined,
      expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
    };
  }

  /** 토큰 엔드포인트 POST. preset의 token_auth_method에 따라 Basic Auth 헤더 또는 body 방식 선택. */
  private async _post_token(
    integration: OAuthIntegrationConfig,
    params: Record<string, string>,
    client_id: string,
    client_secret: string,
  ): Promise<Record<string, unknown>> {
    const preset = get_preset(integration.service_type);
    const auth_method = preset?.token_auth_method ?? "body";

    const body = new URLSearchParams(params);
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (auth_method === "basic") {
      headers.Authorization = "Basic " + Buffer.from(`${client_id}:${client_secret}`).toString("base64");
    } else {
      body.set("client_id", client_id);
      if (client_secret) body.set("client_secret", client_secret);
    }

    const res = await fetch(integration.token_url, { method: "POST", headers, body: body.toString() });
    const data = await res.json() as Record<string, unknown>;

    if (!res.ok || data.error) {
      throw new Error(String(data.error_description || data.error || `HTTP ${res.status}`));
    }

    return data;
  }

  private _prune_expired(): void {
    const now = Date.now();
    for (const [state, flow] of this.pending_flows) {
      if (now - flow.created_at > FLOW_TTL_MS) {
        this.pending_flows.delete(state);
      }
    }
  }
}
