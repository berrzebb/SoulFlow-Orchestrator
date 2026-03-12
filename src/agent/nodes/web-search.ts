/** Web Search 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { WebSearchNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message, make_abort_signal } from "../../utils/common.js";
import { HTTP_FETCH_SHORT_TIMEOUT_MS } from "../../utils/timeouts.js";

export const web_search_handler: NodeHandler = {
  node_type: "web_search",
  icon: "\u{1F50D}",
  color: "#4285f4",
  shape: "rect",
  output_schema: [
    { name: "results", type: "array",  description: "Search results" },
    { name: "query",   type: "string", description: "Resolved search query" },
    { name: "count",   type: "number", description: "Number of results" },
  ],
  input_schema: [
    { name: "query",    type: "string", description: "Search query" },
    { name: "max_results", type: "number", description: "Max results to return" },
  ],
  create_default: () => ({ query: "", max_results: 5, search_engine: "google" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as WebSearchNodeDefinition;
    const tpl = { memory: ctx.memory };
    const query = resolve_templates(n.query || "", tpl).trim();

    if (!query) return { output: { results: [], query: "", count: 0, error: "query is empty" } };

    const max_results = Math.min(20, Math.max(1, n.max_results || 5));

    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${max_results}`;
      const signal = make_abort_signal(HTTP_FETCH_SHORT_TIMEOUT_MS, ctx.abort_signal);
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SoulFlowBot/1.0)" },
        signal,
      });
      const html = await res.text();
      const results = extract_search_results(html, max_results);
      return { output: { results, query, count: results.length } };
    } catch (err) {
      return { output: { results: [], query, count: 0, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as WebSearchNodeDefinition;
    const warnings: string[] = [];
    if (!n.query?.trim()) warnings.push("query is empty");
    return { preview: { query: n.query, max_results: n.max_results }, warnings };
  },
};

function extract_search_results(html: string, max: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const link_re = /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>(.*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = link_re.exec(html)) !== null && results.length < max) {
    const url = decodeURIComponent(match[1]);
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    if (url.startsWith("http") && title) {
      results.push({ title, url, snippet: "" });
    }
  }
  return results;
}
