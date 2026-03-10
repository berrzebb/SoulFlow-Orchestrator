/** DataFormat 노드 핸들러 — 워크플로우에서 데이터 포맷 변환. */

import type { NodeHandler } from "../node-registry.js";
import type { DataFormatNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const data_format_handler: NodeHandler = {
  node_type: "data_format",
  icon: "\u{1F504}",
  color: "#00838f",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Converted/queried data" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "convert/query/flatten/merge/pick/omit" },
    { name: "input",     type: "string", description: "Input data" },
    { name: "from",      type: "string", description: "Source format" },
    { name: "to",        type: "string", description: "Target format" },
  ],
  create_default: () => ({ operation: "convert", input: "", from: "json", to: "csv", path: "", keys: "", input2: "", delimiter: ",", mime_extension: "", mime_filename: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DataFormatNodeDefinition;
    const tpl = { memory: ctx.memory };
    const input = resolve_templates(n.input || "", tpl);
    const op = resolve_templates(n.operation || "convert", tpl);

    // MIME 연산은 MimeTool로 위임
    const MIME_OPS = ["mime_lookup", "mime_detect", "mime_parse", "mime_reverse"];
    if (MIME_OPS.includes(op)) {
      try {
        const { MimeTool } = await import("../tools/mime.js");
        const tool = new MimeTool();
        const action_map: Record<string, string> = {
          mime_lookup: "lookup", mime_detect: "detect", mime_parse: "parse", mime_reverse: "reverse_lookup",
        };
        const result = await tool.execute({
          action: action_map[op] || "lookup",
          extension: resolve_templates(n.mime_extension || "", tpl) || undefined,
          filename: resolve_templates(n.mime_filename || input || "", tpl) || undefined,
          mime: input || undefined,
        });
        return { output: { result, success: true } };
      } catch (err) {
        return { output: { result: error_message(err), success: false } };
      }
    }

    // HTTP 헤더 연산은 HttpHeaderTool로 위임
    const HEADER_OPS = ["header_parse", "header_content_type", "header_cache_control", "header_authorization", "header_content_disposition"];
    if (HEADER_OPS.includes(op)) {
      try {
        const { HttpHeaderTool } = await import("../tools/http-header.js");
        const tool = new HttpHeaderTool();
        const action_map: Record<string, string> = {
          header_parse: "parse",
          header_content_type: "content_type",
          header_cache_control: "cache_control",
          header_authorization: "authorization",
          header_content_disposition: "content_disposition",
        };
        const result = await tool.execute({
          action: action_map[op] || "parse",
          header: input || undefined,
          type: resolve_templates(n.header_type || "", tpl) || undefined,
          token: resolve_templates(n.header_token || "", tpl) || undefined,
          filename: resolve_templates(n.header_filename || "", tpl) || undefined,
          directives: resolve_templates(n.header_directives || "", tpl) || undefined,
        });
        return { output: { result, success: true } };
      } catch (err) {
        return { output: { result: error_message(err), success: false } };
      }
    }

    try {
      const { DataFormatTool } = await import("../tools/data-format.js");
      const tool = new DataFormatTool();
      const result = await tool.execute({
        operation: op,
        input,
        from: n.from || "json",
        to: n.to || "json",
        path: n.path || "",
        keys: n.keys || "",
        input2: resolve_templates(n.input2 || "", tpl),
        delimiter: n.delimiter || ",",
      });
      const is_error = result.startsWith("Error:");
      return { output: { result, success: !is_error } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DataFormatNodeDefinition;
    const warnings: string[] = [];
    if (!n.input?.trim()) warnings.push("input is required");
    if (n.operation === "convert" && n.from === n.to) warnings.push("from and to formats are the same");
    return { preview: { operation: n.operation, from: n.from, to: n.to }, warnings };
  },
};
