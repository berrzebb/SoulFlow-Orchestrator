/** URL 노드 핸들러 — URL 파싱/빌드/인코딩/쿼리 파라미터 조작. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type UrlNodeDefinition = OrcheNodeDefinition & {
  action?: string;
  url?: string;
  base?: string;
  params?: string;
  parts?: string;
  segments?: string;
  component?: string;
}

export const url_handler: NodeHandler = {
  node_type: "url",
  icon: "\u{1F517}",
  color: "#1565c0",
  shape: "rect",
  output_schema: [
    { name: "result", type: "string",  description: "Resulting URL or encoded string" },
    { name: "query",  type: "object",  description: "Parsed query parameters (parse/query_params)" },
    { name: "path",   type: "string",  description: "Joined path (join)" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse/build/resolve/encode/decode/query_params/join/normalize" },
    { name: "url",    type: "string", description: "URL string" },
  ],
  create_default: () => ({ action: "parse", url: "", base: "", params: "", parts: "", segments: "", component: "component" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as UrlNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { UrlTool } = await import("../tools/url.js");
      const tool = new UrlTool();
      const raw = await tool.execute({
        action: n.action || "parse",
        url:      resolve_templates(n.url || "", tpl),
        base:     resolve_templates(n.base || "", tpl) || undefined,
        params:   resolve_templates(n.params || "", tpl) || undefined,
        parts:    resolve_templates(n.parts || "", tpl) || undefined,
        segments: resolve_templates(n.segments || "", tpl) || undefined,
        component: n.component || undefined,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as UrlNodeDefinition;
    const warnings: string[] = [];
    if (!n.url?.trim() && n.action !== "build" && n.action !== "join") warnings.push("url is required");
    return { preview: { action: n.action }, warnings };
  },
};
