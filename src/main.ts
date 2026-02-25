import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentDomain } from "./agent/index.js";
import { CronTool } from "./agent/tools/index.js";
import { MessageBus } from "./bus/index.js";
import { ChannelManager, ChannelRegistry, create_channels_from_config } from "./channels/index.js";
import { loadConfig } from "./config/index.js";
import { create_cron_job_handler, CronService, default_chat_for_provider } from "./cron/index.js";
import { DashboardService } from "./dashboard/service.js";
import { DecisionService } from "./decision/index.js";
import { WorkflowEventService } from "./events/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { OpsRuntimeService } from "./ops/index.js";
import { Phi4RuntimeManager, ProviderRegistry } from "./providers/index.js";
import { SessionStore } from "./session/index.js";
import { TemplateEngine } from "./templates/index.js";
import { load_env_files } from "./utils/env.js";

export interface RuntimeApp {
  agent: AgentDomain;
  bus: MessageBus;
  channels: ChannelRegistry;
  channel_manager: ChannelManager;
  cron: CronService;
  heartbeat: HeartbeatService;
  providers: ProviderRegistry;
  phi4_runtime: Phi4RuntimeManager;
  sessions: SessionStore;
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
  try {
    await app.ops.stop();
  } catch {
    // ignore shutdown errors
  }
  try {
    await app.dashboard?.stop();
  } catch {
    // ignore shutdown errors
  }
  try {
    await app.agent.stop();
  } catch {
    // ignore shutdown errors
  }
  try {
    await app.channel_manager.stop();
  } catch {
    // ignore shutdown errors
  }
  try {
    await app.heartbeat.stop();
  } catch {
    // ignore shutdown errors
  }
  try {
    await app.cron.stop();
  } catch {
    // ignore shutdown errors
  }
  try {
    await app.bus.close();
  } catch {
    // ignore shutdown errors
  }
  try {
    await app.phi4_runtime.stop();
  } catch {
    // ignore shutdown errors
  }
  // eslint-disable-next-line no-console
  console.log("[runtime] graceful shutdown done");
}

function resolve_from_workspace(workspace: string, path_value: string, fallback: string): string {
  const raw = String(path_value || "").trim();
  if (!raw) return fallback;
  return resolve(workspace, raw);
}

export function createRuntime(): RuntimeApp {
  const workspace = process.cwd();
  const envLoad = load_env_files(workspace);
  if (envLoad.loaded > 0) {
    // eslint-disable-next-line no-console
    console.log(`[runtime] loaded env vars=${envLoad.loaded} files=${envLoad.files.join(",")}`);
  }
  const config = loadConfig();
  if (!process.env.PHI4_API_BASE || process.env.PHI4_API_BASE.trim().length === 0) {
    process.env.PHI4_API_BASE = `http://127.0.0.1:${config.phi4RuntimePort}/v1`;
  }

  // Intentionally avoid implicit workspace bootstrap side effects.
  const data_dir = resolve_from_workspace(workspace, config.dataDir, join(workspace, "runtime"));
  const decisions_dir = join(data_dir, "decisions");
  const events_dir = join(data_dir, "events");
  const task_details_dir = join(data_dir, "tasks", "details");
  const sessions_dir = join(data_dir, "sessions");
  const dashboard_assets_dir = resolve_from_workspace(workspace, config.dashboardAssetsDir, join(workspace, "dashboard"));

  const bus = new MessageBus();
  const decisions = new DecisionService(workspace, decisions_dir);
  const events = new WorkflowEventService(workspace, events_dir, task_details_dir);
  const providers = new ProviderRegistry();
  const agent = new AgentDomain(workspace, { providers, bus, data_dir, events });
  const cron = new CronService(join(data_dir, "cron"), create_cron_job_handler({
    config,
    bus,
    events,
    agent,
    providers,
  }));
  events.bind_task_store(agent.task_store);
  const channels = create_channels_from_config({
    provider_hint: config.provider,
    channels: config.channels,
  });
  const channel_manager = new ChannelManager({
    bus,
    registry: channels,
    provider_hint: config.provider,
    providers,
    agent,
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
  if (!app.agent.tools.has("cron")) {
    app.agent.tools.register(new CronTool(app.cron, {
      send_callback: async (message) => {
        await app.bus.publish_outbound(message);
      },
      default_channel: config.provider,
      default_chat_id: default_chat_for_provider(config, config.provider),
    }));
  }
  app.ops = new OpsRuntimeService({
    bus: app.bus,
    channels: app.channel_manager,
    cron: app.cron,
    heartbeat: app.heartbeat,
    agent: app.agent,
    decisions: app.decisions,
  });
  if (config.dashboardEnabled) {
    app.dashboard = new DashboardService({
      host: config.dashboardHost,
      port: config.dashboardPort,
      workspace,
      assets_dir: dashboard_assets_dir,
      agent: app.agent,
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

  void app.agent.start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[runtime] agent start failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  void app.cron.start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[runtime] cron start failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  void app.channel_manager.start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[runtime] channel manager start failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  // inbound polling is handled directly by ChannelManager.
  void app.ops.start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[runtime] ops start failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  void app.dashboard?.start().then(() => {
    // eslint-disable-next-line no-console
    console.log(`[runtime] dashboard http://${config.dashboardHost}:${config.dashboardPort}`);
  }).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[runtime] dashboard start failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  void app.phi4_runtime.start().then((status) => {
    // eslint-disable-next-line no-console
    console.log(`[runtime] phi4 runtime enabled=${status.enabled} running=${status.running} engine=${status.engine || "n/a"} base=${status.api_base}`);
  }).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[runtime] phi4 runtime start failed: ${error instanceof Error ? error.message : String(error)}`);
  });

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
  const app = createRuntime();
  const on_signal = (signal: string) => {
    void graceful_shutdown(app, signal).finally(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", () => on_signal("SIGINT"));
  process.on("SIGTERM", () => on_signal("SIGTERM"));
}
