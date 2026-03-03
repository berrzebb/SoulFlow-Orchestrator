import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

/** 사설망 호스트 차단 패턴. 외부 REST API 호출 전용. */
const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;

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
    const url_str = String(params.url || "").trim();
    if (!url_str) return "Error: url is required";

    let parsed_url: URL;
    try {
      parsed_url = new URL(url_str);
    } catch {
      return `Error: invalid URL "${url_str}"`;
    }
    if (parsed_url.protocol !== "http:" && parsed_url.protocol !== "https:") {
      return `Error: unsupported protocol "${parsed_url.protocol}"`;
    }
    if (PRIVATE_HOST_RE.test(parsed_url.hostname)) {
      return `Error: private/loopback host blocked "${parsed_url.hostname}"`;
    }

    const method = String(params.method || "GET").toUpperCase();
    const timeout_ms = Math.min(30_000, Math.max(100, Number(params.timeout_ms) || 10_000));
    const max_chars = Math.min(50_000, Math.max(100, Number(params.max_response_chars) || 8_000));

    const req_headers: Record<string, string> = {};
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout_ms);
    try {
      const res = await fetch(url_str, {
        method,
        headers: req_headers,
        body: body_str,
        signal: controller.signal,
      });

      const content_type = res.headers.get("content-type") || "";
      const raw_text = await res.text();
      const truncated = raw_text.length > max_chars;
      const text_out = truncated ? `${raw_text.slice(0, max_chars)}...(truncated, ${raw_text.length} chars total)` : raw_text;

      let body_out: unknown = text_out;
      if (content_type.includes("application/json") && !truncated) {
        try { body_out = JSON.parse(raw_text); } catch { /* keep as string */ }
      }

      return JSON.stringify({
        status: res.status,
        status_text: res.statusText,
        content_type,
        body: body_out,
        truncated,
      });
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      clearTimeout(timer);
    }
  }
}
