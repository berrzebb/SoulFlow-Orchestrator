/** Retriever 도구 — 벡터 스토어/메모리/HTTP 소스에서 관련 결과 검색. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class RetrieverTool extends Tool {
  readonly name = "retriever";
  readonly category = "ai" as const;
  readonly description = "Retrieve relevant results from vector stores, memory, or HTTP APIs. Actions: vector, http, memory.";
  readonly policy_flags = { network: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["vector", "http", "memory"], description: "Retrieval source" },
      query: { type: "string", description: "Search query text" },
      top_k: { type: "integer", description: "Max results to return (default: 5)" },
      url: { type: "string", description: "HTTP API endpoint (for http action)" },
      collection: { type: "string", description: "Vector store collection name (for vector action)" },
      data: { type: "string", description: "JSON object to search in (for memory action)" },
      min_score: { type: "number", description: "Minimum similarity score 0-1 (for vector action)" },
    },
    required: ["action", "query"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "memory");
    const query = String(params.query || "");
    const top_k = Math.max(1, Math.min(100, Number(params.top_k) || 5));

    switch (action) {
      case "http": return this.retrieve_http(query, top_k, params);
      case "memory": return this.retrieve_memory(query, top_k, params);
      case "vector": return this.retrieve_vector(query, top_k, params);
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private async retrieve_http(query: string, top_k: number, params: Record<string, unknown>): Promise<string> {
    const url = String(params.url || "");
    if (!url) return "Error: url is required for http action";

    const sep = url.includes("?") ? "&" : "?";
    const resp = await fetch(`${url}${sep}q=${encodeURIComponent(query)}&top_k=${top_k}`, {
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) return `Error: HTTP ${resp.status} ${resp.statusText}`;
    const body = await resp.json() as unknown;
    const results = Array.isArray(body) ? body.slice(0, top_k) : [body];
    return JSON.stringify({ results, count: results.length, source: "http" });
  }

  private retrieve_memory(query: string, top_k: number, params: Record<string, unknown>): string {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(String(params.data || "{}"));
    } catch {
      return "Error: data must be valid JSON object";
    }

    const lower = query.toLowerCase();
    const results: Array<{ key: string; value: unknown; score: number }> = [];

    for (const [key, value] of Object.entries(data)) {
      const str = typeof value === "string" ? value : JSON.stringify(value);
      const keyStr = key.toLowerCase();
      if (str.toLowerCase().includes(lower) || keyStr.includes(lower)) {
        const score = this.simple_relevance(lower, str.toLowerCase());
        results.push({ key, value, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return JSON.stringify({ results: results.slice(0, top_k), count: Math.min(results.length, top_k), source: "memory" });
  }

  private retrieve_vector(query: string, top_k: number, params: Record<string, unknown>): string {
    const collection = String(params.collection || "");
    if (!collection) return "Error: collection is required for vector action";
    return JSON.stringify({
      results: [],
      count: 0,
      source: "vector",
      note: "Use vector_store tool for actual vector queries. This provides a unified retrieval interface.",
      query,
      collection,
      top_k,
      min_score: Number(params.min_score) || 0,
    });
  }

  private simple_relevance(query: string, text: string): number {
    const words = query.split(/\s+/).filter(Boolean);
    if (words.length === 0) return 0;
    let matched = 0;
    for (const word of words) {
      if (text.includes(word)) matched++;
    }
    return matched / words.length;
  }
}
