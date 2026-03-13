import type { TeamScopeOpts } from "../contracts.js";
import type { AgentDomain } from "./index.js";
import type { AgentInspectorLike } from "./inspector.types.js";
import { parse_approval_row, type AgentApprovalStatus, type AgentApprovalResolveResult, type AgentApprovalExecuteResult } from "./runtime.types.js";

export class AgentInspectorAdapter implements AgentInspectorLike {
  private readonly domain: AgentDomain;

  constructor(domain: AgentDomain) {
    this.domain = domain;
  }

  list_runtime_tasks(team_id?: string) {
    const all = this.domain.loop.list_tasks();
    return team_id !== undefined ? all.filter((t: { team_id?: string }) => t.team_id === team_id) : all;
  }

  async list_stored_tasks(team_id?: string) {
    const all = await this.domain.task_store.list();
    return team_id !== undefined ? all.filter((t: { team_id?: string }) => t.team_id === team_id) : all;
  }

  list_subagents(team_id?: string) {
    const all = this.domain.subagents.list();
    return team_id !== undefined ? all.filter((s: { team_id?: string }) => s.team_id === team_id) : all;
  }

  cancel_subagent(id: string, opts?: TeamScopeOpts) {
    if (opts?.team_id !== undefined) {
      const ref = this.domain.subagents.get(id);
      if (!ref || ref.team_id !== opts.team_id) return false;
    }
    return this.domain.subagents.cancel(id);
  }

  send_input_to_subagent(id: string, text: string, opts?: TeamScopeOpts) {
    if (opts?.team_id !== undefined) {
      const ref = this.domain.subagents.get(id);
      if (!ref || ref.team_id !== opts.team_id) return false;
    }
    return this.domain.subagents.send_input(id, text);
  }

  list_active_loops(team_id?: string) {
    const running = this.domain.loop.list_loops().filter((l) => l.status === "running");
    return team_id !== undefined ? running.filter((l: { team_id?: string }) => l.team_id === team_id) : running;
  }

  stop_loop(loop_id: string, reason?: string, opts?: TeamScopeOpts) {
    if (opts?.team_id !== undefined) {
      const loops = this.domain.loop.list_loops();
      const loop = loops.find((l) => l.loopId === loop_id);
      if (!loop || loop.team_id !== opts.team_id) return null;
    }
    return this.domain.loop.stop_loop(loop_id, reason);
  }

  list_approval_requests(status?: AgentApprovalStatus, team_id?: string) {
    const all = this.domain.tools.list_approval_requests(status).map(parse_approval_row);
    return team_id !== undefined
      ? all.filter((r) => r.context?.team_id === team_id)
      : all;
  }

  get_approval_request(request_id: string, opts?: TeamScopeOpts) {
    const row = this.domain.tools.get_approval_request(String(request_id || "").trim());
    if (!row) return null;
    const parsed = parse_approval_row(row);
    if (opts?.team_id !== undefined && parsed.context?.team_id !== opts.team_id) return null;
    return parsed;
  }

  resolve_approval_request(request_id: string, response_text: string, opts?: TeamScopeOpts) {
    if (opts?.team_id !== undefined) {
      const req = this.get_approval_request(request_id, opts);
      if (!req) return { ok: false, decision: "deny", status: "cancelled", confidence: 0 } as AgentApprovalResolveResult;
    }
    const resolved = this.domain.tools.resolve_approval_request(request_id, response_text);
    return {
      ok: Boolean(resolved.ok),
      decision: resolved.decision,
      status: resolved.status,
      confidence: Number(resolved.confidence || 0),
    };
  }

  execute_approved_request(request_id: string, opts?: TeamScopeOpts) {
    if (opts?.team_id !== undefined) {
      const req = this.get_approval_request(request_id, opts);
      if (!req) return Promise.resolve({ ok: false, status: "cancelled", error: "not_found" } as AgentApprovalExecuteResult);
    }
    return this.domain.tools.execute_approved_request(request_id);
  }
}

export function create_agent_inspector(domain: AgentDomain): AgentInspectorLike {
  return new AgentInspectorAdapter(domain);
}
