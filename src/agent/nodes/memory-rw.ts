/** Memory R/W 노드 핸들러 — 워크플로우에서 영구 메모리 읽기/쓰기. */

import type { NodeHandler } from "../node-registry.js";
import type { MemoryRwNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const memory_rw_handler: NodeHandler = {
  node_type: "memory_rw",
  icon: "\u{1F9E0}",
  color: "#6a1b9a",
  shape: "rect",
  output_schema: [
    { name: "value", type: "string", description: "Memory value" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "get/set/delete/list" },
    { name: "key", type: "string", description: "Memory key" },
    { name: "value", type: "string", description: "Value to store (set)" },
  ],
  create_default: () => ({ action: "get", key: "", value: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as MemoryRwNodeDefinition;
    const tpl = { memory: ctx.memory };
    const action = n.action || "get";
    const key = resolve_templates(n.key || "", tpl);

    if (action === "get") {
      const val = ctx.memory?.[key];
      return { output: { value: val !== undefined ? String(val) : "", success: val !== undefined } };
    }
    if (action === "set") {
      const value = resolve_templates(n.value || "", tpl);
      if (ctx.memory) ctx.memory[key] = value;
      return { output: { value, success: true } };
    }
    if (action === "delete") {
      const existed = ctx.memory ? key in ctx.memory : false;
      if (ctx.memory) delete ctx.memory[key];
      return { output: { value: "", success: existed } };
    }
    if (action === "list") {
      const keys = ctx.memory ? Object.keys(ctx.memory) : [];
      return { output: { value: JSON.stringify(keys), success: true } };
    }
    return { output: { value: "", success: false } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as MemoryRwNodeDefinition;
    return { preview: { action: n.action, key: n.key }, warnings: [] };
  },
};
