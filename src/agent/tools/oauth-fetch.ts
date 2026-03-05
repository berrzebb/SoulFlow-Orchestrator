/**
 * OAuthFetchTool — OAuth 인증된 외부 API 호출 + 연동 조회 + 토큰 접근.
 * action 기반: fetch(기본), list, get_token.
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
  readonly description =
    "OAuth 인증된 외부 API 호출 및 연동 관리.\n" +
    "Actions:\n" +
    "- fetch (default): service_id + url로 인증된 HTTP 요청. 토큰 자동 주입/갱신.\n" +
    "- list: 워크스페이스에 등록된 OAuth 연동 목록 조회.\n" +
    "- get_token: service_id의 유효한 access_token을 반환. 만료 시 자동 갱신.";

  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["fetch", "list", "get_token"],
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
      case "get_token": return await this._get_token(params);
      case "fetch": return await this._fetch(params);
      default: return `Error: unsupported action "${action}". Use: fetch, list, get_token`;
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

  /** 유효한 access_token을 반환. 만료 시 자동 갱신. */
  private async _get_token(params: Record<string, unknown>): Promise<string> {
    const service_id = String(params.service_id || "").trim();
    if (!service_id) return "Error: service_id is required";

    const integration = this.store.get(service_id);
    if (!integration) return `Error: OAuth integration "${service_id}" not found`;
    if (!integration.enabled) return `Error: OAuth integration "${service_id}" is disabled`;

    const { token, error } = await this.flow.get_valid_access_token(service_id);
    if (!token) {
      return `Error: no valid access token for "${service_id}" — ${error || "token not configured"}`;
    }

    log.info("get_token", { service_id });
    return JSON.stringify({ service_id, service_type: integration.service_type, access_token: token });
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
