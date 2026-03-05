/**
 * 오케스트레이션 노드 실행기.
 * Registry 기반: 각 노드 핸들러가 execute/test를 구현.
 * Phase(Agent) 노드는 이 모듈이 아닌 phase-loop-runner가 처리.
 */

import type { OrcheNodeDefinition } from "./workflow-node.types.js";
import { get_node_handler } from "./node-registry.js";
import { register_all_nodes } from "./nodes/index.js";

// ── Context ─────────────────────────────────────────

export interface OrcheNodeExecutorContext {
  memory: Record<string, unknown>;
  abort_signal?: AbortSignal;
  workspace?: string;
}

export interface OrcheNodeExecuteResult {
  output: unknown;
  /** IF 노드 전용: 어떤 분기가 선택되었는지. */
  branch?: "true" | "false";
}

export interface OrcheNodeTestResult {
  preview: unknown;
  warnings: string[];
}

// ── Template Resolver (공유 유틸) ───────────────────

const TEMPLATE_RE = /\{\{([\w.[\]]+)\}\}/g;

/** `{{memory.nodeId.field}}` 패턴을 실제 값으로 치환. */
export function resolve_templates(template: string, context: Record<string, unknown>): string {
  return template.replace(TEMPLATE_RE, (_, path: string) => {
    const value = get_nested(context, path);
    return value === undefined ? "" : String(value);
  });
}

/** 중첩 객체에서 dot-notation 경로로 값 접근. */
function get_nested(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 객체 내 모든 문자열 값의 템플릿을 재귀적으로 치환. */
export function resolve_deep(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") return resolve_templates(value, context);
  if (Array.isArray(value)) return value.map((v) => resolve_deep(v, context));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolve_deep(v, context);
    }
    return out;
  }
  return value;
}

// ── Lazy Registration ───────────────────────────────

let initialized = false;
function ensure_registered(): void {
  if (!initialized) {
    initialized = true;
    register_all_nodes();
  }
}

// ── Dispatcher (Registry 기반) ──────────────────────

export async function execute_orche_node(
  node: OrcheNodeDefinition,
  ctx: OrcheNodeExecutorContext,
): Promise<OrcheNodeExecuteResult> {
  ensure_registered();
  const handler = get_node_handler(node.node_type);
  if (!handler) throw new Error(`unknown node type: ${node.node_type}`);
  return handler.execute(node, ctx);
}

/** 노드 설정을 검증하고 실행 미리보기를 반환 (실제 실행 없음). */
export function test_orche_node(
  node: OrcheNodeDefinition,
  ctx: OrcheNodeExecutorContext,
): OrcheNodeTestResult {
  ensure_registered();
  const handler = get_node_handler(node.node_type);
  if (!handler) throw new Error(`unknown node type: ${node.node_type}`);
  return handler.test(node, ctx);
}
