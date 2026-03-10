/** JSON Patch 노드 핸들러 — RFC 6902 JSON Patch 적용/생성/검증. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

interface JsonPatchNodeDefinition extends OrcheNodeDefinition {
  action?: string;
  document?: string;
  patch?: string;
  target?: string;
}

export const json_patch_handler: NodeHandler = {
  node_type: "json_patch",
  icon: "\u{1F527}",
  color: "#546e7a",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "object",  description: "Patched document" },
    { name: "patch",   type: "array",   description: "Generated patch operations (diff)" },
    { name: "valid",   type: "boolean", description: "Whether patch is valid" },
  ],
  input_schema: [
    { name: "action",   type: "string", description: "apply/diff/validate/test" },
    { name: "document", type: "string", description: "JSON document string" },
    { name: "patch",    type: "string", description: "JSON Patch array string" },
  ],
  create_default: () => ({ action: "apply", document: "{}", patch: "[]", target: "{}" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as JsonPatchNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { JsonPatchTool } = await import("../tools/json-patch.js");
      const tool = new JsonPatchTool();
      const raw = await tool.execute({
        action:   n.action || "apply",
        document: resolve_templates(n.document || "{}", tpl),
        patch:    resolve_templates(n.patch || "[]", tpl),
        target:   resolve_templates(n.target || "", tpl) || undefined,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as JsonPatchNodeDefinition;
    const warnings: string[] = [];
    if (!n.document?.trim()) warnings.push("document is required");
    if (n.action === "apply" && !n.patch?.trim()) warnings.push("patch is required for apply");
    if (n.action === "diff" && !n.target?.trim()) warnings.push("target is required for diff");
    return { preview: { action: n.action }, warnings };
  },
};
