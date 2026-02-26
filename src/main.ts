import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentDomain } from "./agent/index.js";
import { create_agent_inspector } from "./agent/inspector.service.js";
import { create_agent_runtime } from "./agent/runtime.service.js";
import { CronTool } from "./agent/tools/index.js";
import { MessageBus } from "./bus/index.js";
import { ChannelManager, create_channels_from_config, type ChannelRegistryLike } from "./channels/index.js";
import { loadConfig } from "./config/index.js";
import { create_cron_job_handler, CronService } from "./cron/index.js";
import { DashboardService } from "./dashboard/service.js";
import { DecisionService } from "./decision/index.js";
import { WorkflowEventService } from "./events/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { OpsRuntimeService } from "./ops/index.js";
import { Phi4RuntimeManager, ProviderRegistry } from "./providers/index.js";
import { acquire_runtime_instance_lock } from "./runtime/instance-lock.js";
import { run_lifecycle_step_background, run_lifecycle_steps } from "./runtime/lifecycle.js";
import { SessionStore, type SessionStoreLike } from "./session/index.js";
import { TemplateEngine } from "./templates/index.js";
import { load_env_files } from "./utils/env.js";

export interface RuntimeApp {
  agent: AgentDomain;
  bus: MessageBus;
  channels: ChannelRegistryLike;
  channel_manager: ChannelManager;
  cron: CronService;
  heartbeat: HeartbeatService;
  providers: ProviderRegistry;
  phi4_runtime: Phi4RuntimeManager;
  sessions: SessionStoreLike;
  templates: TemplateEngine;
  dashboard: DashboardService | null;
  decisions: DecisionService;
  events: WorkflowEventService;
  ops: OpsRuntimeService;
}

let shutdown_started = false;

async function graceful_shutdown(app: RuntimeApp, signal: string): Promise<void> {
  if (shutdown_started) return;
  shutdown_started = true;
  // eslint-disable-next-line no-console
  console.log(`[runtime] graceful shutdown start signal=${signal}`);
  await run_lifecycle_steps(
    [
      { name: "ops.stop", run: () => app.ops.stop() },
      { name: "dashboard.stop", run: () => app.dashboard?.stop() || Promise.resolve() },
      { name: "agent.stop", run: () => app.agent.stop() },
      { name: "channel_manager.stop", run: () => app.channel_manager.stop() },
      { name: "heartbeat.stop", run: () => app.heartbeat.stop() },
      { name: "cron.stop", run: () => app.cron.stop() },
      { name: "bus.close", run: () => app.bus.close() },
      { name: "phi4_runtime.stop", run: () => app.phi4_runtime.stop() },
    ],
    () => {
      // ignore shutdown errors
    },
  );
  // eslint-disable-next-line no-console
  console.log("[runtime] graceful shutdown done");
}

function resolve_from_workspace(workspace: string, path_value: string, fallback: string): string {
  const raw = String(path_value || "").trim();
  if (!raw) return fallback;
  return resolve(workspace, raw);
}

