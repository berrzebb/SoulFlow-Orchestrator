import { error_message } from "../../utils/common.js";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { validate_url, normalize_headers, serialize_body, format_response, timed_fetch } from "./http-utils.js";

/**
 * 에이전트가 외부 JSON/REST API를 직접 호출할 수 있는 도구.
 * web_fetch와 달리 HTML 변환 없이 구조화된 JSON 응답을 반환하며
 * POST/PUT/PATCH/DELETE 메서드와 요청 바디를 지원한다.
 */
export class HttpRequestTool extends Tool {
  readonly name = "http_request";
  readonly description = "외부 JSON/REST API HTTP 요청 (GET/POST/PUT/PATCH/DELETE). 구조화된 응답 반환.";
  readonly parameters: JsonSchema = {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "대상 URL (https:// 권장)" },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        description: "HTTP 메서드 (기본: GET)",
      },
      headers: { type: "object", description: "요청 헤더 key-value 객체" },
      body: { description: "요청 바디. 객체면 JSON 직렬화, 문자열은 그대로 전송" },
      timeout_ms: {
        type: "integer",
        minimum: 100,
        maximum: 30_000,
        description: "타임아웃 (ms). 기본: 10000",
      },
      max_response_chars: {
        type: "integer",
        minimum: 100,
        maximum: 50_000,
        description: "응답 최대 문자 수. 초과 시 자름. 기본: 8000",
      },
    },
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const url_or_error = validate_url(String(params.url || "").trim());
    if (typeof url_or_error === "string") return `Error: ${url_or_error}`;

    const method = String(params.method || "GET").toUpperCase();
    const timeout_ms = Math.min(30_000, Math.max(100, Number(params.timeout_ms) || 10_000));
    const max_chars = Math.min(50_000, Math.max(100, Number(params.max_response_chars) || 8_000));

    const headers = normalize_headers(params.headers);
    const body = serialize_body(params.body, headers);

    try {
      const res = await timed_fetch(url_or_error.href, { method, headers, body, timeout_ms });
      return format_response(res, max_chars);
    } catch (e) {
      return `Error: ${error_message(e)}`;
    }
  }
}
