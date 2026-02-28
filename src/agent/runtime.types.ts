import type { ContextBuilder } from "./context.js";
import type {
  AgentLoopRunOptions,
  AgentLoopRunResult,
  TaskLoopRunOptions,
  TaskLoopRunResult,
} from "./loop.js";
import type { ToolExecutionContext, ToolLike } from "./tools/types.js";
import type { ProviderId } from "../providers/types.js";

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

export type SpawnAndWaitOptions = {
  task: string;
  skill_names?: string[];
  channel?: string;
  chat_id?: string;
  max_turns?: number;
  timeout_ms?: number;
  /** executor provider id (resolve_executor_provider 결과). */
  provider_id?: ProviderId;
};

export type SpawnAndWaitResult = {
  ok: boolean;
  content: string;
  error?: string;
};

export interface AgentRuntimeLike {
  get_context_builder(): ContextBuilder;
  get_always_skills(): string[];
  recommend_skills(task: string, limit?: number): string[];
  get_skill_metadata(name: string): import("./skills.types.js").SkillMetadata | null;
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
  /** headless 에이전트를 spawn하여 도구 실행이 필요한 작업을 위임하고 완료를 대기. */
  spawn_and_wait(options: SpawnAndWaitOptions): Promise<SpawnAndWaitResult>;
  /** 대기 중인 Task을 재개하고 사용자 입력을 memory에 주입. */
  resume_task(task_id: string, user_input?: string, reason?: string): Promise<import("../contracts.js").TaskState | null>;
  /** 특정 채팅에서 사용자 입력/승인을 대기 중인 Task을 조회. */
  find_waiting_task(provider: string, chat_id: string): Promise<import("../contracts.js").TaskState | null>;
  /** Task ID로 상태를 조회. */
  get_task(task_id: string): Promise<import("../contracts.js").TaskState | null>;
  /** Task을 취소. */
  cancel_task(task_id: string, reason?: string): Promise<import("../contracts.js").TaskState | null>;
  /** 완료/취소되지 않은 활성 Task 목록. */
  list_active_tasks(): import("../contracts.js").TaskState[];
  /** 현재 실행 중인 Agent Loop 목록. */
  list_active_loops(): import("../contracts.js").AgentLoopState[];
  /** Agent Loop을 중지. */
  stop_loop(loop_id: string, reason?: string): import("../contracts.js").AgentLoopState | null;
}
