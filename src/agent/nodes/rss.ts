/** RSS 노드 핸들러 — 워크플로우에서 RSS/Atom 피드 처리. */

import type { NodeHandler } from "../node-registry.js";
import type { RssNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const rss_handler: NodeHandler = {
  node_type: "rss",
  icon: "\u{1F4E1}",
  color: "#ee802f",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "RSS feed data" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse / generate / fetch_parse" },
    { name: "url", type: "string", description: "Feed URL (fetch_parse)" },
  ],
  create_default: () => ({ action: "fetch_parse", url: "", input: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as RssNodeDefinition;
    try {
      const { RssTool } = await import("../tools/rss.js");
      const tool = new RssTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "fetch_parse",
        url: n.url ? resolve_templates(n.url, tpl) : undefined,
        input: n.input ? resolve_templates(n.input, tpl) : undefined,
        title: n.feed_title,
        link: n.link,
        items: n.items,
      });
      const parsed = result.startsWith("{") || result.startsWith("[") ? JSON.parse(result) : { data: result };
      return { output: { result: parsed, success: !parsed.error } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as RssNodeDefinition;
    const warnings: string[] = [];
    if (n.action === "fetch_parse" && !n.url) warnings.push("url is required for fetch_parse");
    return { preview: { action: n.action, url: n.url }, warnings };
  },
};
