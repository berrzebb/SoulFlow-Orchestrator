/** HTTP 요청/응답 처리 공유 유틸리티. HttpRequestTool · OAuthFetchTool 공통. */

/** 사설망 호스트 차단 패턴 (SSRF 방지). */
const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;

/** URL 파싱 + 프로토콜/SSRF 검증. 실패 시 에러 문자열 반환. */
export function validate_url(url_str: string): URL | string {
  if (!url_str) return "url is required";
  let parsed: URL;
  try {
    parsed = new URL(url_str);
  } catch {
    return `invalid URL "${url_str}"`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `unsupported protocol "${parsed.protocol}"`;
  }
  // Node.js URL.hostname은 IPv6를 브래킷 포함으로 반환 (예: [::1])
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (PRIVATE_HOST_RE.test(hostname) || hostname.endsWith(".local")) {
    return `private/loopback host blocked "${parsed.hostname}"`;
  }
  return parsed;
}

/** params.headers 객체를 Record<string, string>으로 정규화. */
export function normalize_headers(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[String(k)] = String(v ?? "");
    }
  }
  return out;
}

/** 요청 바디 직렬화. 객체 → JSON + Content-Type 자동 설정. */
export function serialize_body(
  body: unknown,
  headers: Record<string, string>,
): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  const json = JSON.stringify(body);
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  return json;
}

export type HttpResponseSummary = {
  status: number;
  status_text: string;
  content_type: string;
  body: unknown;
  truncated: boolean;
};

/** HTTP 응답을 JSON 문자열로 포맷. */
export async function format_response(res: Response, max_chars: number): Promise<string> {
  const content_type = res.headers.get("content-type") || "";
  const raw_text = await res.text();
  const truncated = raw_text.length > max_chars;
  const text_out = truncated
    ? `${raw_text.slice(0, max_chars)}...(truncated, ${raw_text.length} chars total)`
    : raw_text;

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
  } satisfies HttpResponseSummary);
}

/** AbortController 기반 타임아웃 fetch. */
export async function timed_fetch(
  url: string,
  opts: { method: string; headers: Record<string, string>; body?: string; timeout_ms: number },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout_ms);
  try {
    return await fetch(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
