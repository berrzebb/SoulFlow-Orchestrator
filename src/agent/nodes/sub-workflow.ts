/** Sub-workflow (하위 워크플로우 호출) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { SubWorkflowNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";

export const sub_workflow_handler: NodeHandler = {
  node_type: "sub_workflow",
  icon: "↪",
  color: "#673ab7",
  shape: "rect",
  output_schema: [
    { name: "result", type: "object", description: "Sub-workflow final output" },
    { name: "phases", type: "array",  description: "Phase results array" },
  ],
  input_schema: [
    { name: "variables", type: "object", description: "Input variables for sub-workflow" },
  ],
  create_default: () => ({ workflow_name: "" }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    // 스텁: 실제 하위 워크플로우 호출은 추후 구현
    return { output: { result: null, phases: [] } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SubWorkflowNodeDefinition;
    const warnings: string[] = [];
    if (!n.workflow_name?.trim()) warnings.push("workflow_name is required");
    return { preview: { workflow_name: n.workflow_name, input_mapping: n.input_mapping }, warnings };
  },
};
