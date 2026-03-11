/** HTTP Mock 도구 — 테스트용 HTTP 모킹/응답 생성/요청 검증. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { now_iso } from "../../utils/common.js";

type MockRoute = { method: string; path: string; status: number; body: string; headers: Record<string, string> };
type RecordedRequest = { method: string; path: string; body?: string; timestamp: string };

const mock_routes = new Map<string, MockRoute>();
const recorded_requests: RecordedRequest[] = [];

export class HttpMockTool extends Tool {
  readonly name = "http_mock";
  readonly category = "data" as const;
  readonly description = "HTTP mock utilities: register, match, list, clear, record, replay, generate_response.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["register", "match", "list", "clear", "record", "replay", "generate_response"], description: "Mock operation" },
      method: { type: "string", description: "HTTP method (GET/POST/PUT/DELETE)" },
      path: { type: "string", description: "URL path pattern" },
      status: { type: "integer", description: "Response status code (default: 200)" },
      body: { type: "string", description: "Response body" },
      headers: { type: "string", description: "JSON object of response headers" },
      request_body: { type: "string", description: "Request body to record" },
      content_type: { type: "string", description: "Content type for generate_response (json/xml/html/text)" },
      data: { type: "string", description: "JSON data for generate_response" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "list");

    switch (action) {
      case "register": {
        const method = String(params.method || "GET").toUpperCase();
        const path = String(params.path || "/");
        const status = Number(params.status) || 200;
        const body = String(params.body || "");
        let headers: Record<string, string> = {};
        if (params.headers) {
          try { headers = JSON.parse(String(params.headers)); } catch { /* ignore */ }
        }
        const key = `${method}:${path}`;
        mock_routes.set(key, { method, path, status, body, headers });
        return JSON.stringify({ registered: true, key, route: { method, path, status } });
      }
      case "match": {
        const method = String(params.method || "GET").toUpperCase();
        const path = String(params.path || "/");
        const key = `${method}:${path}`;
        const route = mock_routes.get(key);
        if (!route) {
          for (const [, r] of mock_routes) {
            if (r.method === method && this.path_matches(r.path, path)) {
              return JSON.stringify({ matched: true, status: r.status, body: r.body, headers: r.headers });
            }
          }
          return JSON.stringify({ matched: false });
        }
        return JSON.stringify({ matched: true, status: route.status, body: route.body, headers: route.headers });
      }
      case "list":
        return JSON.stringify({ routes: Array.from(mock_routes.values()), count: mock_routes.size });
      case "clear":
        mock_routes.clear();
        recorded_requests.length = 0;
        return JSON.stringify({ cleared: true });
      case "record": {
        const method = String(params.method || "GET").toUpperCase();
        const path = String(params.path || "/");
        const body = params.request_body ? String(params.request_body) : undefined;
        recorded_requests.push({ method, path, body, timestamp: now_iso() });
        return JSON.stringify({ recorded: true, total: recorded_requests.length });
      }
      case "replay":
        return JSON.stringify({ requests: recorded_requests, count: recorded_requests.length });
      case "generate_response": {
        const content_type = String(params.content_type || "json");
        const status = Number(params.status) || 200;
        let body: string;
        let ct_header: string;
        switch (content_type) {
          case "json": {
            let data: unknown;
            try { data = JSON.parse(String(params.data || "{}")); } catch { data = {}; }
            body = JSON.stringify(data);
            ct_header = "application/json";
            break;
          }
          case "xml":
            body = `<?xml version="1.0" encoding="UTF-8"?>\n<response>${String(params.data || "")}</response>`;
            ct_header = "application/xml";
            break;
          case "html":
            body = `<!DOCTYPE html><html><body>${String(params.data || "")}</body></html>`;
            ct_header = "text/html";
            break;
          default:
            body = String(params.data || "");
            ct_header = "text/plain";
        }
        return JSON.stringify({ status, headers: { "Content-Type": ct_header }, body });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private path_matches(pattern: string, path: string): boolean {
    const regex = pattern.replace(/:[^/]+/g, "[^/]+").replace(/\*/g, ".*");
    return new RegExp(`^${regex}$`).test(path);
  }
}
