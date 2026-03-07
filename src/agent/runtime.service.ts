import { error_message } from "../utils/common.js";
import type { AgentDomain } from "./index.js";
import {
  parse_approval_row,
  type AgentApprovalExecuteResult,
  type AgentApprovalRequest,
  type AgentApprovalResolveResult,
  type AgentApprovalStatus,
  type AgentRuntimeLike,
  type SpawnAndWaitOptions,
  type SpawnAndWaitResult,
} from "./runtime.types.js";
import type { ToolExecutionContext } from "./tools/types.js";
import type {
  AgentLoopRunOptions,
  AgentLoopRunResult,
  TaskLoopRunOptions,
  TaskLoopRunResult,
} from "./loop.js";
import type { ContextBuilder } from "./context.js";
import type { ToolLike } from "./tools/types.js";

export class AgentRuntimeAdapter implements AgentRuntimeLike {
  private readonly domain: AgentDomain;
  private readonly _phase_store: import("./phase-workflow-store.js").PhaseWorkflowStoreLike | null;

  constructor(domain: AgentDomain, options?: { phase_workflow_store?: import("./phase-workflow-store.js").PhaseWorkflowStoreLike | null }) {
    this.domain = domain;
    this._phase_store = options?.phase_workflow_store ?? null;
  }

  get_context_builder(): ContextBuilder {
    return this.domain.context;
  }

  get_always_skills(): string[] {
    return this.domain.list_always_skills();
  }

  recommend_skills(task: string, limit = 6): string[] {
    return this.domain.recommend_skills(task, limit);
  }

  get_skill_metadata(name: string): import("./skills.types.js").SkillMetadata | null {
    return this.domain.get_skill_metadata(name);
  }

  has_tool(name: string): boolean {
    return this.domain.tools.has(String(name || "").trim());
  }

  register_tool(tool: ToolLike): void {
    this.domain.tools.register(tool);
  }

  get_tool_definitions(): Array<Record<string, unknown>> {
    return this.domain.tools.get_definitions();
  }

  get_tool_executors(): ToolLike[] {
    return this.domain.tools.get_all();
  }

  execute_tool(name: string, params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    return this.domain.tools.execute(name, params, context);
  }

  async append_daily_memory(content: string, day?: string): Promise<void> {
    await this.domain.append_daily_memory(content, day);
  }

  list_approval_requests(status?: AgentApprovalStatus): AgentApprovalRequest[] {
    return this.domain.tools.list_approval_requests(status).map(parse_approval_row);
  }

  get_approval_request(request_id: string): AgentApprovalRequest | null {
    const row = this.domain.tools.get_approval_request(String(request_id || "").trim());
    return row ? parse_approval_row(row) : null;
  }

  resolve_approval_request(request_id: string, response_text: string): AgentApprovalResolveResult {
    const resolved = this.domain.tools.resolve_approval_request(request_id, response_text);
    return {
      ok: Boolean(resolved.ok),
      decision: resolved.decision,
      status: resolved.status,
      confidence: Number(resolved.confidence || 0),
    };
  }

  execute_approved_request(request_id: string): Promise<AgentApprovalExecuteResult> {
    return this.domain.tools.execute_approved_request(request_id);
  }

  register_approval_with_callback(
    tool_name: string, detail: string,
    context?: import("./tools/types.js").ToolExecutionContext, timeout_ms?: number,
  ): { request_id: string; decision: Promise<import("./runtime.types.js").AgentApprovalDecision> } {
    return this.domain.tools.register_approval_with_callback(tool_name, detail, context, timeout_ms);
  }

  run_agent_loop(options: AgentLoopRunOptions): Promise<AgentLoopRunResult> {
    return this.domain.loop.run_agent_loop(options);
  }

  run_task_loop(options: TaskLoopRunOptions): Promise<TaskLoopRunResult> {
    return this.domain.loop.run_task_loop(options);
  }

  async resume_task(task_id: string, user_input?: string, reason?: string, channel_context?: { channel: string; chat_id: string }): Promise<import("../contracts.js").TaskState | null> {
    return this.domain.loop.resume_task(task_id, user_input, reason, channel_context);
  }

  async find_waiting_task(provider: string, chat_id: string): Promise<import("../contracts.js").TaskState | null> {
    return this.domain.task_store.find_waiting_by_chat(provider, chat_id);
  }

  async find_task_by_trigger_message(provider: string, trigger_message_id: string): Promise<import("../contracts.js").TaskState | null> {
    return this.domain.task_store.find_by_trigger_message_id(provider, trigger_message_id);
  }

  async get_task(task_id: string): Promise<import("../contracts.js").TaskState | null> {
    return this.domain.task_store.get(task_id);
  }

  async cancel_task(task_id: string, reason?: string): Promise<import("../contracts.js").TaskState | null> {
    return this.domain.loop.cancel_task(task_id, reason);
  }

  list_active_tasks(): import("../contracts.js").TaskState[] {
    return this.domain.loop.list_tasks().filter((t) => !["completed", "cancelled"].includes(t.status));
  }

  expire_stale_tasks(ttl_ms?: number): import("../contracts.js").TaskState[] {
    return this.domain.loop.expire_stale_tasks(ttl_ms);
  }

  list_active_loops(): import("../contracts.js").AgentLoopState[] {
    return this.domain.loop.list_loops().filter((l) => l.status === "running");
  }

  stop_loop(loop_id: string, reason?: string): import("../contracts.js").AgentLoopState | null {
    return this.domain.loop.stop_loop(loop_id, reason);
  }

  find_session_by_task(task_id: string): import("./agent.types.js").AgentSession | null {
    const store = this.domain.subagents.get_agent_backends()?.get_session_store();
    return store?.find_by_task(task_id) ?? null;
  }

  async spawn_and_wait(options: SpawnAndWaitOptions): Promise<SpawnAndWaitResult> {
    try {
      const spawned = await this.domain.subagents.spawn({
        task: options.task,
        skill_names: options.skill_names,
        origin_channel: options.channel,
        origin_chat_id: options.chat_id,
        max_iterations: options.max_turns ?? 8,
        announce: false,
        provider_id: options.provider_id,
      });
      const result = await this.domain.subagents.wait_for_completion(
        spawned.subagent_id,
        options.timeout_ms ?? 120_000,
      );
      if (!result) return { ok: false, content: "", error: "spawn_not_found" };
      return {
        ok: result.status === "completed",
        content: result.content || "",
        error: result.error,
      };
    } catch (e) {
      return { ok: false, content: "", error: error_message(e) };
    }
  }

  async list_phase_workflows(): Promise<import("./runtime.types.js").PhaseWorkflowSummary[]> {
    const store = this._phase_store;
    if (!store) return [];
    const all = await store.list();
    return all.map((w) => ({
      workflow_id: w.workflow_id,
      title: w.title,
      status: w.status,
      current_phase: w.current_phase,
      phase_count: w.phases.length,
      created_at: w.created_at,
    }));
  }

  async get_phase_workflow(workflow_id: string): Promise<import("./phase-loop.types.js").PhaseLoopState | null> {
    const store = this._phase_store;
    if (!store) return null;
    return store.get(workflow_id);
  }
}

export function create_agent_runtime(
  domain: AgentDomain,
  options?: { phase_workflow_store?: import("./phase-workflow-store.js").PhaseWorkflowStoreLike | null },
): AgentRuntimeLike {
  return new AgentRuntimeAdapter(domain, options);
}
