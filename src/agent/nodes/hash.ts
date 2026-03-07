/** Hash 노드 핸들러 — 워크플로우에서 해시 계산. */

import type { NodeHandler } from "../node-registry.js";
import type { HashNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const hash_handler: NodeHandler = {
  node_type: "hash",
  icon: "\u{1F512}",
  color: "#795548",
  shape: "rect",
  output_schema: [
    { name: "digest", type: "string", description: "Hash digest" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "hash/hmac/verify" },
    { name: "input", type: "string", description: "Input string" },
    { name: "algorithm", type: "string", description: "md5/sha256/sha512" },
  ],
  create_default: () => ({ action: "hash", input: "", algorithm: "sha256", key: "", encoding: "hex", expected: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as HashNodeDefinition;
    try {
      const { HashTool } = await import("../tools/hash.js");
      const tool = new HashTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "hash",
        input: resolve_templates(n.input || "", tpl),
        algorithm: n.algorithm || "sha256",
        key: resolve_templates(n.key || "", tpl),
        encoding: n.encoding || "hex",
        expected: n.expected || "",
      });
      return { output: { digest: result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { digest: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as HashNodeDefinition;
    return { preview: { action: n.action, algorithm: n.algorithm }, warnings: [] };
  },
};
