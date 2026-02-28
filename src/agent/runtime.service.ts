import type { AgentDomain } from "./index.js";
import type {
  AgentApprovalExecuteResult,
  AgentApprovalRequest,
  AgentApprovalResolveResult,
  AgentApprovalStatus,
  AgentRuntimeLike,
  AgentToolRuntimeContext,
  SpawnAndWaitOptions,
  SpawnAndWaitResult,
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

type ToolContextSetter = {
  set_context?: (...args: string[]) => void;
};

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

export class AgentRuntimeAdapter implements AgentRuntimeLike {
  private readonly domain: AgentDomain;

  constructor(domain: AgentDomain) {
    this.domain = domain;
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

  apply_tool_runtime_context(context: AgentToolRuntimeContext): void {
    const channel = String(context.channel || "").trim();
    const chat_id = String(context.chat_id || "").trim();
    if (!channel || !chat_id) return;
    const reply_to = String(context.reply_to || "").trim() || null;

    for (const tool_name of ["message", "spawn", "request_file"] as const) {
      const tool = this.domain.tools.get(tool_name) as ToolContextSetter | null;
      if (tool_name === "message") {
        tool?.set_context?.(channel, chat_id, reply_to || "");
      } else {
        tool?.set_context?.(channel, chat_id);
      }
    }
  }

  execute_tool(name: string, params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    return this.domain.tools.execute(name, params, context);
  }

  async append_daily_memory(content: string, day?: string): Promise<void> {
    await this.domain.append_daily_memory(content, day);
  }

  list_approval_requests(status?: AgentApprovalStatus): AgentApprovalRequest[] {
    return this.domain.tools.list_approval_requests(status as never).map(parse_approval_row);
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

  run_agent_loop(options: AgentLoopRunOptions): Promise<AgentLoopRunResult> {
    return this.domain.loop.run_agent_loop(options);
  }

  run_task_loop(options: TaskLoopRunOptions): Promise<TaskLoopRunResult> {
    return this.domain.loop.run_task_loop(options);
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
      return { ok: false, content: "", error: e instanceof Error ? e.message : String(e) };
    }
  }
}

export function create_agent_runtime(domain: AgentDomain): AgentRuntimeLike {
  return new AgentRuntimeAdapter(domain);
}
