/** ASCII Art 노드 핸들러 — 배너/박스/테이블 ASCII 아트 생성. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type AsciiArtNodeDef = OrcheNodeDefinition & {
  action?: string;
  text?: string;
  char?: string;
  width?: number;
  padding?: number;
  style?: string;
  data?: string;
  headers?: string;
};

export const ascii_art_handler: NodeHandler = {
  node_type: "ascii_art",
  icon: "\u{1F3A8}",
  color: "#4a148c",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "node.ascii_art.output.result" },
    { name: "success", type: "boolean", description: "node.ascii_art.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.ascii_art.input.action" },
    { name: "text",   type: "string", description: "node.ascii_art.input.text" },
  ],
  create_default: () => ({
    action: "banner", text: "", char: "-", width: 60, padding: 1, style: "single", data: "", headers: "",
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as AsciiArtNodeDef;
    const tpl = { memory: ctx.memory };
    try {
      const { AsciiArtTool } = await import("../tools/ascii-art.js");
      const tool = new AsciiArtTool();
      const result = await tool.execute({
        action:  n.action || "banner",
        text:    resolve_templates(n.text    || "", tpl) || undefined,
        char:    n.char    || undefined,
        width:   n.width   || undefined,
        padding: n.padding || undefined,
        style:   n.style   || undefined,
        data:    resolve_templates(n.data    || "", tpl) || undefined,
        headers: resolve_templates(n.headers || "", tpl) || undefined,
      });
      return { output: { result, success: true } };
    } catch (err) {
      return { output: { result: "", success: false, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as AsciiArtNodeDef;
    const warnings: string[] = [];
    if (["banner", "figlet", "box", "border"].includes(n.action || "banner") && !n.text) {
      warnings.push("text is required for this action");
    }
    if (n.action === "table" && !n.data) warnings.push("data (JSON array) is required for table");
    return { preview: { action: n.action, text: n.text }, warnings };
  },
};
