import { z } from "zod";

function env_bool(key: string, fallback: boolean): boolean {
  const v = String(process.env[key] || "").trim().toLowerCase();
  if (!v) return fallback;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function env_str(key: string, fallback: string): string {
  return String(process.env[key] || "").trim() || fallback;
}

function env_num(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function env_str_list(key: string): string[] {
  return String(process.env[key] || "").split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

const ChannelStreamingSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number().min(500),
  minChars: z.number().min(16),
  suppressFinalAfterStream: z.boolean(),
});

const ChannelDispatchSchema = z.object({
  inlineRetries: z.number().min(0),
  retryMax: z.number().min(0),
  retryBaseMs: z.number().min(100),
  retryMaxMs: z.number().min(100),
  retryJitterMs: z.number().min(0),
  dlqEnabled: z.boolean(),
  dlqPath: z.string(),
});

const ChannelDedupeSchema = z.object({
  ttlMs: z.number().min(1_000),
  maxSize: z.number().min(500),
});

const ChannelSchema = z.object({
  debug: z.boolean(),
  autoReply: z.boolean(),
  defaultAlias: z.string().min(1),
  pollIntervalMs: z.number().min(500),
  readLimit: z.number().min(1).max(100),
  readAckEnabled: z.boolean(),
  readAckReaction: z.string().min(1),
  statusNoticeEnabled: z.boolean(),
  progressPulseEnabled: z.boolean(),
  groupingEnabled: z.boolean(),
  groupingWindowMs: z.number().min(500),
  groupingMaxMessages: z.number().min(2),
  seenTtlMs: z.number().min(60_000),
  seenMaxSize: z.number().min(2_000),
  inboundConcurrency: z.number().min(1),
  sessionHistoryMaxAgeMs: z.number().min(0),
  approvalReactionEnabled: z.boolean(),
  controlReactionEnabled: z.boolean(),
  reactionActionTtlMs: z.number().min(60_000),
  streaming: ChannelStreamingSchema,
  dispatch: ChannelDispatchSchema,
  outboundDedupe: ChannelDedupeSchema,
});

const ProviderChannelSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string(),
  defaultTarget: z.string(),
  apiBase: z.string().optional(),
});

const Phi4Schema = z.object({
  runtimeEnabled: z.boolean(),
  runtimeEngine: z.enum(["auto", "native", "docker", "podman"]),
  runtimeImage: z.string(),
  runtimeContainer: z.string(),
  runtimePort: z.number().int().positive(),
  model: z.string(),
  pullModel: z.boolean(),
  autoStop: z.boolean(),
  gpuEnabled: z.boolean(),
  gpuArgs: z.array(z.string()),
  apiBase: z.string(),
});

const OrchestrationSchema = z.object({
  maxToolResultChars: z.number().min(50),
});

const DashboardSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().positive(),
  host: z.string(),
  assetsDir: z.string(),
});

