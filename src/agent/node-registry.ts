/**
 * Node Registry — 노드 핸들러 등록/조회.
 * OCP: 새 노드 = handler 파일 1개 + register 1줄.
 */

import type { NodeDescriptor } from "./node-descriptors.js";
import type { OrcheNodeDefinition } from "./workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "./orche-node-executor.js";
import type { PhaseLoopState, PhaseLoopRunOptions, PhaseLoopEvent } from "./phase-loop.types.js";
import type { Logger } from "../logger.js";

/** LLM 단일 호출 옵션. */
export interface InvokeLlmOptions {
  provider_id?: string;
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  output_json_schema?: Record<string, unknown>;
  abort_signal?: AbortSignal;
}

/** LLM 호출 결과. */
export interface InvokeLlmResult {
  content: string;
  parsed?: unknown;
  usage?: Record<string, number>;
}

/** 에이전트 스폰 결과. */
export interface SpawnAgentResult {
  agent_id: string;
  status: string;
  result?: string | null;
  error?: string;
}

/** Decision/Promise 서비스 최소 인터페이스. */
export interface RecordServiceLike {
  append(input: { scope: string; scope_id?: string | null; key: string; value: string; rationale?: string; priority?: number; tags?: string[]; source?: string }): Promise<{ action: string; record: unknown }>;
  list(filter?: { scope?: string; scope_id?: string; status?: string; key?: string; search?: string; limit?: number }): Promise<unknown[]>;
  get_effective(context?: { agent_id?: string; team_id?: string }): Promise<unknown[]>;
  archive(id: string): Promise<boolean>;
}

/** 런너에 주입 가능한 외부 서비스 집합. 미제공 시 해당 노드는 에러 반환. */
export interface RunnerServices {
  invoke_llm?: (opts: InvokeLlmOptions) => Promise<InvokeLlmResult>;
  spawn_agent?: (opts: import("./subagents.js").SpawnSubagentOptions) => Promise<SpawnAgentResult>;
  wait_agent?: (agent_id: string, timeout_ms?: number) => Promise<{ status: string; result?: string | null; error?: string }>;
  decision?: RecordServiceLike;
  promise?: RecordServiceLike;
  create_task?: (opts: { title: string; objective: string; channel?: string; chat_id?: string; max_turns?: number; initial_memory?: Record<string, unknown> }) => Promise<{ task_id: string; status: string; result?: unknown; error?: string }>;
  query_db?: (datasource: string, query: string, params?: Record<string, unknown>) => Promise<{ rows: unknown[]; affected_rows: number }>;
  /** 텍스트 → 벡터 변환 (embedding 노드용). */
  embed?: (texts: string[], opts: { model?: string; dimensions?: number }) => Promise<{ embeddings: number[][]; token_usage?: number }>;
  /** 벡터 스토어 CRUD (vector_store 노드용). */
  vector_store?: (op: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** OAuth 인증 기반 HTTP fetch (oauth 노드용). */
  oauth_fetch?: (service_id: string, opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown }) => Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  /** Webhook 수신 데이터 조회 (webhook 노드용). */
  get_webhook_data?: (path: string) => Promise<{ method: string; headers: Record<string, string>; body: unknown; query: Record<string, string> } | null>;
  /** 칸반 이벤트 대기 (kanban_trigger 노드용). */
  wait_kanban_event?: (board_id: string, filter: { actions?: string[]; column_id?: string }) => Promise<{ card_id: string; board_id: string; action: string; actor: string; detail: Record<string, unknown>; created_at: string } | null>;
}

/** 런너 레벨 실행에 필요한 컨텍스트. 채널 콜백, 로거, 이벤트 emitter 등. */
export interface RunnerContext {
  state: PhaseLoopState;
  options: PhaseLoopRunOptions;
  logger: Logger;
  emit: (event: PhaseLoopEvent) => void;
  /** 모든 노드 정의 목록 (retry/batch에서 대상 노드 조회용). */
  all_nodes: import("./workflow-node.types.js").WorkflowNodeDefinition[];
  /** IF 분기에 의해 스킵된 노드 집합. */
  skipped_nodes: Set<string>;
  /** 기본 노드 executor (retry/batch에서 대상 노드 재실행용). */
  execute_node: (node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext) => Promise<OrcheNodeExecuteResult>;
  /** 하위 워크플로우 실행 (sub_workflow 노드용). 미제공 시 sub_workflow 노드는 에러 반환. */
  run_sub_workflow?: (workflow_name: string, input: Record<string, unknown>) => Promise<{ result: unknown; phases: unknown[] }>;
  /** 외부 서비스 (LLM, 에이전트, DB 등). */
  services?: RunnerServices;
}

export interface NodeHandler extends NodeDescriptor {
  execute: (node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext) => Promise<OrcheNodeExecuteResult>;
  test: (node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext) => OrcheNodeTestResult;
  /** 런너 컨텍스트가 필요한 노드는 이 메서드를 구현. 있으면 execute 대신 호출됨. */
  runner_execute?: (node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext) => Promise<OrcheNodeExecuteResult>;
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
