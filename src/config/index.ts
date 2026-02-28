import type { AppConfig } from "./schema.js";

export type ChannelProvider = "slack" | "discord" | "telegram";

export interface RuntimeConfig {
  /** 활성화된 채널 중 첫 번째 (폴백 용도). */
  provider: ChannelProvider;
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
  phi4RuntimeEngine: "auto" | "native" | "docker" | "podman";
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

/** AppConfig(Zod)에서 RuntimeConfig를 파생. process.env 중복 파싱 제거. */
export function loadConfig(app_config: AppConfig): RuntimeConfig {
  const c = app_config;
  const primary = resolve_primary_provider(c);
  return {
    provider: primary,
    channels: {
      slack: {
        enabled: c.channels.slack.enabled,
        bot_token: c.channels.slack.botToken,
        default_channel: c.channels.slack.defaultTarget,
      },
      discord: {
        enabled: c.channels.discord.enabled,
        bot_token: c.channels.discord.botToken,
        default_channel: c.channels.discord.defaultTarget,
        api_base: c.channels.discord.apiBase || "https://discord.com/api/v10",
      },
      telegram: {
        enabled: c.channels.telegram.enabled,
        bot_token: c.channels.telegram.botToken,
        default_chat_id: c.channels.telegram.defaultTarget,
        api_base: c.channels.telegram.apiBase || "https://api.telegram.org",
      },
    },
    timezoneOffsetMin: c.timezoneOffsetMin,
    agentLoopDefaultMaxTurns: c.agentLoopMaxTurns,
    taskDefaultMaxTurns: c.taskLoopMaxTurns,
    phi4RuntimeEnabled: c.phi4.runtimeEnabled,
    phi4RuntimeEngine: c.phi4.runtimeEngine,
    phi4RuntimeImage: c.phi4.runtimeImage,
    phi4RuntimeContainer: c.phi4.runtimeContainer,
    phi4RuntimePort: c.phi4.runtimePort,
    phi4RuntimeModel: c.phi4.model,
    phi4RuntimePullModel: c.phi4.pullModel,
    phi4RuntimeAutoStop: c.phi4.autoStop,
    phi4RuntimeGpuEnabled: c.phi4.gpuEnabled,
    phi4RuntimeGpuArgs: c.phi4.gpuArgs,
    channelPollIntervalMs: c.channel.pollIntervalMs,
    channelReadLimit: c.channel.readLimit,
    dashboardEnabled: c.dashboard.enabled,
    dashboardPort: c.dashboard.port,
    dashboardHost: c.dashboard.host,
    dataDir: c.dataDir,
    dashboardAssetsDir: c.dashboard.assetsDir,
    templateSourceDir: c.templateSourceDir,
  };
}

/** 활성화된 첫 번째 채널을 기본 프로바이더로 결정. */
function resolve_primary_provider(c: AppConfig): ChannelProvider {
  if (c.channels.slack.enabled) return "slack";
  if (c.channels.telegram.enabled) return "telegram";
  if (c.channels.discord.enabled) return "discord";
  return "slack";
}
