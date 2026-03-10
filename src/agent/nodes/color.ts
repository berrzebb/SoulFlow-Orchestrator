/** Color 노드 핸들러 — 색상 변환/블렌드/팔레트/대비 계산. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

interface ColorNodeDefinition extends OrcheNodeDefinition {
  action?: string;
  color?: string;
  color2?: string;
  format?: string;
  amount?: number;
  count?: number;
}

export const color_handler: NodeHandler = {
  node_type: "color",
  icon: "\u{1F3A8}",
  color: "#e64a19",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Converted/resulting color hex" },
    { name: "hex",     type: "string",  description: "Hex representation" },
    { name: "rgb",     type: "array",   description: "RGB array [r, g, b]" },
    { name: "hsl",     type: "array",   description: "HSL array [h, s, l]" },
    { name: "palette", type: "array",   description: "Color palette (palette action)" },
    { name: "ratio",   type: "number",  description: "Contrast ratio (contrast action)" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse/convert/blend/contrast/lighten/darken/palette/complement" },
    { name: "color",  type: "string", description: "Color value (hex, rgb, hsl)" },
  ],
  create_default: () => ({ action: "parse", color: "#3498db", color2: "", format: "hex", amount: 0.2, count: 5 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ColorNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { ColorTool } = await import("../tools/color.js");
      const tool = new ColorTool();
      const raw = await tool.execute({
        action: n.action || "parse",
        color:  resolve_templates(n.color || "", tpl),
        color2: resolve_templates(n.color2 || "", tpl) || undefined,
        format: n.format || undefined,
        amount: n.amount,
        count:  n.count,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as ColorNodeDefinition;
    const warnings: string[] = [];
    if (!n.color?.trim()) warnings.push("color is required");
    const needs_color2 = ["blend", "contrast"];
    if (needs_color2.includes(n.action || "") && !n.color2?.trim()) warnings.push("color2 is required for this action");
    return { preview: { action: n.action, color: n.color }, warnings };
  },
};
