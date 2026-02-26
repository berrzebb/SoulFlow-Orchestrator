import type { ContextBuilder } from "./context.js";
import type {
  AgentLoopRunOptions,
  AgentLoopRunResult,
  TaskLoopRunOptions,
  TaskLoopRunResult,
} from "./loop.js";
import type { ToolExecutionContext, ToolLike } from "./tools/types.js";

export type AgentToolRuntimeContext = {
  channel: string;
  chat_id: string;
  reply_to?: string | null;
};

export type AgentApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "deferred"
  | "cancelled"
  | "clarify";

export type AgentApprovalDecision =
  | "approve"
  | "deny"
  | "defer"
  | "cancel"
  | "clarify"
  | "unknown";

export type AgentApprovalRequest = {
  request_id: string;
  tool_name: string;
  params: Record<string, unknown>;
  created_at: string;
  status: AgentApprovalStatus;
  context?: {
    channel?: string;
    chat_id?: string;
    sender_id?: string;
    task_id?: string;
  };
};

export type AgentApprovalResolveResult = {
  ok: boolean;
  decision: AgentApprovalDecision;
  status: AgentApprovalStatus | "pending";
  confidence: number;
};

export type AgentApprovalExecuteResult = {
  ok: boolean;
  status: AgentApprovalStatus | "unknown";
  tool_name?: string;
  result?: string;
  error?: string;
};

export interface AgentRuntimeLike {
  get_context_builder(): ContextBuilder;
  get_always_skills(): string[];
  recommend_skills(task: string, limit?: number): string[];
  has_tool(name: string): boolean;
  register_tool(tool: ToolLike): void;
  get_tool_definitions(): Array<Record<string, unknown>>;
  apply_tool_runtime_context(context: AgentToolRuntimeContext): void;
  execute_tool(
    name: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string>;
  append_daily_memory(content: string, day?: string): Promise<void>;
  list_approval_requests(status?: AgentApprovalStatus): AgentApprovalRequest[];
  get_approval_request(request_id: string): AgentApprovalRequest | null;
  resolve_approval_request(request_id: string, response_text: string): AgentApprovalResolveResult;
  execute_approved_request(request_id: string): Promise<AgentApprovalExecuteResult>;
  run_agent_loop(options: AgentLoopRunOptions): Promise<AgentLoopRunResult>;
  run_task_loop(options: TaskLoopRunOptions): Promise<TaskLoopRunResult>;
}
