/** Matrix 노드 핸들러 — 워크플로우에서 행렬 연산 실행. */

import type { NodeHandler } from "../node-registry.js";
import type { MatrixNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const matrix_handler: NodeHandler = {
  node_type: "matrix",
  icon: "\u{1F9EE}",
  color: "#4527a0",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Matrix operation result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "multiply / transpose / inverse / determinant / add / solve" },
    { name: "a", type: "string", description: "Matrix A as JSON 2D array" },
  ],
  create_default: () => ({ action: "multiply", a: "[[1,0],[0,1]]", b: "[[1,0],[0,1]]" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as MatrixNodeDefinition;
    try {
      const { MatrixTool } = await import("../tools/matrix.js");
      const tool = new MatrixTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "multiply",
        a: n.a ? resolve_templates(n.a, tpl) : undefined,
        b: n.b ? resolve_templates(n.b, tpl) : undefined,
        scalar: n.scalar,
        size: n.size,
      });
      return { output: { result: JSON.parse(result) } };
    } catch {
      return { output: { result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as MatrixNodeDefinition;
    const warnings: string[] = [];
    if (!n.a && n.action !== "identity") warnings.push("matrix A is required");
    if ((n.action === "multiply" || n.action === "add" || n.action === "subtract") && !n.b) {
      warnings.push("matrix B is required for this operation");
    }
    return { preview: { action: n.action }, warnings };
  },
};
