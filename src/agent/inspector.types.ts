import type { AgentLoopState, TaskState } from "../contracts.js";
import type { AgentApprovalRequest, AgentApprovalResolveResult, AgentApprovalExecuteResult, AgentApprovalStatus } from "./runtime.types.js";
import type { SubagentRef } from "./subagents.js";

export interface AgentInspectorLike {
  list_runtime_tasks(): TaskState[];
  list_stored_tasks(): Promise<TaskState[]>;
  list_subagents(): SubagentRef[];
  cancel_subagent(id: string): boolean;
  send_input_to_subagent(id: string, text: string): boolean;
  list_active_loops(): AgentLoopState[];
  stop_loop(loop_id: string, reason?: string): AgentLoopState | null;
  list_approval_requests(status?: AgentApprovalStatus): AgentApprovalRequest[];
  get_approval_request(request_id: string): AgentApprovalRequest | null;
  resolve_approval_request(request_id: string, response_text: string): AgentApprovalResolveResult;
  execute_approved_request(request_id: string): Promise<AgentApprovalExecuteResult>;
}
