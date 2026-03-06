import { z } from "zod";

const ChannelStreamingSchema = z.object({
  enabled: z.boolean(),
  /** 스트리밍 모드: live(부분 텍스트 축적 편집), status(상태 인디케이터 순환 → 최종 답변 새 메시지). */
  mode: z.enum(["live", "status"]).default("live"),
  intervalMs: z.number().min(500),
  minChars: z.number().min(16),
  suppressFinalAfterStream: z.boolean(),
  /** 도구 사용 표시: count(상단 카운트), inline(스트림 주입), separate(별도 메시지). */
  toolDisplay: z.enum(["count", "inline", "separate"]),
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

const OrchestratorLlmSchema = z.object({
  enabled: z.boolean(),
  engine: z.enum(["auto", "native", "docker", "podman"]),
  image: z.string(),
  container: z.string(),
  port: z.number().int().positive(),
  model: z.string(),
  pullModel: z.boolean(),
  autoStop: z.boolean(),
  gpuEnabled: z.boolean(),
  gpuArgs: z.array(z.string()),
  apiBase: z.string(),
});

const OrchestrationSchema = z.object({
  maxToolResultChars: z.number().min(50),
  orchestratorMaxTokens: z.number().min(256),
  orchestratorProvider: z.string().default(""),
  executorProvider: z.string().default(""),
});

const DashboardSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().positive(),
  host: z.string(),
  portFallback: z.boolean(),
  /** 외부 공개 URL (예: https://dashboard.example.com). OAuth redirect_uri 기준으로 사용됨. */
  publicUrl: z.string().optional(),
});

const CliSchema = z.object({
  maxCaptureChars: z.number().min(10_000),
  maxStreamStateChars: z.number().min(8_000),
});

const McpSchema = z.object({
  enabled: z.boolean(),
  enableAllProject: z.boolean().optional(),
  startupTimeoutSec: z.number().min(0),
  serversFile: z.string(),
  serversJson: z.string(),
  serverNames: z.string(),
});

const LoggingSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
});

const OpsSchema = z.object({
  healthLogEnabled: z.boolean(),
  healthLogOnChange: z.boolean(),
  bridgePumpEnabled: z.boolean(),
});

export const AppConfigSchema = z.object({
  agentLoopMaxTurns: z.number().min(1),
  taskLoopMaxTurns: z.number().min(1),
  dataDir: z.string(),
  workspaceDir: z.string(),
  channel: ChannelSchema,
  orchestration: OrchestrationSchema,
  orchestratorLlm: OrchestratorLlmSchema,
  dashboard: DashboardSchema,
  cli: CliSchema,
  mcp: McpSchema,
  logging: LoggingSchema,
  ops: OpsSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** 하드코딩 기본값으로 AppConfig 생성. 유일한 env 의존: ORCH_DATA_DIR (부트스트랩). */
export function get_config_defaults(): AppConfig {
  const data_dir = "./runtime";
  return AppConfigSchema.parse({
    agentLoopMaxTurns: 20,
    taskLoopMaxTurns: 50,
    dataDir: data_dir,
    workspaceDir: ".",
    channel: {
      debug: false,
      autoReply: true,
      defaultAlias: "assistant",
      pollIntervalMs: 2000,
      readLimit: 30,
      readAckEnabled: true,
      readAckReaction: "eyes",
      seenTtlMs: 86_400_000,
      seenMaxSize: 50_000,
      inboundConcurrency: 4,
      sessionHistoryMaxAgeMs: 1_800_000,
      approvalReactionEnabled: true,
      controlReactionEnabled: true,
      reactionActionTtlMs: 86_400_000,
      streaming: {
        enabled: true,
        mode: "status" as const,
        intervalMs: 1400,
        minChars: 48,
        suppressFinalAfterStream: false,
        toolDisplay: "count" as const,
      },
      dispatch: {
        inlineRetries: 0,
        retryMax: 3,
        retryBaseMs: 700,
        retryMaxMs: 25_000,
        retryJitterMs: 250,
        dlqEnabled: true,
        dlqPath: `${data_dir}/dlq/dlq.db`,
      },
      outboundDedupe: {
        ttlMs: 25_000,
        maxSize: 20_000,
      },
    },
    orchestration: {
      maxToolResultChars: 500,
      orchestratorMaxTokens: 4096,
      orchestratorProvider: "",
      executorProvider: "",
    },
    orchestratorLlm: {
      enabled: false,
      engine: "auto",
      image: "ollama/ollama:latest",
      container: "orchestrator-llm",
      port: 11434,
      model: "qwen3:4b",
      pullModel: true,
      autoStop: false,
      gpuEnabled: true,
      gpuArgs: [],
      apiBase: "http://ollama:11434/v1",
    },
    dashboard: {
      enabled: true,
      port: 4200,
      host: "0.0.0.0",
      portFallback: false,
    },
    cli: {
      maxCaptureChars: 500_000,
      maxStreamStateChars: 200_000,
    },
    mcp: {
      enabled: true,
      startupTimeoutSec: 0,
      serversFile: "",
      serversJson: "",
      serverNames: "",
    },
    logging: {
      level: "info",
    },
    ops: {
      healthLogEnabled: false,
      healthLogOnChange: true,
      bridgePumpEnabled: false,
    },
  });
}

/**
 * ConfigStore 오버라이드와 SecretVault 민감 값을 기본값에 병합.
 * 우선순위: vault(민감) > store 오버라이드 > 하드코딩 기본값
 */
export async function load_config_merged(
  store: import("./config-store.js").ConfigStore,
): Promise<AppConfig> {
  const defaults = get_config_defaults();
  const overrides = store.get_all_overrides();
  const merged = structuredClone(defaults) as Record<string, unknown>;

  for (const { path, value } of overrides) {
    set_nested(merged, path, value);
  }

  const { get_sensitive_fields } = await import("./config-meta.js");
  for (const field of get_sensitive_fields()) {
    const vault_value = await store.get_sensitive(field.path);
    if (vault_value) {
      set_nested(merged, field.path, vault_value);
    }
  }

  return AppConfigSchema.parse(merged);
}

/** dot-path로 중첩 객체에 값 설정 */
export function set_nested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined || typeof current[keys[i]] !== "object") {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
