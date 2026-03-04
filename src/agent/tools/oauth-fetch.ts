/**
 * OAuthFetchTool — OAuth 인증된 외부 API 호출.
 * 토큰 자동 주입 + 만료 시 자동 갱신.
 */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import type { OAuthFlowService } from "../../oauth/flow-service.js";
import type { OAuthIntegrationStore } from "../../oauth/integration-store.js";
import { create_logger } from "../../logger.js";

const log = create_logger("oauth-fetch");

export class OAuthFetchTool extends Tool {
  readonly name = "oauth_fetch";
  readonly description = "OAuth 인증된 외부 API 호출. service_id로 토큰 자동 주입, 만료 시 자동 갱신.";
  readonly parameters: JsonSchema = {
    type: "object",
    required: ["service_id", "url"],
    properties: {
      service_id: { type: "string", description: "OAuth 연동 ID (e.g., 'github')" },
      url: { type: "string", description: "대상 URL" },
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
    const service_id = String(params.service_id || "").trim();
    if (!service_id) return "Error: service_id is required";

    const url_str = String(params.url || "").trim();
    if (!url_str) return "Error: url is required";

    try { new URL(url_str); } catch {
      return `Error: invalid URL "${url_str}"`;
    }

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
    const req_headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    if (params.headers && typeof params.headers === "object" && !Array.isArray(params.headers)) {
      for (const [k, v] of Object.entries(params.headers as Record<string, unknown>)) {
        req_headers[String(k)] = String(v ?? "");
      }
    }

    let body_str: string | undefined;
    if (params.body !== undefined && params.body !== null) {
      if (typeof params.body === "string") {
        body_str = params.body;
      } else {
        body_str = JSON.stringify(params.body);
        if (!Object.keys(req_headers).some((k) => k.toLowerCase() === "content-type")) {
          req_headers["Content-Type"] = "application/json";
        }
      }
    }

    let res = await this._do_fetch(url_str, method, req_headers, body_str);

    // 401 시 토큰 갱신 후 재시도
    if (res.status === 401) {
      log.warn("oauth_fetch_retry", { service_id, method, host: new URL(url_str).host, reason: "401_refresh" });
      const refresh_result = await this.flow.refresh_token(service_id);
      if (refresh_result.ok) {
        const new_token = await this.store.get_access_token(service_id);
        if (new_token) {
          req_headers.Authorization = `Bearer ${new_token}`;
          res = await this._do_fetch(url_str, method, req_headers, body_str);
        }
      }
    }

    const MAX_CHARS = 8_000;
    const raw_text = await res.response.text();
    const truncated = raw_text.length > MAX_CHARS;
    const text_out = truncated ? `${raw_text.slice(0, MAX_CHARS)}...(truncated, ${raw_text.length} chars total)` : raw_text;

    let body_out: unknown = text_out;
    const content_type = res.response.headers.get("content-type") || "";
    if (content_type.includes("application/json") && !truncated) {
      try { body_out = JSON.parse(raw_text); } catch { /* keep as string */ }
    }

    log.info("oauth_fetch", { service_id, method, host: new URL(url_str).host, status: res.status });
    return JSON.stringify({
      status: res.status,
      status_text: res.response.statusText,
      content_type,
      body: body_out,
      truncated,
    });
  }

  private async _do_fetch(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; response: Response }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { method, headers, body, signal: controller.signal });
      return { status: response.status, response };
    } finally {
      clearTimeout(timer);
    }
  }
}
