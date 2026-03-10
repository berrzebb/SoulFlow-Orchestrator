/** Retriever (검색/조회) 노드 핸들러. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { RetrieverNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { validate_url } from "../tools/http-utils.js";

export const retriever_handler: NodeHandler = {
  node_type: "retriever",
  icon: "⤓",
  color: "#00bcd4",
  shape: "rect",
  output_schema: [
    { name: "results", type: "array",  description: "Retrieved results" },
    { name: "count",   type: "number", description: "Result count" },
    { name: "query",   type: "string", description: "Resolved query" },
  ],
  input_schema: [
    { name: "query",  type: "string", description: "Search query" },
    { name: "source", type: "string", description: "Source type (http, file, memory)" },
  ],
  create_default: () => ({ source: "http", query: "", url: "", top_k: 5 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as RetrieverNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const query = resolve_templates(n.query, tpl_ctx);
    const top_k = n.top_k ?? 5;

    switch (n.source) {
      case "http": {
        const url = resolve_templates(n.url || "", tpl_ctx);
        if (!url) throw new Error("retriever: url is required for http source");

        const parsed = validate_url(url);
        if (typeof parsed === "string") throw new Error(`retriever: ${parsed}`);

        const method = n.method || "GET";
        const fetchUrl = method === "GET"
          ? `${url}${url.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`
          : url;
        const resp = await fetch(fetchUrl, {
          method,
          headers: { "Content-Type": "application/json" },
          body: method === "POST" ? JSON.stringify({ query, top_k }) : undefined,
          signal: ctx.abort_signal,
        });
        const body = await resp.json() as unknown;
        const results = Array.isArray(body) ? body.slice(0, top_k) : [body];
        return { output: { results, count: results.length, query } };
      }

      case "memory": {
        const results: Array<{ key: string; value: unknown }> = [];
        const lower = query.toLowerCase();
        for (const [key, value] of Object.entries(ctx.memory)) {
          const str = typeof value === "string" ? value : JSON.stringify(value);
          if (str.toLowerCase().includes(lower)) {
            results.push({ key, value });
            if (results.length >= top_k) break;
          }
        }
        return { output: { results, count: results.length, query } };
      }

      case "file": {
        return { output: { results: [], count: 0, query, _meta: { file_path: n.file_path, source: "file" } } };
      }

      default:
        throw new Error(`retriever: unknown source type: ${n.source}`);
    }
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as RetrieverNodeDefinition;
    if (n.source !== "file") return this.execute(node, ctx);

    const tpl_ctx = { memory: ctx.memory };
    const query = resolve_templates(n.query, tpl_ctx);
    const file_path = resolve_templates(n.file_path || "", tpl_ctx);
    const top_k = n.top_k ?? 5;

    if (!file_path) {
      return { output: { results: [], count: 0, query, error: "file_path is required" } };
    }

    try {
      const workspace = runner.options.workspace;
      if (!workspace) throw new Error("workspace is required for retriever node");
      const abs = resolve(workspace, file_path);
      // 경로 순회 방지
      if (!abs.startsWith(resolve(workspace))) {
        return { output: { results: [], count: 0, query, error: "path traversal blocked" } };
      }

      const content = await readFile(abs, "utf-8");
      const lower = query.toLowerCase();
      const lines = content.split("\n");
      const results: Array<{ line: number; text: string }> = [];
      for (let i = 0; i < lines.length && results.length < top_k; i++) {
        if (lines[i].toLowerCase().includes(lower)) {
          results.push({ line: i + 1, text: lines[i] });
        }
      }
      return { output: { results, count: results.length, query } };
    } catch (err) {
      return { output: { results: [], count: 0, query, error: String((err as Error)?.message || err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as RetrieverNodeDefinition;
    const warnings: string[] = [];
    if (!n.query) warnings.push("query is empty");
    if (n.source === "http" && !n.url) warnings.push("url is required for http source");
    if (n.source === "file" && !n.file_path) warnings.push("file_path is required for file source");
    return {
      preview: { source: n.source, query: n.query, top_k: n.top_k ?? 5 },
      warnings,
    };
  },
};
