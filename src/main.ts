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
} from "./channels/commands/index.js";
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
import { parse_executor_preference } from "./providers/executor.js";
import { Phi4RuntimeManager, ProviderRegistry } from "./providers/index.js";
import { Phi4ServiceAdapter } from "./providers/phi4-service.adapter.js";
import { acquire_runtime_instance_lock } from "./runtime/instance-lock.js";
import { ServiceManager } from "./runtime/service-manager.js";
import { SessionStore, type SessionStoreLike } from "./session/index.js";
import { TemplateEngine } from "./templates/index.js";
import { McpClientManager, create_mcp_tool_adapters } from "./mcp/index.js";
import { FileMcpServerStore } from "./agent/tools/mcp-store.js";
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
  phi4_runtime: Phi4RuntimeManager;
  sessions: SessionStoreLike;
  templates: TemplateEngine;
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

export function createRuntime(options?: { skip_env_load?: boolean }): RuntimeApp {
  const workspace = process.cwd();
  let env_load_summary: { loaded: number; files: string[] } | null = null;
  if (!options?.skip_env_load) {
    const envLoad = load_env_files(workspace);
    if (envLoad.loaded > 0) env_load_summary = envLoad;
  }

  const app_config = load_config_from_env();
  const config = loadConfig(app_config);

  if (!process.env.PHI4_API_BASE || process.env.PHI4_API_BASE.trim().length === 0) {
    process.env.PHI4_API_BASE = `http://127.0.0.1:${config.phi4RuntimePort}/v1`;
  }

  const logger = create_logger("runtime");
  if (env_load_summary) {
    logger.info(`loaded env vars=${env_load_summary.loaded} files=${env_load_summary.files.join(",")}`);
  }
  const data_dir = resolve_from_workspace(workspace, config.dataDir, join(workspace, "runtime"));
  const decisions_dir = join(data_dir, "decisions");
  const events_dir = join(data_dir, "events");
  const sessions_dir = join(data_dir, "sessions");
  const dashboard_assets_dir = resolve_from_workspace(workspace, config.dashboardAssetsDir, join(workspace, "dashboard"));

  const bus = new MessageBus();
  const decisions = new DecisionService(workspace, decisions_dir);
  const events = new WorkflowEventService(workspace, events_dir);
  const providers = new ProviderRegistry();
  const agent = new AgentDomain(workspace, { providers, bus, data_dir, events });
  const agent_inspector = create_agent_inspector(agent);
  const agent_runtime = create_agent_runtime(agent);
  const sessions = new SessionStore(workspace, sessions_dir);

  const cron = new CronService(join(data_dir, "cron"), create_cron_job_handler({
    config,
    bus,
    events,
    agent_runtime,
    providers,
  }));
  events.bind_task_store(agent.task_store);

  const channels = create_channels_from_config({ channels: config.channels });

  const dispatch = new DispatchService({
    bus,
    registry: channels,
    retry_config: app_config.channel.dispatch,
    dedupe_config: app_config.channel.outboundDedupe,
    dlq_store: app_config.channel.dispatch.dlqEnabled
      ? new SqliteDispatchDlqStore(app_config.channel.dispatch.dlqPath)
      : null,
    dedupe_policy: new DefaultOutboundDedupePolicy(),
    logger: logger.child("dispatch"),
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
  });

  const approval = new ApprovalService({
    agent_runtime,
    send_reply: (provider, message) => dispatch.send(provider, message),
    resolve_reply_to,
    logger: logger.child("approval"),
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
    },
    logger: logger.child("orchestration"),
  });

  let channel_manager_ref: ChannelManager | null = null;

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
        return agent.context.skills_loader.list_skills().length;
      },
    }),
    new StatusHandler({
      list_tools: () => agent.tools.get_definitions().map((d) => ({ name: String((d as Record<string, unknown>).name || "") })),
      list_skills: () => agent.context.skills_loader.list_skills(true) as Array<{ name: string; summary: string; always: string }>,
    }),
  ]);

  const channel_manager = new ChannelManager({
    bus,
    registry: channels,
    dispatch,
    command_router,
    orchestration,
    approval,
    session_recorder,
    media_collector,
    providers,
    config: app_config.channel,
    workspace_dir: workspace,
    logger: logger.child("channels"),
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

  const mcp = new McpClientManager({ logger: logger.child("mcp") });

  const heartbeat = new HeartbeatService(workspace);
  const ops = new OpsRuntimeService({
    bus,
    channels: channel_manager,
    cron,
    heartbeat,
    decisions,
  });

  let dashboard: DashboardService | null = null;
  if (config.dashboardEnabled) {
    dashboard = new DashboardService({
      host: config.dashboardHost,
      port: config.dashboardPort,
      workspace,
      assets_dir: dashboard_assets_dir,
      agent: agent_inspector,
      bus,
      channels: channel_manager,
      heartbeat,
      ops,
      decisions,
      events,
    });
  }

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

  const services = new ServiceManager(logger.child("services"));

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

  void register_mcp_tools(workspace, mcp, agent_runtime, logger).catch((error) => {
    logger.error(`mcp tool registration failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  void services.start().then(() => {
    if (dashboard) logger.info(`dashboard ${dashboard.get_url()}`);
    const status = phi4_runtime.get_status();
    if (status.enabled) {
      logger.info(`phi4 running=${status.running} engine=${status.engine || "n/a"} base=${status.api_base}`);
    }
  }).catch((error) => {
    logger.error(`service start failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  const app: RuntimeApp = {
    agent,
    bus,
    channels,
    channel_manager,
    cron,
    heartbeat,
    mcp,
    providers,
    phi4_runtime,
    sessions,
    templates: new TemplateEngine(workspace),
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

    const app = createRuntime({ skip_env_load: true });
    const release_lock = async (): Promise<void> => {
      await lock.release().catch(() => undefined);
    };
    let shutting_down = false;
    const on_signal = (sig: string) => {
      if (shutting_down) return;
      shutting_down = true;
      boot_logger.info(`graceful shutdown start signal=${sig}`);
      void app.services.stop()
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