export function createRuntime(options?: { skip_env_load?: boolean }): RuntimeApp {
  const workspace = process.cwd();
  if (!options?.skip_env_load) {
    const envLoad = load_env_files(workspace);
    if (envLoad.loaded > 0) {
      // eslint-disable-next-line no-console
      console.log(`[runtime] loaded env vars=${envLoad.loaded} files=${envLoad.files.join(",")}`);
    }
  }
  const config = loadConfig();
  if (!process.env.PHI4_API_BASE || process.env.PHI4_API_BASE.trim().length === 0) {
    process.env.PHI4_API_BASE = `http://127.0.0.1:${config.phi4RuntimePort}/v1`;
  }

  // Intentionally avoid implicit workspace bootstrap side effects.
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
  const cron = new CronService(join(data_dir, "cron"), create_cron_job_handler({
    config,
    bus,
    events,
    agent_runtime,
    providers,
  }));
  events.bind_task_store(agent.task_store);
  const channels = create_channels_from_config({
    channels: config.channels,
  });
  const channel_manager = new ChannelManager({
    bus,
    registry: channels,
    providers,
    agent,
    agent_runtime,
    cron,
    sessions: new SessionStore(workspace, sessions_dir),
    poll_interval_ms: config.channelPollIntervalMs,
    read_limit: config.channelReadLimit,
    targets: {
      slack: config.channels.slack.default_channel,
      discord: config.channels.discord.default_channel,
      telegram: config.channels.telegram.default_chat_id,
    },
  });

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

  const app: RuntimeApp = {
    agent,
    bus,
    channels,
    channel_manager,
    cron,
    heartbeat: new HeartbeatService(workspace),
    providers,
    phi4_runtime,
    sessions: channel_manager.sessions!,
    templates: new TemplateEngine(workspace),
    dashboard: null,
    decisions,
    events,
    ops: {} as OpsRuntimeService,
  };
  if (!agent_runtime.has_tool("cron")) {
    agent_runtime.register_tool(new CronTool(app.cron));
  }
  app.ops = new OpsRuntimeService({
    bus: app.bus,
    channels: app.channel_manager,
    cron: app.cron,
    heartbeat: app.heartbeat,
    decisions: app.decisions,
  });
  if (config.dashboardEnabled) {
    app.dashboard = new DashboardService({
      host: config.dashboardHost,
      port: config.dashboardPort,
      workspace,
      assets_dir: dashboard_assets_dir,
      agent: agent_inspector,
      bus: app.bus,
      channels: app.channel_manager,
      heartbeat: app.heartbeat,
      ops: app.ops,
      decisions: app.decisions,
      events: app.events,
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[runtime] started provider=${config.provider} tzOffset=${config.timezoneOffsetMin}`);

  const start_error = (name: string, error: unknown): void => {
    // eslint-disable-next-line no-console
    console.error(`[runtime] ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  };
  run_lifecycle_step_background({ name: "agent.start", run: () => app.agent.start() }, start_error);
  const channel_manager_start = app.channel_manager.start();
  run_lifecycle_step_background({ name: "channel manager start", run: () => channel_manager_start }, start_error);
  run_lifecycle_step_background({
    name: "cron.start",
    run: async () => {
      await channel_manager_start;
      await app.cron.start();
    },
  }, start_error);
  // inbound polling is handled directly by ChannelManager.
  run_lifecycle_step_background({ name: "ops.start", run: () => app.ops.start() }, start_error);
  run_lifecycle_step_background(
    { name: "dashboard start", run: () => app.dashboard?.start() || Promise.resolve() },
    start_error,
    () => {
      if (!app.dashboard) return;
      // eslint-disable-next-line no-console
      console.log(`[runtime] dashboard ${app.dashboard.get_url()}`);
    },
  );
  run_lifecycle_step_background(
    { name: "phi4 runtime start", run: () => app.phi4_runtime.start() },
    start_error,
    () => {
      const status = app.phi4_runtime.get_status();
      // eslint-disable-next-line no-console
      console.log(`[runtime] phi4 runtime enabled=${status.enabled} running=${status.running} engine=${status.engine || "n/a"} base=${status.api_base}`);
    },
  );

  return app;
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
    const workspace = process.cwd();
    const envLoad = load_env_files(workspace);
    if (envLoad.loaded > 0) {
      // eslint-disable-next-line no-console
      console.log(`[runtime] loaded env vars=${envLoad.loaded} files=${envLoad.files.join(",")}`);
    }
    const lock = await acquire_runtime_instance_lock({ workspace, retries: 25, retry_ms: 200 });
    if (!lock.acquired) {
      // eslint-disable-next-line no-console
      console.error(`[runtime] another instance is active holder_pid=${lock.holder_pid || "unknown"} lock=${lock.lock_path}`);
      process.exit(1);
      return;
    }

    const app = createRuntime({ skip_env_load: true });
    const release_lock = async (): Promise<void> => {
      await lock.release().catch(() => undefined);
    };
    const on_signal = (signal: string) => {
      void graceful_shutdown(app, signal).finally(() => {
        void release_lock().finally(() => {
          process.exit(0);
        });
      });
    };
    process.on("SIGINT", () => on_signal("SIGINT"));
    process.on("SIGTERM", () => on_signal("SIGTERM"));
    process.on("exit", () => {
      void release_lock();
    });
  })().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[runtime] bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
