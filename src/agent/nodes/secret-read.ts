/** Secret Read 노드 핸들러 — 워크플로우에서 시크릿 주입. */

import type { NodeHandler } from "../node-registry.js";
import type { SecretReadNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const secret_read_handler: NodeHandler = {
  node_type: "secret_read",
  icon: "\u{1F511}",
  color: "#d84315",
  shape: "rect",
  output_schema: [
    { name: "value", type: "string", description: "Secret value (masked in logs)" },
    { name: "success", type: "boolean", description: "Whether secret was found" },
  ],
  input_schema: [
    { name: "key", type: "string", description: "Secret key name" },
    { name: "namespace", type: "string", description: "Secret namespace" },
  ],
  create_default: () => ({ key: "", namespace: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SecretReadNodeDefinition;
    try {
      const key = resolve_templates(n.key || "", { memory: ctx.memory });
      const ns = n.namespace || "";

      /* 환경변수에서 시크릿 읽기 */
      const env_key = ns ? `${ns.toUpperCase()}_${key.toUpperCase()}` : key.toUpperCase();
      const env_val = process.env[env_key];
      return { output: { value: env_val || "", success: !!env_val } };
    } catch (_err) {
      return { output: { value: "", success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SecretReadNodeDefinition;
    const warnings: string[] = [];
    if (!n.key) warnings.push("key is required");
    return { preview: { key: n.key, namespace: n.namespace || "(default)" }, warnings };
  },
};
