import type { ContextBuilder } from "./context.js";
import type {
  AgentLoopRunOptions,
  AgentLoopRunResult,
  TaskLoopRunOptions,
  TaskLoopRunResult,
} from "./loop.js";
import type { ToolExecutionContext, ToolLike } from "./tools/types.js";
import type { ProviderId } from "../providers/types.js";

export type AgentApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "deferred"
  | "cancelled"
  | "clarify";

export type AgentApprovalDecision =
  | "approve"
  | "approve_all"
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

/** DB 행을 AgentApprovalRequest로 변환. inspector/runtime 양쪽에서 사용. */
export function parse_approval_row(raw: unknown): AgentApprovalRequest {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    request_id: String(row.request_id || ""),
    tool_name: String(row.tool_name || ""),
    params: (row.params && typeof row.params === "object") ? (row.params as Record<string, unknown>) : {},
    created_at: String(row.created_at || ""),
    status: String(row.status || "pending") as AgentApprovalStatus,
    context: (row.context && typeof row.context === "object")
      ? (row.context as AgentApprovalRequest["context"])
      : undefined,
  };
}

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

export type PhaseWorkflowSummary = {
  workflow_id: string;
  title: string;
  status: string;
  current_phase: number;
  phase_count: number;
  created_at: string;
};

export interface AgentRuntimeLike {
  get_context_builder(): ContextBuilder;
  get_always_skills(): string[];
  recommend_skills(task: string, limit?: number): string[];
  get_skill_metadata(name: string): import("./skills.types.js").SkillMetadata | null;
  has_tool(name: string): boolean;
  register_tool(tool: ToolLike): void;
  get_tool_definitions(): Array<Record<string, unknown>>;
  /** ToolLike 인스턴스 목록. SDK 백엔드의 MCP 도구 브리지에 사용. */
  get_tool_executors(): ToolLike[];
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
  /** 네이티브 백엔드 승인 브리지: 승인 요청을 등록하고 채널 응답까지 Promise로 블로킹. */
  register_approval_with_callback(
    tool_name: string, detail: string,
    context?: import("./tools/types.js").ToolExecutionContext, timeout_ms?: number,
  ): { request_id: string; decision: Promise<AgentApprovalDecision> };
  run_agent_loop(options: AgentLoopRunOptions): Promise<AgentLoopRunResult>;
  run_task_loop(options: TaskLoopRunOptions): Promise<TaskLoopRunResult>;
  /** headless 에이전트를 spawn하여 도구 실행이 필요한 작업을 위임하고 완료를 대기. */
  spawn_and_wait(options: SpawnAndWaitOptions): Promise<SpawnAndWaitResult>;
  /** 대기 중인 Task을 재개하고 사용자 입력을 memory에 주입. channel_context가 있으면 유실된 채널 정보를 복원. */
  resume_task(task_id: string, user_input?: string, reason?: string, channel_context?: { channel: string; chat_id: string }): Promise<import("../contracts.js").TaskState | null>;
  /** 특정 채팅에서 사용자 입력/승인을 대기 중인 Task을 조회. */
  find_waiting_task(provider: string, chat_id: string): Promise<import("../contracts.js").TaskState | null>;
  /** 트리거 메시지 ID로 연결된 Task을 역조회. */
  find_task_by_trigger_message(provider: string, trigger_message_id: string): Promise<import("../contracts.js").TaskState | null>;
  /** Task ID로 상태를 조회. */
  get_task(task_id: string): Promise<import("../contracts.js").TaskState | null>;
  /** Task에 연결된 에이전트 세션을 조회. */
  find_session_by_task(task_id: string): import("./agent.types.js").AgentSession | null;
  /** Task을 취소. */
  cancel_task(task_id: string, reason?: string): Promise<import("../contracts.js").TaskState | null>;
  /** 완료/취소되지 않은 활성 Task 목록. */
  list_active_tasks(): import("../contracts.js").TaskState[];
  /** waiting 상태에서 TTL 초과한 Task를 자동 취소. */
  expire_stale_tasks(ttl_ms?: number): import("../contracts.js").TaskState[];
  /** 현재 실행 중인 Agent Loop 목록. */
  list_active_loops(): import("../contracts.js").AgentLoopState[];
  /** Agent Loop을 중지. */
  stop_loop(loop_id: string, reason?: string): import("../contracts.js").AgentLoopState | null;
  /** Phase 워크플로우 목록 조회. */
  list_phase_workflows(): Promise<PhaseWorkflowSummary[]>;
  /** Phase 워크플로우 상태 조회. */
  get_phase_workflow(workflow_id: string): Promise<import("./phase-loop.types.js").PhaseLoopState | null>;
}
