import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentDomain } from "./agent/index.js";
import { create_agent_inspector } from "./agent/inspector.service.js";
import { create_agent_runtime } from "./agent/runtime.service.js";
import { CronTool, MemoryTool, DecisionTool, SecretTool, PromiseTool } from "./agent/tools/index.js";
import { MessageBus } from "./bus/index.js";
import {
  ChannelManager,
  SqliteDispatchDlqStore,
  create_channels_from_config,
  type ChannelRegistryLike,
} from "./channels/index.js";
import { ApprovalService } from "./channels/approval.service.js";
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
} from "./channels/commands/index.js";
import { TaskResumeService } from "./channels/task-resume.service.js";
import { DispatchService } from "./channels/dispatch.service.js";
import { MediaCollector } from "./channels/media-collector.js";
import { DefaultOutboundDedupePolicy } from "./channels/outbound-dedupe.js";
import { sanitize_provider_output } from "./channels/output-sanitizer.js";
import { DefaultRuntimePolicyResolver } from "./channels/runtime-policy.js";
import { SessionRecorder } from "./channels/session-recorder.js";
import { loadConfig } from "./config/index.js";
import { load_config_from_env } from "./config/schema.js";
import { create_cron_job_handler, CronService } from "./cron/index.js";
import { DashboardService } from "./dashboard/service.js";
import { DecisionService } from "./decision/index.js";
import { WorkflowEventService } from "./events/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { create_logger } from "./logger.js";
import { OpsRuntimeService } from "./ops/index.js";
import { OrchestrationService } from "./orchestration/service.js";
import { resolve_reply_to } from "./orchestration/service.js";
import { ProcessTracker } from "./orchestration/process-tracker.js";
import { parse_executor_preference } from "./providers/executor.js";
import { Phi4RuntimeManager, ProviderRegistry } from "./providers/index.js";
import { Phi4ServiceAdapter } from "./providers/phi4-service.adapter.js";
import { acquire_runtime_instance_lock } from "./runtime/instance-lock.js";
import { ServiceManager } from "./runtime/service-manager.js";
import { SessionStore, type SessionStoreLike } from "./session/index.js";
import { McpClientManager, create_mcp_tool_adapters } from "./mcp/index.js";
import { FileMcpServerStore } from "./agent/tools/mcp-store.js";
import { AgentBackendRegistry } from "./agent/agent-registry.js";
import { AgentSessionStore } from "./agent/agent-session-store.js";
import { CliAgent } from "./agent/backends/cli-agent.js";
import { ClaudeSdkAgent } from "./agent/backends/claude-sdk.agent.js";
import { CodexAppServerAgent } from "./agent/backends/codex-appserver.agent.js";
import { load_env_files } from "./utils/env.js";

export interface RuntimeApp {
  agent: AgentDomain;
  bus: MessageBus;
  channels: ChannelRegistryLike;
  channel_manager: ChannelManager;
  cron: CronService;
  heartbeat: HeartbeatService;
  mcp: McpClientManager;
  providers: ProviderRegistry;
  agent_backends: AgentBackendRegistry;
  phi4_runtime: Phi4RuntimeManager;
  sessions: SessionStoreLike;
  dashboard: DashboardService | null;
  decisions: DecisionService;
  events: WorkflowEventService;
  ops: OpsRuntimeService;
  services: ServiceManager;
}

function resolve_from_workspace(workspace: string, path_value: string, fallback: string): string {
  const raw = String(path_value || "").trim();
  if (!raw) return fallback;
  return resolve(workspace, raw);
}

