/** CommandRouter 조립 팩토리. 서비스 인스턴스를 받아 핸들러 deps 구성까지 수행. */

import {
  CommandRouter,
  HelpHandler,
  StopHandler,
  RenderHandler,
  SecretHandler,
  MemoryHandler,
  DecisionHandler,
  CronHandler,
  PromiseHandler,
  ReloadHandler,
  StatusHandler,
  TaskHandler,
  SkillHandler,
  DoctorHandler,
  AgentHandler,
  StatsHandler,
  VerifyHandler,
  GuardHandler,
  McpHandler,
} from "./commands/index.js";
import type { ChannelProvider } from "./types.js";
import type { AgentDomain } from "../agent/index.js";
import type { CronService } from "../cron/index.js";
import type { DecisionService } from "../decision/index.js";
import type { ProcessTracker } from "../orchestration/process-tracker.js";
import type { OrchestrationService } from "../orchestration/service.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { McpClientManager } from "../mcp/index.js";
import type { Logger } from "../logger.js";
import type { ConfirmationGuard } from "../orchestration/confirmation-guard.js";
import type { TonePreferenceStore } from "./persona-message-renderer.js";
import { ToneHandler } from "./commands/tone.handler.js";

export type CommandRouterDeps = {
  cancel_active_runs: (key: string) => number;
  render_profile: {
    get: (p: string, c: string) => ReturnType<import("./commands/render.handler.js").RenderProfileStore["get"]>;
    set: (p: string, c: string, patch: Parameters<import("./commands/render.handler.js").RenderProfileStore["set"]>[2]) => ReturnType<import("./commands/render.handler.js").RenderProfileStore["set"]>;
    reset: (p: string, c: string) => ReturnType<import("./commands/render.handler.js").RenderProfileStore["reset"]>;
  };
  agent: AgentDomain;
  agent_runtime: ReturnType<typeof import("../agent/runtime.service.js").create_agent_runtime>;
  process_tracker: ProcessTracker;
  orchestration: OrchestrationService;
  providers: ProviderRegistry;
  agent_backend_registry: AgentBackendRegistry;
  mcp: McpClientManager;
  session_recorder: { get_last_assistant_content: (provider: ChannelProvider, chat_id: string, alias: string) => string | Promise<string | null> | null };
  cron: CronService;
  decisions: DecisionService;
  default_alias: string;
  logger?: Logger | null;
  confirmation_guard?: ConfirmationGuard | null;
  tone_store?: TonePreferenceStore | null;
  usage_ops?: import("../gateway/usage-store.js").UsageStore | null;
};

