/** HTTP 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { HttpNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, resolve_deep } from "../orche-node-executor.js";

const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;

export const http_handler: NodeHandler = {
  node_type: "http",
  icon: "↗",
  color: "#3498db",
  shape: "rect",
  output_schema: [
    { name: "status",       type: "number",  description: "HTTP status code" },
    { name: "body",         type: "object",  description: "Response body" },
    { name: "content_type", type: "string",  description: "Content-Type header" },
    { name: "headers",      type: "object",  description: "Response headers" },
  ],
  input_schema: [
    { name: "url",     type: "string", description: "Request URL" },
    { name: "headers", type: "object", description: "Request headers" },
    { name: "body",    type: "object", description: "Request body" },
  ],
  create_default: () => ({ url: "", method: "GET" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as HttpNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const url_str = resolve_templates(n.url, tpl_ctx);

    const parsed_url = new URL(url_str);
    if (parsed_url.protocol !== "http:" && parsed_url.protocol !== "https:") {
      throw new Error(`unsupported protocol "${parsed_url.protocol}"`);
    }
    // Node.js URL.hostname은 IPv6를 브래킷 포함으로 반환 (예: [::1])
    const hostname = parsed_url.hostname.replace(/^\[|\]$/g, "");
    if (PRIVATE_HOST_RE.test(hostname)) {
      throw new Error(`private/loopback host blocked "${parsed_url.hostname}"`);
    }

    const timeout_ms = Math.min(30_000, Math.max(100, n.timeout_ms || 10_000));
    const req_headers: Record<string, string> = {};
    if (n.headers) {
      for (const [k, v] of Object.entries(n.headers)) {
        req_headers[k] = resolve_templates(v, tpl_ctx);
      }
    }
    // user_agent 필드가 설정되어 있으면 User-Agent 헤더로 추가 (headers에 이미 있으면 무시)
    if (n.user_agent && !Object.keys(req_headers).some((k) => k.toLowerCase() === "user-agent")) {
      req_headers["User-Agent"] = resolve_templates(n.user_agent, tpl_ctx);
    }

    let body_str: string | undefined;
    if (n.body !== undefined && n.body !== null) {
      const resolved = resolve_deep(n.body, tpl_ctx);
      if (typeof resolved === "string") {
        body_str = resolved;
      } else {
        body_str = JSON.stringify(resolved);
        if (!Object.keys(req_headers).some((k) => k.toLowerCase() === "content-type")) {
          req_headers["Content-Type"] = "application/json";
        }
      }
    }

    const controller = new AbortController();
    const combined = ctx.abort_signal
      ? AbortSignal.any([ctx.abort_signal, controller.signal])
      : controller.signal;
    const timer = setTimeout(() => controller.abort(), timeout_ms);

    try {
      const res = await fetch(url_str, {
        method: n.method || "GET",
        headers: req_headers,
        body: body_str,
        signal: combined,
      });
      const content_type = res.headers.get("content-type") || "";
      const raw_text = await res.text();
      const max_chars = 50_000;
      const truncated = raw_text.length > max_chars;
      const text_out = truncated ? `${raw_text.slice(0, max_chars)}...(truncated)` : raw_text;

      let body_out: unknown = text_out;
      if (content_type.includes("application/json") && !truncated) {
        try { body_out = JSON.parse(raw_text); } catch { /* keep as string */ }
      }

      return {
        output: { status: res.status, status_text: res.statusText, content_type, body: body_out, truncated },
      };
    } finally {
      clearTimeout(timer);
    }
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as HttpNodeDefinition;
    const warnings: string[] = [];
    const tpl_ctx = { memory: ctx.memory };
    const url = resolve_templates(n.url, tpl_ctx);
    const headers = n.headers
      ? Object.fromEntries(Object.entries(n.headers).map(([k, v]) => [k, resolve_templates(v, tpl_ctx)]))
      : undefined;
    const body = n.body ? resolve_deep(n.body, tpl_ctx) : undefined;
    if (!url) warnings.push("url is empty after template resolution");
    return { preview: { method: n.method || "GET", url, headers, body }, warnings };
  },
};
