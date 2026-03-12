import type { AgentLoopState, TaskState } from "../contracts.js";
import type { ContextBuilder } from "./context.js";
import type { LlmResponse, ProviderId, ProviderRegistry, RuntimeExecutionPolicy, ToolCallRequest } from "../providers/index.js";

export type LoopTimestampProvider = () => string;

export type AgentLoopTurnContext = {
  state: AgentLoopState;
  response: LlmResponse;
  last_content: string | null;
};

export type AgentToolCallHandler = (args: {
  state: AgentLoopState;
  tool_calls: ToolCallRequest[];
  response: LlmResponse;
}) => Promise<string | null>;

/** Compaction flush 설정. 컨텍스트 윈도우 임계점 도달 시 메모리 자동 저장. */
export type CompactionFlushConfig = {
  /** 컨텍스트 윈도우 크기 (토큰). */
  context_window: number;
  /** 응답 생성을 위한 최소 보존 토큰. 기본 20,000. */
  reserve_floor?: number;
  /** 트리거 여유 토큰. 기본 4,000. */
  soft_threshold?: number;
  /** 임계점 도달 시 호출. 메모리 저장 등 수행. */
  flush: () => Promise<void>;
};

export type AgentLoopRunOptions = {
  loop_id: string;
  agent_id: string;
  objective: string;
  context_builder: ContextBuilder;
  providers: ProviderRegistry;
  tools?: Record<string, unknown>[];
  runtime_policy?: RuntimeExecutionPolicy;
  provider_id?: ProviderId;
  current_message?: string;
  history_days?: string[];
  skill_names?: string[] | null;
  media?: string[] | null;
  channel?: string | null;
  chat_id?: string | null;
  max_turns?: number;
  /** false=종료, true=기본 메시지로 계속, string=해당 문자열을 다음 턴 메시지로 사용. */
  check_should_continue?: (ctx: AgentLoopTurnContext) => Promise<boolean | string> | boolean | string;
  on_turn?: (ctx: AgentLoopTurnContext) => Promise<void> | void;
  on_tool_calls?: AgentToolCallHandler;
  on_stream?: (chunk: string) => Promise<void> | void;
  on_stream_event?: (event: import("../channels/stream-event.js").StreamEvent) => Promise<void> | void;
  abort_signal?: AbortSignal;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  /** 컨텍스트 압축 전 메모리 자동 저장 설정. */
  compaction_flush?: CompactionFlushConfig;
};

export type AgentLoopRunResult = {
  state: AgentLoopState;
  final_content: string | null;
};

export type TaskNodeResult = {
  status?: TaskState["status"];
  memory_patch?: Record<string, unknown>;
  next_step_index?: number;
  current_step?: string;
  exit_reason?: string;
};

export type TaskNode = {
  id: string;
  run: (ctx: {
    task_state: TaskState;
    memory: Record<string, unknown>;
  }) => Promise<TaskNodeResult>;
};

export type TaskLoopRunOptions = {
  task_id: string;
  title: string;
  objective: string;
  channel: string;
  chat_id: string;
  nodes: TaskNode[];
  max_turns?: number;
  initial_memory?: Record<string, unknown>;
  start_step_index?: number;
  on_turn?: (state: TaskState) => Promise<void> | void;
  abort_signal?: AbortSignal;
};

export type TaskLoopRunResult = {
  state: TaskState;
};
