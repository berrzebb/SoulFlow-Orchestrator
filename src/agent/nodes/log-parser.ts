/** Log Parser 노드 핸들러 — 워크플로우에서 로그 파싱. */

import type { NodeHandler } from "../node-registry.js";
import type { LogParserNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const log_parser_handler: NodeHandler = {
  node_type: "log_parser",
  icon: "\u{1F4DC}",
  color: "#607d8b",
  shape: "rect",
  output_schema: [
    { name: "records", type: "unknown", description: "Parsed log records" },
    { name: "count", type: "number", description: "Number of records" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse_json / parse_apache / parse_nginx / parse_syslog / parse_custom" },
    { name: "input", type: "string", description: "Log content" },
  ],
  create_default: () => ({ action: "parse_json", input: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as LogParserNodeDefinition;
    try {
      const { LogParserTool } = await import("../tools/log-parser.js");
      const tool = new LogParserTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "parse_json",
        input: resolve_templates(n.input || "", tpl),
        pattern: n.pattern,
        field: n.field,
        value: n.value,
        level: n.level,
      });
      const parsed = JSON.parse(result);
      return { output: { records: parsed.records || [], count: parsed.count || 0 } };
    } catch {
      return { output: { records: [], count: 0 } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as LogParserNodeDefinition;
    const warnings: string[] = [];
    if (!n.input) warnings.push("input is empty");
    return { preview: { action: n.action }, warnings };
  },
};
