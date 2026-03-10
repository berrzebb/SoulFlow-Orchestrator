/** SVG 노드 핸들러 — SVG 프리미티브 생성/차트 렌더링/Data URI 변환. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type SvgNodeDefinition = OrcheNodeDefinition & {
  action?: string;
  x?: number; y?: number;
  width?: number; height?: number;
  cx?: number; cy?: number; r?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  d?: string;
  content?: string;
  fill?: string; stroke?: string; stroke_width?: number;
  rx?: number; ry?: number;
  font_size?: number;
  children?: string;
  svg?: string;
  view_box?: string;
  chart_type?: string;
  data?: string;
  chart_title?: string;
};

export const svg_handler: NodeHandler = {
  node_type: "svg",
  icon: "\u{1F5BC}",
  color: "#6a1b9a",
  shape: "rect",
  output_schema: [
    { name: "svg",      type: "string",  description: "SVG element or full SVG string" },
    { name: "data_uri", type: "string",  description: "data:image/svg+xml;base64,... URI" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "rect/circle/line/path/text/group/viewBox/to_data_uri/chart" },
  ],
  create_default: () => ({
    action: "chart", chart_type: "bar", data: '[{"label":"A","value":10},{"label":"B","value":20}]',
    chart_title: "", width: 400, height: 300,
    x: 0, y: 0, cx: 50, cy: 50, r: 40,
    fill: "#4A90D9", stroke: "", stroke_width: 2, content: "", children: "[]",
    view_box: "", svg: "", d: "",
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SvgNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { SvgTool } = await import("../tools/svg.js");
      const tool = new SvgTool();
      const raw = await tool.execute({
        action: n.action || "chart",
        x: n.x, y: n.y, width: n.width, height: n.height,
        cx: n.cx, cy: n.cy, r: n.r,
        x1: n.x1, y1: n.y1, x2: n.x2, y2: n.y2,
        d: n.d ? resolve_templates(n.d, tpl) : undefined,
        content: n.content ? resolve_templates(n.content, tpl) : undefined,
        fill: n.fill, stroke: n.stroke, stroke_width: n.stroke_width,
        rx: n.rx, ry: n.ry, font_size: n.font_size,
        children: n.children ? resolve_templates(n.children, tpl) : undefined,
        svg: n.svg ? resolve_templates(n.svg, tpl) : undefined,
        view_box: n.view_box || undefined,
        chart_type: n.chart_type || undefined,
        data: n.data ? resolve_templates(n.data, tpl) : undefined,
        title: n.chart_title ? resolve_templates(n.chart_title, tpl) : undefined,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SvgNodeDefinition;
    const warnings: string[] = [];
    if (n.action === "chart" && !n.data?.trim()) warnings.push("data is required for chart");
    if (n.action === "to_data_uri" && !n.svg?.trim()) warnings.push("svg is required for to_data_uri");
    return { preview: { action: n.action, chart_type: n.chart_type }, warnings };
  },
};
