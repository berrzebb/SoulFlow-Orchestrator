/** Wait (대기) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { WaitNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";

export const wait_handler: NodeHandler = {
  node_type: "wait",
  icon: "⏸",
  color: "#607d8b",
  shape: "rect",
  output_schema: [
    { name: "resumed_at", type: "string", description: "Resume timestamp" },
    { name: "payload",    type: "object", description: "Webhook/approval payload" },
  ],
  input_schema: [
    { name: "data", type: "object", description: "Data to pass through" },
  ],
  create_default: () => ({ wait_type: "timer", delay_ms: 5000 }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    // 스텁: 실제 대기 로직은 추후 구현
    return { output: { resumed_at: new Date().toISOString(), payload: null } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as WaitNodeDefinition;
    const warnings: string[] = [];
    return { preview: { wait_type: n.wait_type, delay_ms: n.delay_ms }, warnings };
  },
};
