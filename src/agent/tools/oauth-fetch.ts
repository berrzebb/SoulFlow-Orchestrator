/**
 * OAuthFetchTool — OAuth 인증된 외부 API 호출 + 연동 조회.
 * action 기반: fetch(기본), list.
 * 토큰은 자동 주입만 수행하며, raw token은 외부에 노출하지 않는다.
 */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import type { OAuthFlowService } from "../../oauth/flow-service.js";
import type { OAuthIntegrationStore } from "../../oauth/integration-store.js";
import { create_logger } from "../../logger.js";
import { error_message } from "../../utils/common.js";
import { validate_url, normalize_headers, serialize_body, format_response, timed_fetch } from "./http-utils.js";

const log = create_logger("oauth-fetch");

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CHARS = 8_000;

export class OAuthFetchTool extends Tool {
  readonly name = "oauth_fetch";
  readonly category = "web" as const;
  readonly policy_flags = { network: true } as const;
  readonly description =
    "OAuth 인증된 외부 API 호출 및 연동 관리.\n" +
    "Actions:\n" +
    "- fetch (default): service_id + url로 인증된 HTTP 요청. 토큰 자동 주입/갱신.\n" +
    "- list: 워크스페이스에 등록된 OAuth 연동 목록 조회.";

  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["fetch", "list"],
        description: "수행할 작업 (기본: fetch)",
      },
      service_id: { type: "string", description: "OAuth 연동 ID (e.g., 'github')" },
      url: { type: "string", description: "대상 URL (fetch 시 필수)" },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        description: "HTTP 메서드 (기본: GET)",
      },
      headers: { type: "object", description: "추가 요청 헤더 key-value" },
      body: { description: "요청 바디. 객체면 JSON 직렬화" },
    },
    additionalProperties: false,
  };

  private readonly store: OAuthIntegrationStore;
  private readonly flow: OAuthFlowService;

  constructor(store: OAuthIntegrationStore, flow: OAuthFlowService) {
    super();
    this.store = store;
    this.flow = flow;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "fetch").toLowerCase();

    switch (action) {
      case "list": return this._list();
      case "fetch": return await this._fetch(params);
      default: return `Error: unsupported action "${action}". Use: fetch, list`;
    }
  }

  /** 워크스페이스에 등록된 OAuth 연동 목록. */
  private _list(): string {
    const integrations = this.store.list();
    const summary = integrations.map((i) => ({
      service_id: i.instance_id,
      service_type: i.service_type,
      label: i.label,
      enabled: i.enabled,
      scopes: i.scopes,
      connected: !!i.expires_at,
      expired: i.expires_at ? new Date(i.expires_at) < new Date() : false,
    }));
    return JSON.stringify(summary);
  }

  /** OAuth 인증된 HTTP 요청. */
  private async _fetch(params: Record<string, unknown>): Promise<string> {
    const service_id = String(params.service_id || "").trim();
    if (!service_id) return "Error: service_id is required";

    const url_str = String(params.url || "").trim();
    const url_or_error = validate_url(url_str);
    if (typeof url_or_error === "string") return `Error: ${url_or_error}`;

    const integration = this.store.get(service_id);
    if (!integration) {
      log.warn("oauth_fetch_error", { service_id, error: "integration_not_found" });
      return `Error: OAuth integration "${service_id}" not found`;
    }
    if (!integration.enabled) {
      log.warn("oauth_fetch_error", { service_id, error: "integration_disabled" });
      return `Error: OAuth integration "${service_id}" is disabled`;
    }

    // host allowlist 검증 — integration.settings.allowed_hosts 설정 시 강제
    const allowed_hosts = Array.isArray(integration.settings.allowed_hosts)
      ? (integration.settings.allowed_hosts as unknown[]).map(String).filter(Boolean)
      : [];
    if (allowed_hosts.length > 0) {
      if (!allowed_hosts.includes(url_or_error.hostname)) {
        log.warn("oauth_fetch_blocked", { service_id, host: url_or_error.hostname, allowed: allowed_hosts });
        return `Error: host "${url_or_error.hostname}" is not in allowed_hosts for "${service_id}"`;
      }
    } else {
      log.warn("oauth_fetch_no_allowlist", { service_id, host: url_or_error.hostname });
    }

    const { token, error } = await this.flow.get_valid_access_token(service_id);
    if (!token) {
      log.warn("oauth_fetch_error", { service_id, error: error || "token_not_configured" });
      return `Error: no valid access token for "${service_id}" — ${error || "token not configured"}`;
    }

    const method = String(params.method || "GET").toUpperCase();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...normalize_headers(params.headers),
    };
    const body = serialize_body(params.body, headers);

    try {
      let res = await timed_fetch(url_or_error.href, { method, headers, body, timeout_ms: DEFAULT_TIMEOUT_MS });

      // 401 시 토큰 갱신 후 재시도
      if (res.status === 401) {
        log.warn("oauth_fetch_retry", { service_id, method, host: url_or_error.host, reason: "401_refresh" });
        const refresh_result = await this.flow.refresh_token(service_id);
        if (refresh_result.ok) {
          const new_token = await this.store.get_access_token(service_id);
          if (new_token) {
            headers.Authorization = `Bearer ${new_token}`;
            res = await timed_fetch(url_or_error.href, { method, headers, body, timeout_ms: DEFAULT_TIMEOUT_MS });
          }
        }
      }

      log.info("oauth_fetch", { service_id, method, host: url_or_error.host, status: res.status });
      return format_response(res, DEFAULT_MAX_CHARS);
    } catch (e) {
      return `Error: ${error_message(e)}`;
    }
  }
}
