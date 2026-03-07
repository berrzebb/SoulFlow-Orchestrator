/** Crypto 노드 핸들러 — 워크플로우에서 암복호화. */

import type { NodeHandler } from "../node-registry.js";
import type { CryptoNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const crypto_handler: NodeHandler = {
  node_type: "crypto",
  icon: "\u{1F510}",
  color: "#607d8b",
  shape: "rect",
  output_schema: [
    { name: "result", type: "string", description: "Operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "encrypt/decrypt/sign/verify/generate_key" },
    { name: "input", type: "string", description: "Input data" },
    { name: "key", type: "string", description: "Encryption/signing key" },
  ],
  create_default: () => ({ action: "encrypt", input: "", key: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CryptoNodeDefinition;
    try {
      const { CryptoTool } = await import("../tools/crypto.js");
      const tool = new CryptoTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "encrypt",
        input: resolve_templates(n.input || "", tpl),
        key: resolve_templates(n.key || "", tpl),
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as CryptoNodeDefinition;
    return { preview: { action: n.action }, warnings: [] };
  },
};
