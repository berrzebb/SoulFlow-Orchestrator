import type { MessageBusLike } from "../bus/index.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { ProviderCapabilities } from "../providers/executor.js";
import type { ServiceLike } from "../runtime/service.types.js";
import { ContextBuilder } from "./context.js";
import { AgentLoopStore } from "./loop.js";
import { SubagentRegistry } from "./subagents.js";
import { TaskStore } from "./task-store.js";
import { join } from "node:path";
import {
  ToolInstallerService,
  DynamicToolRuntimeLoader,
  ToolRuntimeReloader,
  ToolSelfTestService,
  ToolRegistry,
  create_default_tool_registry,
} from "./tools/index.js";
import type { WorkflowEventService } from "../events/index.js";
import type { AgentBackendRegistry } from "./agent-registry.js";
import { seal_inbound_sensitive_text } from "../security/inbound-seal.js";
import { redact_sensitive_text } from "../security/sensitive.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import type { Logger } from "../logger.js";

export class AgentDomain implements ServiceLike {
  readonly name = "agent-domain";
  readonly context: ContextBuilder;
  readonly task_store: TaskStore;
  readonly loop: AgentLoopStore;
  readonly subagents: SubagentRegistry;
  readonly tools: ToolRegistry;
  readonly tool_installer: ToolInstallerService;
  readonly tool_reloader: ToolRuntimeReloader;
  readonly tool_self_test: ToolSelfTestService;

  constructor(
    workspace: string,
    args?: {
      providers?: ProviderRegistry | null;
      bus?: MessageBusLike | null;
      data_dir?: string;
      events?: WorkflowEventService | null;
      agent_backends?: AgentBackendRegistry | null;
      secret_vault?: SecretVaultService | null;
      logger?: Logger | null;
      provider_caps?: ProviderCapabilities;
      on_task_change?: (task: import("../contracts.js").TaskState) => void;
      app_root?: string;
    },
  ) {
    this.context = new ContextBuilder(workspace, { app_root: args?.app_root });
    const data_dir = args?.data_dir || join(workspace, "runtime");
    this.task_store = new TaskStore(join(data_dir, "tasks"));
    this.subagents = new SubagentRegistry({
      workspace,
      providers: args?.providers || null,
      bus: args?.bus || null,
      context_builder: this.context,
      agent_backends: args?.agent_backends || null,
      logger: args?.logger || null,
      provider_caps: args?.provider_caps,
    });
    this.loop = new AgentLoopStore({
      task_store: this.task_store,
      on_cascade_cancel: (parent_id) => this.subagents.cancel_by_parent_id(parent_id),
      on_task_change: args?.on_task_change,
    });
    const dynamic_store_path = join(data_dir, "custom-tools", "tools.db");
    this.tools = create_default_tool_registry({
      workspace,
      bus: args?.bus || null,
      event_recorder: args?.events
        ? async (event) => args.events!.append(event)
        : null,
      refresh_skills: () => this.skills.refresh(),
      spawn_callback: async (request) => {
        const role_skill = request.role
          ? this.context.skills_loader.get_role_skill(request.role)
          : null;
        const parent_id = String(request.metadata?.parent_id || "").trim() || undefined;
        // 인바운드 민감 텍스트 sealing: 서브에이전트에도 동일 보호 적용
        let sealed_task = request.task;
        const vault = args?.secret_vault;
        if (vault && request.origin_channel && request.origin_chat_id) {
          try {
            sealed_task = (await seal_inbound_sensitive_text(request.task, {
              provider: request.origin_channel,
              chat_id: request.origin_chat_id,
              vault,
            })).text;
          } catch {
            sealed_task = redact_sensitive_text(request.task).text;
          }
        }
        const spawned = await this.subagents.spawn({
          task: sealed_task,
          label: request.label,
          role: request.role,
          soul: request.soul || role_skill?.soul || undefined,
          heart: request.heart || role_skill?.heart || undefined,
          model: request.model,
          max_iterations: request.max_turns,
          origin_channel: request.origin_channel,
          origin_chat_id: request.origin_chat_id,
          announce: true,
          parent_id,
        });
        return spawned;
      },
      dynamic_store_path,
    });
    this.tool_installer = new ToolInstallerService(workspace, dynamic_store_path);
    this.tool_reloader = new ToolRuntimeReloader(new DynamicToolRuntimeLoader(workspace, dynamic_store_path), this.tools);
    this.tool_self_test = new ToolSelfTestService(this.tools);
  }

  private approval_timer: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    await this.loop.initialize();
    this.tool_reloader.start(2000);
    this.approval_timer = setInterval(() => this.tools.expire_stale_approvals(), 60_000);
    this.approval_timer.unref();
  }

  async stop(): Promise<void> {
    this.tool_reloader.stop();
    if (this.approval_timer) {
      clearInterval(this.approval_timer);
      this.approval_timer = null;
    }
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return {
      ok: true,
      details: {
        tools: this.tools.get_definitions().length,
        subagents: this.subagents.list_running().length,
        active_loops: this.loop.list_loops().filter((l) => l.status === "running").length,
        active_tasks: this.loop.list_tasks().filter((t) => t.status === "running").length,
      },
    };
  }

  private get skills() { return this.context.skills_loader; }

  list_always_skills(): string[] {
    return this.skills.get_always_skills();
  }

  recommend_skills(task: string, limit = 6): string[] {
    return this.skills.suggest_skills_for_text(task, limit);
  }

  get_skill_metadata(name: string): import("./skills.types.js").SkillMetadata | null {
    return this.skills.get_skill_metadata(name);
  }

  async append_daily_memory(content: string, day?: string): Promise<void> {
    await this.context.memory_store.append_daily(content, day);
  }
}