export const AppConfigSchema = z.object({
  timezoneOffsetMin: z.number(),
  agentLoopMaxTurns: z.number().min(1),
  taskLoopMaxTurns: z.number().min(1),
  dataDir: z.string(),
  templateSourceDir: z.string(),
  workspaceDir: z.string(),
  channels: z.object({
    slack: ProviderChannelSchema,
    discord: ProviderChannelSchema,
    telegram: ProviderChannelSchema,
  }),
  channel: ChannelSchema,
  orchestration: OrchestrationSchema,
  phi4: Phi4Schema,
  dashboard: DashboardSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function load_config_from_env(): AppConfig {
  const workspace = process.cwd();
  const dataDir = env_str("ORCH_DATA_DIR", "") || `${workspace}/runtime`;
  const phi4Port = env_num("PHI4_RUNTIME_PORT", 11434);

  const raw = {
    timezoneOffsetMin: env_num("TZ_OFFSET_MIN", 540),
    agentLoopMaxTurns: env_num("AGENT_LOOP_MAX_TURNS", 30),
    taskLoopMaxTurns: env_num("TASK_LOOP_MAX_TURNS", 40),
    dataDir,
    templateSourceDir: env_str("TEMPLATE_SOURCE_DIR", ""),
    workspaceDir: workspace,
    channels: {
      slack: {
        enabled: env_bool("SLACK_ENABLED", true),
        botToken: env_str("SLACK_BOT_TOKEN", ""),
        defaultTarget: env_str("SLACK_DEFAULT_CHANNEL", ""),
      },
      discord: {
        enabled: env_bool("DISCORD_ENABLED", true),
        botToken: env_str("DISCORD_BOT_TOKEN", ""),
        defaultTarget: env_str("DISCORD_DEFAULT_CHANNEL", ""),
        apiBase: env_str("DISCORD_API_BASE", "https://discord.com/api/v10"),
      },
      telegram: {
        enabled: env_bool("TELEGRAM_ENABLED", true),
        botToken: env_str("TELEGRAM_BOT_TOKEN", ""),
        defaultTarget: env_str("TELEGRAM_DEFAULT_CHAT_ID", ""),
        apiBase: env_str("TELEGRAM_API_BASE", "https://api.telegram.org"),
      },
    },
    channel: {
      debug: env_bool("CHANNEL_DEBUG", false),
      autoReply: env_bool("CHANNEL_AUTO_REPLY", true),
      defaultAlias: env_str("DEFAULT_AGENT_ALIAS", "assistant"),
      pollIntervalMs: Math.max(500, env_num("CHANNEL_POLL_INTERVAL_MS", 2000)),
      readLimit: Math.max(1, Math.min(100, env_num("CHANNEL_READ_LIMIT", 30))),
      readAckEnabled: env_bool("READ_ACK_ENABLED", true),
      readAckReaction: env_str("READ_ACK_REACTION", "eyes"),
      statusNoticeEnabled: env_bool("CHANNEL_STATUS_NOTICE", false),
      progressPulseEnabled: env_bool("CHANNEL_PROGRESS_PULSE", false),
      groupingEnabled: env_bool("CHANNEL_GROUPING_ENABLED", false),
      groupingWindowMs: Math.max(500, env_num("CHANNEL_GROUPING_WINDOW_MS", 3500)),
      groupingMaxMessages: Math.max(2, env_num("CHANNEL_GROUPING_MAX_MESSAGES", 8)),
      seenTtlMs: Math.max(60_000, env_num("CHANNEL_SEEN_TTL_MS", 86_400_000)),
      seenMaxSize: Math.max(2_000, env_num("CHANNEL_SEEN_MAX_SIZE", 50_000)),
      inboundConcurrency: Math.max(1, env_num("CHANNEL_INBOUND_CONCURRENCY", 4)),
      sessionHistoryMaxAgeMs: Math.max(0, env_num("CHANNEL_SESSION_HISTORY_MAX_AGE_MS", 1_800_000)),
      approvalReactionEnabled: env_bool("APPROVAL_REACTION_ENABLED", true),
      controlReactionEnabled: env_bool("CONTROL_REACTION_ENABLED", true),
      reactionActionTtlMs: Math.max(60_000, env_num("REACTION_ACTION_TTL_MS", 86_400_000)),
      streaming: {
        enabled: env_bool("CHANNEL_STREAMING_ENABLED", true),
        intervalMs: Math.max(500, env_num("CHANNEL_STREAMING_INTERVAL_MS", 1400)),
        minChars: Math.max(16, env_num("CHANNEL_STREAMING_MIN_CHARS", 48)),
        suppressFinalAfterStream: env_bool("CHANNEL_SUPPRESS_FINAL_AFTER_STREAM", true),
      },
      dispatch: {
        inlineRetries: Math.max(0, env_num("CHANNEL_MANAGER_INLINE_RETRIES", 0)),
        retryMax: Math.max(0, env_num("CHANNEL_DISPATCH_RETRY_MAX", 3)),
        retryBaseMs: Math.max(100, env_num("CHANNEL_DISPATCH_RETRY_BASE_MS", 700)),
        retryMaxMs: Math.max(100, env_num("CHANNEL_DISPATCH_RETRY_MAX_MS", 25_000)),
        retryJitterMs: Math.max(0, env_num("CHANNEL_DISPATCH_RETRY_JITTER_MS", 250)),
        dlqEnabled: env_bool("CHANNEL_DISPATCH_DLQ_ENABLED", true),
        dlqPath: env_str("CHANNEL_DISPATCH_DLQ_PATH", `${dataDir}/dlq/dlq.db`),
      },
      outboundDedupe: {
        ttlMs: Math.max(1_000, env_num("CHANNEL_OUTBOUND_DEDUPE_TTL_MS", 25_000)),
        maxSize: Math.max(500, env_num("CHANNEL_OUTBOUND_DEDUPE_MAX_SIZE", 20_000)),
      },
    },
    orchestration: {
      maxToolResultChars: Math.max(50, env_num("ORCHESTRATION_MAX_TOOL_RESULT_CHARS", 500)),
    },
    phi4: {
      runtimeEnabled: env_bool("PHI4_RUNTIME_ENABLED", false),
      runtimeEngine: env_str("PHI4_RUNTIME_ENGINE", "auto") as "auto" | "docker" | "podman" | "native",
      runtimeImage: env_str("PHI4_RUNTIME_IMAGE", "ollama/ollama:latest"),
      runtimeContainer: env_str("PHI4_RUNTIME_CONTAINER", "orchestrator-phi4"),
      runtimePort: phi4Port,
      model: env_str("PHI4_MODEL", "phi4"),
      pullModel: env_bool("PHI4_RUNTIME_PULL_MODEL", true),
      autoStop: env_bool("PHI4_RUNTIME_AUTO_STOP", false),
      gpuEnabled: env_bool("PHI4_RUNTIME_GPU_ENABLED", true),
      gpuArgs: env_str_list("PHI4_RUNTIME_GPU_ARGS"),
      apiBase: env_str("PHI4_API_BASE", `http://127.0.0.1:${phi4Port}/v1`),
    },
    dashboard: {
      enabled: env_bool("DASHBOARD_ENABLED", true),
      port: env_num("DASHBOARD_PORT", 3789),
      host: env_str("DASHBOARD_HOST", "127.0.0.1"),
      assetsDir: env_str("DASHBOARD_ASSETS_DIR", ""),
    },
  };

  return AppConfigSchema.parse(raw);
}
