import type { AgentProfile } from "../contracts.js";
import type { TemplateEngine } from "../templates/index.js";
import type { MessageBus } from "../bus/index.js";
import type { ProviderRegistry } from "../providers/index.js";
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

export class AgentDomain implements ServiceLike {
  readonly name = "agent-domain";
  private readonly profiles = new Map<string, AgentProfile>();
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
      bus?: MessageBus | null;
      data_dir?: string;
      events?: WorkflowEventService | null;
    },
  ) {
    this.context = new ContextBuilder(workspace);
    const data_dir = args?.data_dir || join(workspace, "runtime");
    this.task_store = new TaskStore(join(data_dir, "tasks"));
    this.loop = new AgentLoopStore({ task_store: this.task_store });
    this.subagents = new SubagentRegistry({
      workspace,
      providers: args?.providers || null,
      bus: args?.bus || null,
      context_builder: this.context,
    });
    const dynamic_store_path = join(data_dir, "custom-tools", "tools.db");
    this.tools = create_default_tool_registry({
      workspace,
      bus: args?.bus || null,
      event_recorder: args?.events
        ? async (event) => args.events?.append(event)
        : null,
      refresh_skills: () => this.skills.refresh(),
      spawn_callback: async (request) => {
        const persona = request.role
          ? this.context.get_role_persona(request.role)
          : null;
        const spawned = await this.subagents.spawn({
          task: request.task,
          label: request.label,
          role: request.role,
          soul: request.soul || persona?.soul || undefined,
          heart: request.heart || persona?.heart || undefined,
          model: request.model,
          max_iterations: request.max_turns,
          origin_channel: request.origin_channel,
          origin_chat_id: request.origin_chat_id,
          announce: true,
        });
        return spawned;
      },
      dynamic_store_path,
    });
    this.tool_installer = new ToolInstallerService(workspace, dynamic_store_path);
    this.tool_reloader = new ToolRuntimeReloader(new DynamicToolRuntimeLoader(workspace, dynamic_store_path), this.tools);
    this.tool_self_test = new ToolSelfTestService(this.tools);
  }

  async start(): Promise<void> {
    await this.loop.initialize();
    this.tool_reloader.start(2000);
  }

  async stop(): Promise<void> {
    this.tool_reloader.stop();
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return { ok: true, details: { tools: this.tools.get_definitions().length, subagents: this.subagents.list_running().length } };
  }

  register_profile(profile: AgentProfile): void {
    this.profiles.set(profile.id, profile);
  }

  get_profile(agentId: string): AgentProfile | null {
    return this.profiles.get(agentId) || null;
  }

  async bootstrap_context(agentId: string, templates: TemplateEngine, teamId?: string): Promise<void> {
    await this.context.bootstrap(agentId, templates.getBootstrapSet(), {
      teamId,
      memory: { longterm: await this.context.memory_store.read_longterm() },
    });
  }

  private get skills() { return this.context.skills_loader; }

  list_skills(filter_unavailable = false): Array<Record<string, string>> {
    return this.skills.list_skills(filter_unavailable);
  }

  list_always_skills(): string[] {
    return this.skills.get_always_skills();
  }

  recommend_skills(task: string, limit = 6): string[] {
    return this.skills.suggest_skills_for_text(task, limit);
  }

  load_skill_via_context(agentId: string, skill_name: string): string | null {
    const loaded = this.skills.load_skills(skill_name);
    if (!loaded) return null;
    this.context.attach_skills(agentId, [skill_name]);
    return loaded;
  }

  build_skill_summary(): string {
    return this.skills.build_skill_summary();
  }

  get_skill_metadata(name: string): import("./skills.types.js").SkillMetadata | null {
    return this.skills.get_skill_metadata(name);
  }

  get_missing_requirements(skill_name: string): string {
    return this.skills.get_missing_requirements(skill_name);
  }

  async append_daily_memory(content: string, day?: string): Promise<void> {
    await this.context.memory_store.append_daily(content, day);
  }
}
