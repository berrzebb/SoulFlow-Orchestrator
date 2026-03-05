/** Set (변수 할당) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { SetNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_deep } from "../orche-node-executor.js";

/** dot-notation 경로로 중첩 객체에 값 설정. */
function set_nested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current[part] == null || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1]!;
  current[last] = value;
}

export const set_handler: NodeHandler = {
  node_type: "set",
  icon: "=",
  color: "#1abc9c",
  shape: "rect",
  output_schema: [],  // 동적: assignments 키에서 추출
  input_schema: [],
  create_default: () => ({ assignments: [] }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SetNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const result: Record<string, unknown> = {};
    for (const { key, value } of n.assignments) {
      const resolved = resolve_deep(value, tpl_ctx);
      result[key] = resolved;
      set_nested(ctx.memory, key, resolved);
    }
    return { output: result };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as SetNodeDefinition;
    const warnings: string[] = [];
    const tpl_ctx = { memory: ctx.memory };
    const resolved = n.assignments.map(({ key, value }) => ({
      key, resolved_value: resolve_deep(value, tpl_ctx),
    }));
    return { preview: { assignments: resolved }, warnings };
  },
};
