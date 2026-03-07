/** StateMachine 노드 핸들러 — 워크플로우에서 FSM 전이/검증/시각화. */

import type { NodeHandler } from "../node-registry.js";
import type { StateMachineNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const state_machine_handler: NodeHandler = {
  node_type: "state_machine",
  icon: "\u{1F504}",
  color: "#00695c",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "State machine operation result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "define / transition / validate / visualize / reachable / history" },
    { name: "machine", type: "string", description: "Machine definition JSON" },
  ],
  create_default: () => ({ action: "define", machine: '{"initial":"idle","states":[{"name":"idle","on":{"start":"running"}},{"name":"running","on":{"stop":"idle"}}]}' }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as StateMachineNodeDefinition;
    try {
      const { StateMachineTool } = await import("../tools/state-machine.js");
      const tool = new StateMachineTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "define",
        machine: n.machine ? resolve_templates(n.machine, tpl) : undefined,
        current: n.current ? resolve_templates(n.current, tpl) : undefined,
        event: n.event ? resolve_templates(n.event, tpl) : undefined,
        events: n.events ? resolve_templates(n.events, tpl) : undefined,
      });
      return { output: { result: JSON.parse(result) } };
    } catch {
      return { output: { result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as StateMachineNodeDefinition;
    const warnings: string[] = [];
    if (!n.machine) warnings.push("machine definition is required");
    if (n.action === "transition" && !n.event) warnings.push("event is required for transition");
    return { preview: { action: n.action, current: n.current }, warnings };
  },
};
