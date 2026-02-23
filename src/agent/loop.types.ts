import type { AgentLoopState, TaskState } from "../contracts.js";
import type { ContextBuilder } from "./context.js";
import type { LlmResponse, ProviderId, ProviderRegistry, ToolCallRequest } from "../providers/index.js";

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

export type AgentLoopRunOptions = {
  loop_id: string;
  agent_id: string;
  objective: string;
  context_builder: ContextBuilder;
  providers: ProviderRegistry;
  provider_id?: ProviderId;
  current_message?: string;
  history_days?: string[];
  skill_names?: string[] | null;
  media?: string[] | null;
  channel?: string | null;
  chat_id?: string | null;
  max_turns?: number;
  check_should_continue?: (ctx: AgentLoopTurnContext) => Promise<boolean> | boolean;
  on_turn?: (ctx: AgentLoopTurnContext) => Promise<void> | void;
  on_tool_calls?: AgentToolCallHandler;
  on_stream?: (chunk: string) => Promise<void> | void;
  abort_signal?: AbortSignal;
  model?: string;
  max_tokens?: number;
  temperature?: number;
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
  nodes: TaskNode[];
  max_turns?: number;
  initial_memory?: Record<string, unknown>;
  start_step_index?: number;
  on_turn?: (state: TaskState) => Promise<void> | void;
};

export type TaskLoopRunResult = {
  state: TaskState;
};
