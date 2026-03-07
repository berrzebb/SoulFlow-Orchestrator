/** Queue 노드 핸들러 — 워크플로우 인메모리 큐 조작. */

import type { NodeHandler } from "../node-registry.js";
import type { QueueNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

let shared_tool: InstanceType<typeof import("../tools/queue.js").QueueTool> | null = null;

export const queue_handler: NodeHandler = {
  node_type: "queue",
  icon: "\u{1F4E5}",
  color: "#e65100",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Queue operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "enqueue/dequeue/peek/size/drain/list/clear" },
    { name: "queue",     type: "string", description: "Queue name" },
    { name: "value",     type: "string", description: "Value" },
  ],
  create_default: () => ({ operation: "enqueue", queue: "default", value: "", mode: "fifo", priority: 50, count: 10 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as QueueNodeDefinition;
    try {
      if (!shared_tool) {
        const { QueueTool } = await import("../tools/queue.js");
        shared_tool = new QueueTool();
      }
      const result = await shared_tool.execute({
        operation: n.operation || "enqueue",
        queue: resolve_templates(n.queue || "default", { memory: ctx.memory }),
        value: resolve_templates(n.value || "", { memory: ctx.memory }),
        mode: n.mode || "fifo",
        priority: n.priority ?? 50,
        count: n.count ?? 10,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as QueueNodeDefinition;
    const warnings: string[] = [];
    if (n.operation === "enqueue" && !n.value?.trim()) warnings.push("value is required for enqueue");
    return { preview: { operation: n.operation, queue: n.queue, mode: n.mode }, warnings };
  },
};
