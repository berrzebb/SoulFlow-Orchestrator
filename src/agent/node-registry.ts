/**
 * Node Registry — 노드 핸들러 등록/조회.
 * OCP: 새 노드 = handler 파일 1개 + register 1줄.
 */

import type { NodeDescriptor } from "./node-descriptors.js";
import type { OrcheNodeDefinition } from "./workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "./orche-node-executor.js";

export interface NodeHandler extends NodeDescriptor {
  execute: (node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext) => Promise<OrcheNodeExecuteResult>;
  test: (node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext) => OrcheNodeTestResult;
}

// ── Registry ────────────────────────────────────────

const registry = new Map<string, NodeHandler>();

export function register_node(handler: NodeHandler): void {
  if (registry.has(handler.node_type)) {
    throw new Error(`duplicate node handler: ${handler.node_type}`);
  }
  registry.set(handler.node_type, handler);
}

export function get_node_handler(node_type: string): NodeHandler | undefined {
  return registry.get(node_type);
}

export function get_all_handlers(): NodeHandler[] {
  return [...registry.values()];
}