export async function createRuntime(options?: { skip_env_load?: boolean }): Promise<RuntimeApp> {
  let workspace = process.cwd();
  let env_load_summary: { loaded: number; files: string[] } | null = null;
  if (!options?.skip_env_load) {
    const envLoad = load_env_files(workspace);
    if (envLoad.loaded > 0) env_load_summary = envLoad;
  }

  const app_config = load_config_from_env();
  workspace = app_config.workspaceDir || workspace;
  const config = loadConfig(app_config);

  process.env.PHI4_API_BASE = config.phi4RuntimeApiBase;

  const logger = create_logger("runtime");
  if (env_load_summary) {
    logger.info(`loaded env vars=${env_load_summary.loaded} files=${env_load_summary.files.join(",")}`);
  }
  const data_dir = resolve_from_workspace(workspace, config.dataDir, join(workspace, "runtime"));
  const decisions_dir = join(data_dir, "decisions");
  const events_dir = join(data_dir, "events");
  const sessions_dir = join(data_dir, "sessions");
  const bus = new MessageBus();
  const decisions = new DecisionService(workspace, decisions_dir);
  const events = new WorkflowEventService(workspace, events_dir);
  const providers = new ProviderRegistry({
    orchestrator_max_tokens: app_config.orchestration.orchestratorMaxTokens,
  });
  const agent_backends: import("./agent/agent.types.js").AgentBackend[] = [
    new CliAgent("claude_cli", providers.get_provider_instance("claude_code")),
    new CliAgent("codex_cli", providers.get_provider_instance("chatgpt")),
  ];

  const claude_sdk = new ClaudeSdkAgent({ cwd: workspace });
  if (claude_sdk.is_available()) agent_backends.push(claude_sdk);

  const codex_app = new CodexAppServerAgent({ cwd: workspace });
  if (codex_app.is_available()) agent_backends.push(codex_app);

  const agent_session_store = new AgentSessionStore(join(data_dir, "agent-sessions.db"));
  const agent_backend_registry = new AgentBackendRegistry({
    provider_registry: providers,
    backends: agent_backends,
    config: {
      claude_backend: app_config.agentBackend.claudeBackend,
      codex_backend: app_config.agentBackend.codexBackend,
    },
    session_store: agent_session_store,
    logger: logger.child("agent-registry"),
  });
  const agent = new AgentDomain(workspace, { providers, bus, data_dir, events, agent_backends: agent_backend_registry, secret_vault: providers.get_secret_vault(), logger: logger.child("agent"), on_task_change: (task) => dashboard?.broadcast_task_event("status_change", task) });
  const agent_inspector = create_agent_inspector(agent);
  const agent_runtime = create_agent_runtime(agent);
  const sessions = new SessionStore(workspace, sessions_dir);

  const cron = new CronService(join(data_dir, "cron"), create_cron_job_handler({
    config,
    bus,
    events,
    agent_runtime,
    agent_backends: agent_backend_registry,
    secret_vault: providers.get_secret_vault(),
  }), {
    on_change: (type, job_id) => dashboard?.broadcast_cron_event(type, job_id),
  });
  events.bind_task_store(agent.task_store);

  const channels = create_channels_from_config({ channels: config.channels });

  const dlq_store = app_config.channel.dispatch.dlqEnabled
    ? new SqliteDispatchDlqStore(app_config.channel.dispatch.dlqPath)
    : null;
  const dispatch = new DispatchService({
    bus,
    registry: channels,
    retry_config: app_config.channel.dispatch,
    dedupe_config: app_config.channel.outboundDedupe,
    dlq_store,
    dedupe_policy: new DefaultOutboundDedupePolicy(),
    logger: logger.child("dispatch"),
    on_direct_send: (msg) => dashboard?.broadcast_message_event("outbound", msg.sender_id, msg.content, msg.chat_id),
  });

  const session_recorder = new SessionRecorder({
    sessions,
    daily_memory: agent_runtime,
    sanitize_for_storage: sanitize_provider_output,
    logger: logger.child("session"),
  });

  const media_collector = new MediaCollector({
    workspace_dir: workspace,
    tokens: {
      slack_bot_token: config.channels.slack.bot_token,
      telegram_bot_token: config.channels.telegram.bot_token,
      telegram_api_base: config.channels.telegram.api_base,
    },
    logger,
  });

  const approval = new ApprovalService({
    agent_runtime,
    send_reply: (provider, message) => dispatch.send(provider, message),
    resolve_reply_to,
    logger: logger.child("approval"),
  });

  const mcp = new McpClientManager({ logger: logger.child("mcp") });

  let channel_manager_ref: ChannelManager | null = null;
  let dashboard: DashboardService | null = null;

  const process_tracker = new ProcessTracker({
    max_history: 100,
    cancel_strategy: {
      abort_run: (provider, chat_id, alias) => {
        const key = `${provider}:${chat_id}:${alias}`.toLowerCase();
        return (channel_manager_ref?.cancel_active_runs(key) ?? 0) > 0;
      },
      stop_loop: (loop_id) => !!agent_runtime.stop_loop(loop_id),
      cancel_task: async (task_id) => !!(await agent_runtime.cancel_task(task_id)),
      cancel_subagent: (id) => agent.subagents.cancel(id),
    },
    on_change: (type, entry) => dashboard?.broadcast_process_event(type, entry),
  });

  const orchestration = new OrchestrationService({
    providers,
    agent_runtime,
    secret_vault: providers.get_secret_vault(),
    runtime_policy_resolver: new DefaultRuntimePolicyResolver(),
    config: {
      executor_provider: parse_executor_preference(String(process.env.ORCH_EXECUTOR_PROVIDER || "chatgpt")),
      agent_loop_max_turns: app_config.agentLoopMaxTurns,
      task_loop_max_turns: app_config.taskLoopMaxTurns,
      streaming_enabled: app_config.channel.streaming.enabled,
      streaming_interval_ms: app_config.channel.streaming.intervalMs,
      streaming_min_chars: app_config.channel.streaming.minChars,
      max_tool_result_chars: app_config.orchestration.maxToolResultChars,
      orchestrator_max_tokens: app_config.orchestration.orchestratorMaxTokens,
    },
    logger: logger.child("orchestration"),
    agent_backends: agent_backend_registry,
    process_tracker,
    get_mcp_configs: () => mcp.get_server_configs(),
    events,
  });

  const command_router = new CommandRouter([
    new HelpHandler(),
    new StopHandler(async (provider, chat_id) => {
      const key = `${provider}:${chat_id}`;
      return channel_manager_ref?.cancel_active_runs(key) ?? 0;
    }),
    new RenderHandler({
      get: (provider, chat_id) => channel_manager_ref!.get_render_profile(provider, chat_id),
      set: (provider, chat_id, patch) => channel_manager_ref!.set_render_profile(provider, chat_id, patch),
      reset: (provider, chat_id) => channel_manager_ref!.reset_render_profile(provider, chat_id),
    }),
    new SecretHandler(providers.get_secret_vault()),
    new MemoryHandler({ get_memory_store: () => agent.context.memory_store }),
    new DecisionHandler({ get_decision_service: () => decisions }),
    new PromiseHandler({ get_promise_service: () => agent.context.promise_service }),
    new CronHandler(cron),
    new ReloadHandler({
      reload_config: async () => {
        load_env_files(workspace);
      },
      reload_tools: async () => {
        agent.tool_reloader.reload_now();
        return agent.tools.get_definitions().length;
      },
      reload_skills: async () => {
        agent.context.skills_loader.refresh();
        return agent.context.skills_loader.list_skills().length;
      },
    }),
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
        return {
          name: m.name, summary: m.summary, type: m.type, source: m.source,
          always: m.always, model: m.model, tools: m.tools, requirements: m.requirements, role: m.role,
          shared_protocols: m.shared_protocols,
        };
      },
      list_role_skills: () => agent.context.skills_loader.list_role_skills().map((m) => ({
        name: m.name, role: m.role, summary: m.summary,
      })),
      recommend: (task, limit) => agent.context.skills_loader.suggest_skills_for_text(task, limit ?? 5),
      refresh: () => { agent.context.skills_loader.refresh(); return agent.context.skills_loader.list_skills().length; },
    }),
    new DoctorHandler({
      get_tool_count: () => agent.tools.tool_names().length,
      get_skill_count: () => agent.context.skills_loader.list_skills().length,
      get_active_task_count: () => agent_runtime.list_active_tasks().length,
      get_active_loop_count: () => agent_runtime.list_active_loops().length,
      list_backends: () => agent_backend_registry.list_backends().map(String),
      list_mcp_servers: () => mcp.list_servers().map((s) => ({
        name: s.name, connected: s.connected, tool_count: s.tools.length, error: s.error,
      })),
      get_cron_job_count: () => cron.list_jobs().then((jobs) => jobs.length),
    }),
    new AgentHandler({
      list: () => agent.subagents.list().map((s) => ({
        id: s.id, role: s.role, status: s.status, label: s.label,
        created_at: s.created_at, last_error: s.last_error,
        model: s.model, session_id: s.session_id, updated_at: s.updated_at, last_result: s.last_result,
      })),
      list_running: () => agent.subagents.list_running().map((s) => ({
        id: s.id, role: s.role, status: s.status, label: s.label,
        created_at: s.created_at, last_error: s.last_error,
        model: s.model, session_id: s.session_id, updated_at: s.updated_at, last_result: s.last_result,
      })),
      get: (id) => {
        const s = agent.subagents.get(id);
        if (!s) return null;
        return {
          id: s.id, role: s.role, status: s.status, label: s.label,
          created_at: s.created_at, last_error: s.last_error,
          model: s.model, session_id: s.session_id, updated_at: s.updated_at, last_result: s.last_result,
        };
      },
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
          return {
            provider: r.provider,
            score: r.score,
            success_count: m.success_count,
            failure_count: m.failure_count,
            avg_latency_ms: total > 0 ? m.total_latency_ms / total : 0,
          };
        });
      },
    }),
    new VerifyHandler({
      get_last_output: (provider, chat_id) =>
        session_recorder.get_last_assistant_content(provider as import("./channels/types.js").ChannelProvider, chat_id, app_config.channel.defaultAlias),
      run_verification: (task) => agent_runtime.spawn_and_wait({ task, max_turns: 5, timeout_ms: 60_000 }),
    }),
  ]);

  const task_resume = new TaskResumeService({
    agent_runtime,
    logger: logger.child("task-resume"),
  });

  const channel_manager = new ChannelManager({
    bus,
    registry: channels,
    dispatch,
    command_router,
    orchestration,
    approval,
    task_resume,
    session_recorder,
    media_collector,
    process_tracker,
    providers,
    config: app_config.channel,
    workspace_dir: workspace,
    logger: app_config.channel.debug ? create_logger("channels", "debug") : logger.child("channels"),
    on_agent_event: (event) => dashboard?.broadcast_agent_event(event),
  });
  channel_manager_ref = channel_manager;

  const phi4_runtime = new Phi4RuntimeManager({
    enabled: config.phi4RuntimeEnabled,
    engine: config.phi4RuntimeEngine,
    image: config.phi4RuntimeImage,
    container: config.phi4RuntimeContainer,
    port: config.phi4RuntimePort,
    model: config.phi4RuntimeModel,
    pull_model: config.phi4RuntimePullModel,
    auto_stop: config.phi4RuntimeAutoStop,
    gpu_enabled: config.phi4RuntimeGpuEnabled,
    gpu_args: config.phi4RuntimeGpuArgs,
    api_base: process.env.PHI4_API_BASE,
  });

  const services = new ServiceManager(logger.child("services"));

  const default_chat_id = config.provider === "slack"
    ? String(config.channels.slack.default_channel || "").trim()
    : config.provider === "discord"
      ? String(config.channels.discord.default_channel || "").trim()
      : String(config.channels.telegram.default_chat_id || "").trim();

  const heartbeat = new HeartbeatService(workspace, {
    on_heartbeat: async (prompt) => {
      const result = await agent_runtime.spawn_and_wait({ task: prompt, max_turns: 5, timeout_ms: 60_000 });
      return String(result || "");
    },
    on_notify: default_chat_id
      ? async (message) => {
          await bus.publish_outbound({
            id: `heartbeat-notify-${Date.now()}`,
            provider: config.provider,
            channel: config.provider,
            sender_id: "heartbeat",
            chat_id: default_chat_id,
            content: `💓 Heartbeat:\n${message}`,
            at: new Date().toISOString(),
            metadata: { kind: "heartbeat_notify" },
          });
        }
      : null,
  });
  const ops = new OpsRuntimeService({
    bus,
    channels: channel_manager,
    cron,
    heartbeat,
    decisions,
    services,
    secret_vault: providers.get_secret_vault(),
    session_store: sessions,
    promises: agent.context.promise_service,
    dlq: dlq_store,
  });

  if (config.dashboardEnabled) {
    dashboard = new DashboardService({
      host: config.dashboardHost,
      port: config.dashboardPort,
      agent: agent_inspector,
      bus,
      channels: channel_manager,
      heartbeat,
      ops,
      decisions,
      events,
      process_tracker,
      cron,
      task_ops: {
        cancel_task: (id, reason) => agent_runtime.cancel_task(id, reason),
        get_task: (id) => agent_runtime.get_task(id),
        resume_task: (id, text) => agent_runtime.resume_task(id, text),
      },
      stats_ops: {
        get_cd_score: () => orchestration.get_cd_score(),
        reset_cd_score: () => orchestration.reset_cd_score(),
      },
      dlq: dlq_store,
    });
    bus.on_publish((dir, msg) => dashboard?.broadcast_message_event(dir, msg.sender_id, msg.content, msg.chat_id));
  }

  // ProgressEvent consumer: bus → dashboard SSE 릴레이 (대시보드 비활성 시에도 큐 소비)
  (async function progress_relay() {
    while (!bus.is_closed()) {
      const event = await bus.consume_progress({ timeout_ms: 5000 });
      if (event) dashboard?.broadcast_progress_event(event);
    }
  })().catch(() => {});

  if (!agent_runtime.has_tool("cron")) {
    agent_runtime.register_tool(new CronTool(cron));
  }
  if (!agent_runtime.has_tool("memory")) {
    agent_runtime.register_tool(new MemoryTool(agent.context.memory_store));
  }
  if (!agent_runtime.has_tool("decision")) {
    agent_runtime.register_tool(new DecisionTool(decisions));
  }
  if (!agent_runtime.has_tool("secret")) {
    agent_runtime.register_tool(new SecretTool(providers.get_secret_vault()));
  }
  if (!agent_runtime.has_tool("promise")) {
    agent_runtime.register_tool(new PromiseTool(agent.context.promise_service));
  }

  services.register(agent, { required: true });
  services.register(dispatch, { required: true });
  services.register(channel_manager, { required: true });
  services.register(cron, { required: true });
  services.register(heartbeat, { required: false });
  services.register(ops, { required: false });
  if (dashboard) services.register(dashboard, { required: false });
  services.register(mcp, { required: false });
  services.register(new Phi4ServiceAdapter(phi4_runtime), { required: false });

  const enabled_channels = [
    config.channels.slack.enabled && "slack",
    config.channels.discord.enabled && "discord",
    config.channels.telegram.enabled && "telegram",
  ].filter(Boolean);
  logger.info(`channels=${enabled_channels.join(",")} primary=${config.provider} tzOffset=${config.timezoneOffsetMin}`);

  await register_mcp_tools(workspace, mcp, agent_runtime, logger).catch((error) => {
    logger.error(`mcp tool registration failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  await services.start();

  // 만료된 에이전트 세션 정리: 시작 시 즉시 + 1시간 간격
  try { agent_session_store.prune_expired(); } catch { /* noop */ }
  const session_prune_timer = setInterval(() => {
    try { agent_session_store.prune_expired(); } catch { /* noop */ }
  }, 60 * 60 * 1000);
  session_prune_timer.unref();

  if (dashboard) logger.info(`dashboard ${dashboard.get_url()}`);
  const phi4_status = phi4_runtime.get_status();
  if (phi4_status.enabled) {
    logger.info(`phi4 running=${phi4_status.running} engine=${phi4_status.engine || "n/a"} base=${phi4_status.api_base}`);
  }

  const app: RuntimeApp = {
    agent,
    bus,
    channels,
    channel_manager,
    cron,
    heartbeat,
    mcp,
    providers,
    agent_backends: agent_backend_registry,
    phi4_runtime,
    sessions,
    dashboard,
    decisions,
    events,
    ops,
    services,
  };

  return app;
}

async function register_mcp_tools(
  workspace: string,
  mcp: McpClientManager,
  agent_runtime: ReturnType<typeof create_agent_runtime>,
  logger: ReturnType<typeof create_logger>,
): Promise<void> {
  const mcp_store = new FileMcpServerStore(workspace);
  const servers = await mcp_store.list_servers();
  for (const [name, entry] of Object.entries(servers)) {
    if (entry.command) {
      mcp.register_server(name, {
        command: entry.command,
        args: entry.args,
        env: entry.env,
        cwd: entry.cwd,
        startup_timeout_ms: (entry.startup_timeout_sec ?? 15) * 1000,
      });
    }
  }
  await mcp.start();
  const adapters = create_mcp_tool_adapters(mcp);
  for (const adapter of adapters) {
    agent_runtime.register_tool(adapter);
  }
  if (adapters.length > 0) {
    logger.info(`mcp tools registered count=${adapters.length}`);
  }
}

function is_main_entry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const entry = resolve(argv1).toLowerCase();
  const current = resolve(fileURLToPath(import.meta.url)).toLowerCase();
  return entry === current;
}

if (is_main_entry()) {
  void (async () => {
    const boot_logger = create_logger("boot");
    const workspace = process.cwd();
    const envLoad = load_env_files(workspace);
    if (envLoad.loaded > 0) {
      boot_logger.info(`loaded env vars=${envLoad.loaded} files=${envLoad.files.join(",")}`);
    }
    const lock = await acquire_runtime_instance_lock({ workspace, retries: 25, retry_ms: 200 });
    if (!lock.acquired) {
      boot_logger.error(`another instance is active holder_pid=${lock.holder_pid || "unknown"} lock=${lock.lock_path}`);
      process.exit(1);
    }

    const app = await createRuntime({ skip_env_load: true });
    const release_lock = async (): Promise<void> => {
      await lock.release().catch(() => undefined);
    };
    let shutting_down = false;
    const on_signal = (sig: string) => {
      if (shutting_down) return;
      shutting_down = true;
      boot_logger.info(`graceful shutdown start signal=${sig}`);
      void app.services.stop()
        .then(() => app.agent_backends.close())
        .then(() => app.bus.close())
        .then(() => { if ("close" in app.sessions) (app.sessions as { close(): void }).close(); })
        .catch((err) => { boot_logger.error(`shutdown error: ${err instanceof Error ? err.message : String(err)}`); })
        .finally(() => {
          void release_lock().finally(() => {
            boot_logger.info("graceful shutdown done");
            process.exit(0);
          });
        });
    };
    process.on("SIGINT", () => on_signal("SIGINT"));
    process.on("SIGTERM", () => on_signal("SIGTERM"));
  })().catch((error) => {
    const detail = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
    create_logger("boot").error(`bootstrap failed: ${detail}`);
    process.exit(1);
  });
}
