/** Semver 노드 핸들러 — 시맨틱 버전 비교/bump/검증. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type SemverNodeDefinition = OrcheNodeDefinition & {
  action?: string;
  version?: string;
  version2?: string;
  range?: string;
  bump_type?: string;
  versions?: string;
}

export const semver_handler: NodeHandler = {
  node_type: "semver",
  icon: "\u{1F4CC}",
  color: "#00695c",
  shape: "rect",
  output_schema: [
    { name: "valid",    type: "boolean", description: "Whether version is valid" },
    { name: "result",   type: "string",  description: "Comparison result or bumped version" },
    { name: "sorted",   type: "array",   description: "Sorted version list" },
    { name: "satisfies", type: "boolean", description: "Whether version satisfies range" },
  ],
  input_schema: [
    { name: "action",  type: "string", description: "parse/compare/satisfies/bump/sort/diff/valid" },
    { name: "version", type: "string", description: "Semantic version (e.g. 1.2.3)" },
  ],
  create_default: () => ({ action: "valid", version: "", version2: "", range: "", bump_type: "patch", versions: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SemverNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { SemverTool } = await import("../tools/semver.js");
      const tool = new SemverTool();
      const raw = await tool.execute({
        action:    n.action || "valid",
        version:   resolve_templates(n.version || "", tpl),
        version2:  resolve_templates(n.version2 || "", tpl) || undefined,
        range:     resolve_templates(n.range || "", tpl) || undefined,
        bump_type: n.bump_type || undefined,
        versions:  resolve_templates(n.versions || "", tpl) || undefined,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SemverNodeDefinition;
    const warnings: string[] = [];
    if (!n.version?.trim() && n.action !== "sort") warnings.push("version is required");
    if (n.action === "satisfies" && !n.range?.trim()) warnings.push("range is required for satisfies");
    return { preview: { action: n.action, version: n.version }, warnings };
  },
};
