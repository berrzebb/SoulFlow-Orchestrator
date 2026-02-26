import type { AgentDomain } from "./index.js";
import type {
  AgentApprovalExecuteResult,
  AgentApprovalRequest,
  AgentApprovalResolveResult,
  AgentApprovalStatus,
  AgentRuntimeLike,
  AgentToolRuntimeContext,
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

type MessageToolContextSetter = {
  set_context?: (channel: string, chat_id: string, reply_to?: string | null) => void;
};

type ChannelToolContextSetter = {
  set_context?: (channel: string, chat_id: string) => void;
};

export class AgentRuntimeAdapter implements AgentRuntimeLike {
  private readonly domain: AgentDomain;

  constructor(domain: AgentDomain) {
    this.domain = domain;
  }

  get_context_builder(): ContextBuilder {
    return this.domain.context;
  }

  get_always_skills(): string[] {
    return this.domain.context.skills_loader.get_always_skills();
  }

  recommend_skills(task: string, limit = 6): string[] {
    return this.domain.context.skills_loader.suggest_skills_for_text(task, limit);
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

  apply_tool_runtime_context(context: AgentToolRuntimeContext): void {
    const channel = String(context.channel || "").trim();
    const chat_id = String(context.chat_id || "").trim();
    if (!channel || !chat_id) return;
    const reply_to = String(context.reply_to || "").trim() || null;

    const message_tool = this.domain.tools.get("message") as MessageToolContextSetter | null;
    message_tool?.set_context?.(channel, chat_id, reply_to);

    const spawn_tool = this.domain.tools.get("spawn") as ChannelToolContextSetter | null;
    spawn_tool?.set_context?.(channel, chat_id);

    const file_request_tool = this.domain.tools.get("request_file") as ChannelToolContextSetter | null;
    file_request_tool?.set_context?.(channel, chat_id);
  }

  execute_tool(name: string, params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    return this.domain.tools.execute(name, params, context);
  }

  async append_daily_memory(content: string, day?: string): Promise<void> {
    await this.domain.context.memory_store.append_daily(content, day);
  }

  list_approval_requests(status?: AgentApprovalStatus): AgentApprovalRequest[] {
    const rows = this.domain.tools.list_approval_requests(status as never);
    return rows.map((row) => ({
      request_id: String((row as Record<string, unknown>).request_id || ""),
      tool_name: String((row as Record<string, unknown>).tool_name || ""),
      params: ((row as Record<string, unknown>).params && typeof (row as Record<string, unknown>).params === "object")
        ? ((row as Record<string, unknown>).params as Record<string, unknown>)
        : {},
      created_at: String((row as Record<string, unknown>).created_at || ""),
      status: String((row as Record<string, unknown>).status || "pending") as AgentApprovalStatus,
      context: ((row as Record<string, unknown>).context && typeof (row as Record<string, unknown>).context === "object")
        ? ((row as Record<string, unknown>).context as AgentApprovalRequest["context"])
        : undefined,
    }));
  }

  get_approval_request(request_id: string): AgentApprovalRequest | null {
    const row = this.domain.tools.get_approval_request(String(request_id || "").trim());
    if (!row) return null;
    const rec = row as unknown as Record<string, unknown>;
    return {
      request_id: String(rec.request_id || ""),
      tool_name: String(rec.tool_name || ""),
      params: (rec.params && typeof rec.params === "object") ? (rec.params as Record<string, unknown>) : {},
      created_at: String(rec.created_at || ""),
      status: String(rec.status || "pending") as AgentApprovalStatus,
      context: (rec.context && typeof rec.context === "object")
        ? (rec.context as AgentApprovalRequest["context"])
        : undefined,
    };
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

  run_agent_loop(options: AgentLoopRunOptions): Promise<AgentLoopRunResult> {
    return this.domain.loop.run_agent_loop(options);
  }

  run_task_loop(options: TaskLoopRunOptions): Promise<TaskLoopRunResult> {
    return this.domain.loop.run_task_loop(options);
  }
}

export function create_agent_runtime(domain: AgentDomain): AgentRuntimeLike {
  return new AgentRuntimeAdapter(domain);
}
