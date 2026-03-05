/** Split (배열 분해) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { SplitNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const split_handler: NodeHandler = {
  node_type: "split",
  icon: "↕",
  color: "#16a085",
  shape: "diamond",
  output_schema: [
    { name: "item",  type: "unknown", description: "Individual array item" },
    { name: "index", type: "number",  description: "Current item index" },
    { name: "total", type: "number",  description: "Total item count" },
  ],
  input_schema: [
    { name: "array", type: "array", description: "Array to split" },
  ],
  create_default: () => ({ array_field: "" }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    // 스텁: 실제 구현은 phase-loop-runner에서 배열 반복 처리
    return { output: { item: null, index: 0, total: 0 } };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as SplitNodeDefinition;
    const warnings: string[] = [];
    const tpl_ctx = { memory: ctx.memory };
    const array_field = resolve_templates(n.array_field, tpl_ctx);
    return { preview: { array_field, batch_size: n.batch_size || 1 }, warnings };
  },
};
