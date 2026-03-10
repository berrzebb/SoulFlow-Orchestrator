/** YAML 노드 핸들러 — 워크플로우에서 YAML 파싱/생성/머지. */

import type { NodeHandler } from "../node-registry.js";
import type { YamlNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const yaml_handler: NodeHandler = {
  node_type: "yaml",
  icon: "\u{1F4C3}",
  color: "#9e9e9e",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Parsed JSON or generated YAML" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse / generate / merge / validate / query" },
    { name: "data", type: "string", description: "YAML or JSON data" },
  ],
  create_default: () => ({ action: "parse", data: "", data2: "", path: "", indent: 2, format: "yaml", required_keys: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as YamlNodeDefinition;
    const tpl = { memory: ctx.memory };
    const action = n.action || "parse";
    const data = resolve_templates(n.data || "", tpl);
    const data2 = resolve_templates(n.data2 || "", tpl);

    try {
      let raw: string;
      if (n.format === "toml") {
        const { TomlTool } = await import("../tools/toml.js");
        const tool = new TomlTool();
        raw = await tool.execute({ action, input: data, path: n.path || "", second: data2 });
      } else if (n.format === "ini") {
        const { IniTool } = await import("../tools/ini.js");
        const tool = new IniTool();
        raw = await tool.execute({ action, input: data, data, section: n.ini_section || "", key: n.ini_key || "", second: data2 });
      } else if (n.format === "dotenv") {
        const { DotenvTool } = await import("../tools/dotenv.js");
        const tool = new DotenvTool();
        raw = await tool.execute({ action, input: data, data, second: data2, required_keys: n.required_keys || "" });
      } else {
        const { YamlTool } = await import("../tools/yaml.js");
        const tool = new YamlTool();
        raw = await tool.execute({ action, data, data2, path: n.path || "", indent: n.indent || 2 });
      }
      const parsed = raw.startsWith("{") || raw.startsWith("[") ? JSON.parse(raw) : raw;
      return { output: { result: parsed, success: !String(raw).startsWith("Error:") } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as YamlNodeDefinition;
    const warnings: string[] = [];
    if (!n.data) warnings.push("data is required");
    return { preview: { action: n.action }, warnings };
  },
};
