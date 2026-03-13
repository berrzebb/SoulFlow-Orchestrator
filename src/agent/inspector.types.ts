import type { AgentLoopState, TaskState, TeamScopeOpts } from "../contracts.js";
import type { AgentApprovalRequest, AgentApprovalResolveResult, AgentApprovalExecuteResult, AgentApprovalStatus } from "./runtime.types.js";
import type { SubagentRef } from "./subagents.js";

export type { TeamScopeOpts };

export interface AgentInspectorLike {
  list_runtime_tasks(team_id?: string): TaskState[];
  list_stored_tasks(team_id?: string): Promise<TaskState[]>;
  list_subagents(team_id?: string): SubagentRef[];
  cancel_subagent(id: string, opts?: TeamScopeOpts): boolean;
  send_input_to_subagent(id: string, text: string, opts?: TeamScopeOpts): boolean;
  list_active_loops(team_id?: string): AgentLoopState[];
  stop_loop(loop_id: string, reason?: string, opts?: TeamScopeOpts): AgentLoopState | null;
  list_approval_requests(status?: AgentApprovalStatus, team_id?: string): AgentApprovalRequest[];
  get_approval_request(request_id: string, opts?: TeamScopeOpts): AgentApprovalRequest | null;
  resolve_approval_request(request_id: string, response_text: string, opts?: TeamScopeOpts): AgentApprovalResolveResult;
  execute_approved_request(request_id: string, opts?: TeamScopeOpts): Promise<AgentApprovalExecuteResult>;
}
