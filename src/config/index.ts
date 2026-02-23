export interface RuntimeConfig {
  provider: "slack" | "discord" | "telegram";
  channels: {
    slack: {
      enabled: boolean;
      bot_token: string;
      default_channel: string;
    };
    discord: {
      enabled: boolean;
      bot_token: string;
      default_channel: string;
      api_base: string;
    };
    telegram: {
      enabled: boolean;
      bot_token: string;
      default_chat_id: string;
      api_base: string;
    };
  };
  timezoneOffsetMin: number;
  agentLoopDefaultMaxTurns: number;
  taskDefaultMaxTurns: number;
  phi4RuntimeEnabled: boolean;
  phi4RuntimeEngine: "auto" | "docker" | "podman";
  phi4RuntimeImage: string;
  phi4RuntimeContainer: string;
  phi4RuntimePort: number;
  phi4RuntimeModel: string;
  phi4RuntimePullModel: boolean;
  phi4RuntimeAutoStop: boolean;
  phi4RuntimeGpuEnabled: boolean;
  phi4RuntimeGpuArgs: string[];
  channelPollIntervalMs: number;
  channelReadLimit: number;
  dashboardEnabled: boolean;
  dashboardPort: number;
  dashboardHost: string;
  dataDir: string;
  dashboardAssetsDir: string;
  templateSourceDir: string;
}

function as_bool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

export function loadConfig(): RuntimeConfig {
  return {
    provider: (String(process.env.CHANNEL_PROVIDER || "slack").toLowerCase() as RuntimeConfig["provider"]),
    channels: {
      slack: {
        enabled: as_bool(process.env.SLACK_ENABLED, true),
        bot_token: String(process.env.SLACK_BOT_TOKEN || ""),
        default_channel: String(process.env.SLACK_DEFAULT_CHANNEL || ""),
      },
      discord: {
        enabled: as_bool(process.env.DISCORD_ENABLED, true),
        bot_token: String(process.env.DISCORD_BOT_TOKEN || ""),
        default_channel: String(process.env.DISCORD_DEFAULT_CHANNEL || ""),
        api_base: String(process.env.DISCORD_API_BASE || "https://discord.com/api/v10"),
      },
      telegram: {
        enabled: as_bool(process.env.TELEGRAM_ENABLED, true),
        bot_token: String(process.env.TELEGRAM_BOT_TOKEN || ""),
        default_chat_id: String(process.env.TELEGRAM_DEFAULT_CHAT_ID || ""),
        api_base: String(process.env.TELEGRAM_API_BASE || "https://api.telegram.org"),
      },
    },
    timezoneOffsetMin: Number(process.env.TZ_OFFSET_MIN || 540),
    agentLoopDefaultMaxTurns: Number(process.env.AGENT_LOOP_MAX_TURNS || 30),
    taskDefaultMaxTurns: Number(process.env.TASK_LOOP_MAX_TURNS || 40),
    phi4RuntimeEnabled: as_bool(process.env.PHI4_RUNTIME_ENABLED, false),
    phi4RuntimeEngine: (String(process.env.PHI4_RUNTIME_ENGINE || "auto").toLowerCase() as RuntimeConfig["phi4RuntimeEngine"]),
    phi4RuntimeImage: String(process.env.PHI4_RUNTIME_IMAGE || "ollama/ollama:latest"),
    phi4RuntimeContainer: String(process.env.PHI4_RUNTIME_CONTAINER || "orchestrator-phi4"),
    phi4RuntimePort: Number(process.env.PHI4_RUNTIME_PORT || 11434),
    phi4RuntimeModel: String(process.env.PHI4_MODEL || "phi4"),
    phi4RuntimePullModel: as_bool(process.env.PHI4_RUNTIME_PULL_MODEL, true),
    phi4RuntimeAutoStop: as_bool(process.env.PHI4_RUNTIME_AUTO_STOP, false),
    phi4RuntimeGpuEnabled: as_bool(process.env.PHI4_RUNTIME_GPU_ENABLED, true),
    phi4RuntimeGpuArgs: String(process.env.PHI4_RUNTIME_GPU_ARGS || "")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean),
    channelPollIntervalMs: Number(process.env.CHANNEL_POLL_INTERVAL_MS || 2000),
    channelReadLimit: Number(process.env.CHANNEL_READ_LIMIT || 30),
    dashboardEnabled: as_bool(process.env.DASHBOARD_ENABLED, true),
    dashboardPort: Number(process.env.DASHBOARD_PORT || 3789),
    dashboardHost: String(process.env.DASHBOARD_HOST || "127.0.0.1"),
    dataDir: String(process.env.ORCH_DATA_DIR || ""),
    dashboardAssetsDir: String(process.env.DASHBOARD_ASSETS_DIR || ""),
    templateSourceDir: String(process.env.TEMPLATE_SOURCE_DIR || ""),
  };
}