export function create_command_router(deps: CommandRouterDeps): CommandRouter {
  const { agent, agent_runtime, process_tracker, orchestration, providers, agent_backend_registry, mcp, cron } = deps;

  const pick_subagent = (s: { id: string; role: string; status: string; label?: string; created_at?: string; last_error?: string; model?: string; session_id?: string; updated_at?: string; last_result?: string }) => ({
    id: s.id, role: s.role, status: s.status, label: s.label,
    created_at: s.created_at, last_error: s.last_error,
    model: s.model, session_id: s.session_id, updated_at: s.updated_at, last_result: s.last_result,
  });

  return new CommandRouter([
    new HelpHandler(),
    new StopHandler(async (provider, chat_id) => deps.cancel_active_runs(`${provider}:${chat_id}`)),
    new RenderHandler(deps.render_profile),
    new SecretHandler(providers.get_secret_vault()),
    new MemoryHandler({ get_memory_store: () => agent.context.memory_store }),
    new DecisionHandler({ get_decision_service: () => deps.decisions }),
    new PromiseHandler({ get_promise_service: () => agent.context.promise_service }),
    new CronHandler(cron),
    new ReloadHandler({
      reload_config: async () => {},
      reload_tools: async () => { agent.tool_reloader.reload_now(); return agent.tools.get_definitions().length; },
      reload_skills: async () => { agent.context.skills_loader.refresh(); return agent.context.skills_loader.list_skills().length; },
    }, deps.logger),
    new TaskHandler({
      find_waiting_task: (provider, chat_id) => agent_runtime.find_waiting_task(provider, chat_id),
      get_task: (task_id) => agent_runtime.get_task(task_id),
      cancel_task: (task_id, reason) => agent_runtime.cancel_task(task_id, reason),
      list_active_tasks: () => agent_runtime.list_active_tasks(),
      list_active_loops: () => agent_runtime.list_active_loops(),
      stop_loop: (loop_id, reason) => agent_runtime.stop_loop(loop_id, reason),
      list_active_processes: () => process_tracker.list_active(),
      list_recent_processes: (limit) => process_tracker.list_recent(limit),
      get_process: (run_id) => process_tracker.get(run_id),
      cancel_process: (run_id) => process_tracker.cancel(run_id),
    }),
    new StatusHandler({
      list_tools: () => agent.tools.tool_names().map((name) => ({ name })),
      list_skills: () => agent.context.skills_loader.list_skills(true) as Array<{ name: string; summary: string; always: string }>,
    }),
    new SkillHandler({
      list_skills: () => agent.context.skills_loader.list_skills(true).map((s) => ({
        name: String(s.name || ""), summary: String(s.summary || ""),
        type: String(s.type || "tool"), source: String(s.source || "local"),
        always: s.always === "true", model: s.model ? String(s.model) : null,
      })),
      get_skill: (name) => {
        const m = agent.context.skills_loader.get_skill_metadata(name);
        if (!m) return null;
        return { name: m.name, summary: m.summary, type: m.type, source: m.source, always: m.always, model: m.model, tools: m.tools, requirements: m.requirements, role: m.role, shared_protocols: m.shared_protocols };
      },
      list_role_skills: () => agent.context.skills_loader.list_role_skills().map((m) => ({ name: m.name, role: m.role, summary: m.summary })),
      recommend: (task, limit) => agent.context.skills_loader.suggest_skills_for_text(task, limit ?? 5),
      refresh: () => { agent.context.skills_loader.refresh(); return agent.context.skills_loader.list_skills().length; },
    }),
    new DoctorHandler({
      get_tool_count: () => agent.tools.tool_names().length,
      get_skill_count: () => agent.context.skills_loader.list_skills().length,
      get_active_task_count: () => agent_runtime.list_active_tasks().length,
      get_active_loop_count: () => agent_runtime.list_active_loops().length,
      list_backends: () => agent_backend_registry.list_backends().map(String),
      list_mcp_servers: () => mcp.list_servers().map((s) => ({ name: s.name, connected: s.connected, tool_count: s.tools.length, error: s.error })),
      get_cron_job_count: () => cron.list_jobs().then((jobs) => jobs.length),
    }),
    new AgentHandler({
      list: () => agent.subagents.list().map(pick_subagent),
      list_running: () => agent.subagents.list_running().map(pick_subagent),
      get: (id) => { const s = agent.subagents.get(id); return s ? pick_subagent(s) : null; },
      cancel: (id) => agent.subagents.cancel(id),
      send_input: (id, text) => agent.subagents.send_input(id, text),
      get_running_count: () => agent.subagents.get_running_count(),
    }),
    new StatsHandler({
      get_cd_score: () => orchestration.get_cd_score(),
      reset_cd: () => orchestration.reset_cd_score(),
      get_active_task_count: () => agent_runtime.list_active_tasks().length,
      get_active_loop_count: () => agent_runtime.list_active_loops().length,
      get_provider_health: () => {
        const scorer = providers.get_health_scorer();
        return scorer.rank().map((r) => {
          const m = scorer.get_metrics(r.provider);
          const total = m.success_count + m.failure_count;
          return { provider: r.provider, score: r.score, success_count: m.success_count, failure_count: m.failure_count, avg_latency_ms: total > 0 ? m.total_latency_ms / total : 0 };
        });
      },
      get_today_by_model: deps.usage_ops ? () => deps.usage_ops!.get_today_by_model() : undefined,
    }),
    new VerifyHandler({
      get_last_output: (provider, chat_id) =>
        deps.session_recorder.get_last_assistant_content(provider as ChannelProvider, chat_id, deps.default_alias),
      run_verification: (task) => agent_runtime.spawn_and_wait({ task, max_turns: 5, timeout_ms: 60_000 }),
    }),
    ...(deps.confirmation_guard ? [new GuardHandler(deps.confirmation_guard)] : []),
    ...(deps.tone_store ? [new ToneHandler(deps.tone_store, (ctx) => `${ctx.provider}:${ctx.message.chat_id}`.toLowerCase())] : []),
    new McpHandler({
      list_servers: () => mcp.list_servers().map((s) => ({ name: s.name, connected: s.connected, tool_count: s.tools.length, error: s.error })),
      reconnect: async (name) => {
        const configs = mcp.get_server_configs();
        const config = configs[name];
        if (!config) return false;
        try { await mcp.connect_server(name, config); return true; } catch { return false; }
      },
    }),
  ]);
}
