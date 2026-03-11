/** Wait (대기) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { WaitNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { sleep, now_iso } from "../../utils/common.js";

const MAX_DELAY_MS = 5 * 60 * 1_000; // 5분

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

  async execute(node: OrcheNodeDefinition): Promise<OrcheNodeExecuteResult> {
    const n = node as WaitNodeDefinition;
    if (n.wait_type === "timer") {
      const ms = Math.min(Math.max(0, n.delay_ms ?? 5000), MAX_DELAY_MS);
      await sleep(ms);
      return { output: { resumed_at: now_iso(), payload: null } };
    }
    // webhook/approval은 phase-loop-runner에서 외부 신호로 resume
    return { output: { resumed_at: now_iso(), payload: null } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as WaitNodeDefinition;
    const warnings: string[] = [];
    if (n.wait_type === "timer" && (n.delay_ms ?? 0) > MAX_DELAY_MS) {
      warnings.push(`delay_ms exceeds maximum (${MAX_DELAY_MS}ms). Will be clamped.`);
    }
    return { preview: { wait_type: n.wait_type, delay_ms: n.delay_ms }, warnings };
  },
};
