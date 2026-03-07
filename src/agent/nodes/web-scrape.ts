/** Web Scrape 노드 핸들러 — URL에서 콘텐츠를 추출. */

import type { NodeHandler } from "../node-registry.js";
import type { WebScrapeNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;

export const web_scrape_handler: NodeHandler = {
  node_type: "web_scrape",
  icon: "\u{1F578}",
  color: "#e67e22",
  shape: "rect",
  output_schema: [
    { name: "text",         type: "string", description: "Extracted text content" },
    { name: "title",        type: "string", description: "Page title" },
    { name: "status",       type: "number", description: "HTTP status code" },
    { name: "content_type", type: "string", description: "Content-Type" },
  ],
  input_schema: [
    { name: "url",     type: "string", description: "URL to scrape" },
    { name: "selector", type: "string", description: "CSS-like filter hint" },
  ],
  create_default: () => ({ url: "", selector: "", max_chars: 50000 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as WebScrapeNodeDefinition;
    const tpl = { memory: ctx.memory };
    const url_str = resolve_templates(n.url || "", tpl).trim();

    if (!url_str) return { output: { text: "", title: "", status: 0, error: "url is empty" } };

    try {
      const parsed = new URL(url_str);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { output: { text: "", title: "", status: 0, error: `unsupported protocol: ${parsed.protocol}` } };
      }
      // Node.js URL.hostname은 IPv6를 브래킷 포함으로 반환 (예: [::1])
      const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
      if (PRIVATE_HOST_RE.test(hostname)) {
        return { output: { text: "", title: "", status: 0, error: `blocked private host: ${parsed.hostname}` } };
      }
    } catch {
      return { output: { text: "", title: "", status: 0, error: "invalid URL" } };
    }

    const max_chars = Math.min(100_000, Math.max(1000, n.max_chars || 50_000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const signal = ctx.abort_signal
      ? AbortSignal.any([ctx.abort_signal, controller.signal])
      : controller.signal;

    try {
      const res = await fetch(url_str, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SoulFlowBot/1.0)" },
        signal,
      });
      const content_type = res.headers.get("content-type") || "";
      const raw = await res.text();
      const title = extract_title(raw);
      let text = strip_html(raw);
      if (text.length > max_chars) text = text.slice(0, max_chars) + "...(truncated)";

      return { output: { text, title, status: res.status, content_type } };
    } catch (err) {
      return { output: { text: "", title: "", status: 0, error: error_message(err) } };
    } finally {
      clearTimeout(timer);
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as WebScrapeNodeDefinition;
    const warnings: string[] = [];
    if (!n.url?.trim()) warnings.push("url is empty");
    return { preview: { url: n.url, selector: n.selector, max_chars: n.max_chars }, warnings };
  },
};

function extract_title(html: string): string {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/is);
  return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
}

function strip_html(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
