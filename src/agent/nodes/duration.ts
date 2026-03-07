/** Duration 노드 핸들러 — 워크플로우에서 기간 계산. */

import type { NodeHandler } from "../node-registry.js";
import type { DurationNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const duration_handler: NodeHandler = {
  node_type: "duration",
  icon: "\u23F1\uFE0F",
  color: "#00897b",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Duration calculation result" },
    { name: "ms", type: "number", description: "Duration in milliseconds" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse / format / to_ms / from_ms / add / subtract / humanize" },
    { name: "duration", type: "string", description: "Duration string (ISO 8601 or human)" },
  ],
  create_default: () => ({ action: "parse", duration: "PT1H" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DurationNodeDefinition;
    try {
      const { DurationTool } = await import("../tools/duration.js");
      const tool = new DurationTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "parse",
        duration: resolve_templates(n.duration || "", tpl),
        duration2: n.duration2 ? resolve_templates(n.duration2, tpl) : undefined,
        ms: n.ms,
      });
      const parsed = JSON.parse(result);
      return { output: { result: parsed, ms: parsed.ms ?? 0 } };
    } catch {
      return { output: { result: null, ms: 0 } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DurationNodeDefinition;
    const warnings: string[] = [];
    if (!n.duration && n.action !== "from_ms") warnings.push("duration is required");
    return { preview: { action: n.action, duration: n.duration }, warnings };
  },
};
