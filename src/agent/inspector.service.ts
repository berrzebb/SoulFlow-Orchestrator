import type { AgentDomain } from "./index.js";
import type { AgentInspectorLike } from "./inspector.types.js";
import type { AgentApprovalRequest, AgentApprovalStatus } from "./runtime.types.js";

function parse_approval_row(raw: unknown): AgentApprovalRequest {
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

export class AgentInspectorAdapter implements AgentInspectorLike {
  private readonly domain: AgentDomain;

  constructor(domain: AgentDomain) {
    this.domain = domain;
  }

  list_runtime_tasks() {
    return this.domain.loop.list_tasks();
  }

  list_stored_tasks() {
    return this.domain.task_store.list();
  }

  list_subagents() {
    return this.domain.subagents.list();
  }

  cancel_subagent(id: string) {
    return this.domain.subagents.cancel(id);
  }

  send_input_to_subagent(id: string, text: string) {
    return this.domain.subagents.send_input(id, text);
  }

  list_active_loops() {
    return this.domain.loop.list_loops().filter((l) => l.status === "running");
  }

  stop_loop(loop_id: string, reason?: string) {
    return this.domain.loop.stop_loop(loop_id, reason);
  }

  list_approval_requests(status?: AgentApprovalStatus) {
    return this.domain.tools.list_approval_requests(status as never).map(parse_approval_row);
  }

  get_approval_request(request_id: string) {
    const row = this.domain.tools.get_approval_request(String(request_id || "").trim());
    return row ? parse_approval_row(row) : null;
  }

  resolve_approval_request(request_id: string, response_text: string) {
    const resolved = this.domain.tools.resolve_approval_request(request_id, response_text);
    return {
      ok: Boolean(resolved.ok),
      decision: resolved.decision,
      status: resolved.status,
      confidence: Number(resolved.confidence || 0),
    };
  }

  execute_approved_request(request_id: string) {
    return this.domain.tools.execute_approved_request(request_id);
  }
}

export function create_agent_inspector(domain: AgentDomain): AgentInspectorLike {
  return new AgentInspectorAdapter(domain);
}
