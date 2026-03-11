import { z } from "zod";
import { resolve, isAbsolute } from "node:path";

const ChannelStreamingSchema = z.object({
  enabled: z.boolean(),
  /**
   * 스트리밍 모드.
   * - live: 부분 텍스트를 메시지 편집으로 축적 (실시간 타이핑 효과)
   * - status: 상태 인디케이터 순환 후 최종 답변을 새 메시지로 전송
   * 기본 정책: status + suppressFinalAfterStream=true로 중복 없는 UX 제공.
   */
  mode: z.enum(["live", "status"]).default("live"),
  intervalMs: z.number().min(500),
  minChars: z.number().min(16),
  /**
   * 강제 플러시 임계값. 버퍼에 이 글자수 이상 쌓이면 intervalMs 경과 전이라도 즉시 플러시.
   * 0이면 비활성 (intervalMs/minChars 조건만 적용). 기본 300.
   */
  coalesceMaxChars: z.number().min(0).default(300),
  /** status 모드에서 스트리밍 후 최종 답변 별도 전송을 억제. true면 스트리밍 결과가 곧 최종 답변. */
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

const ChannelGroupingSchema = z.object({
  enabled: z.boolean(),
  /** 같은 chat_id로 오는 메시지를 묶을 시간 창 (ms). */
  windowMs: z.number().min(100).max(10_000),
  /** 한 그룹에 합칠 수 있는 최대 메시지 수. 초과 시 즉시 플러시. */
  maxMessages: z.number().min(2).max(20),
});

const ChannelSchema = z.object({
  debug: z.boolean(),
  autoReply: z.boolean(),
  defaultAlias: z.string().min(1),
  pollIntervalMs: z.number().min(500),
  /** 유휴 시 최대 폴링 간격 (ms). 메시지 없을 때 1.5× 지수 백오프 상한. 0 = 비활성 (고정 간격). */
  pollMaxIntervalMs: z.number().min(0).default(0),
  readLimit: z.number().min(1).max(100),
  readAckEnabled: z.boolean(),
  readAckReaction: z.string().min(1),
  seenTtlMs: z.number().min(60_000),
  seenMaxSize: z.number().min(2_000),
  inboundConcurrency: z.number().min(1),
  /** 세션별 인바운드 대기 한도. 0 = 무제한. 초과 시 queueDropPolicy 적용. */
  queueCapPerLane: z.number().min(0).default(20),
  /** 한도 초과 시 정책. old: 오래된 항목 제거, new: 새 항목 거부. */
  queueDropPolicy: z.enum(["old", "new"]).default("old"),
  /** 인바운드 디바운싱: 같은 채팅의 빠른 연속 메시지를 배치로 묶어 처리. */
  inboundDebounce: z.object({
    enabled: z.boolean().default(false),
    /** 첫 메시지 도착 후 플러시까지 대기 시간 (ms). */
    windowMs: z.number().min(50).max(5_000).default(400),
    /** 이 수에 도달하면 windowMs 경과 전 즉시 플러시. */
    maxMessages: z.number().min(2).max(20).default(5),
  }),
  /** 유휴 인바운드 레인 정리 주기 (ms). 0 = 비활성. 메모리 누수 방지. */
  sessionLanePruneIntervalMs: z.number().min(0).default(300_000),
  /** 장기 실행 중인 run을 자동 중단할 TTL (ms). 0 = 비활성. */
  staleRunTimeoutMs: z.number().min(0).default(7_200_000),
  sessionHistoryMaxAgeMs: z.number().min(0),
  approvalReactionEnabled: z.boolean(),
  controlReactionEnabled: z.boolean(),
  reactionActionTtlMs: z.number().min(60_000),
  streaming: ChannelStreamingSchema,
  dispatch: ChannelDispatchSchema,
  outboundDedupe: ChannelDedupeSchema,
  grouping: ChannelGroupingSchema,
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

const EmbeddingSchema = z.object({
  /** 사용할 임베딩 프로바이더 인스턴스 ID. Providers 페이지에서 model_purpose=embedding으로 등록한 인스턴스. 빈 문자열이면 자동 선택 (첫 번째 활성 embedding 프로바이더). */
  instanceId: z.string().default(""),
  /** 임베딩 모델 오버라이드. 빈 문자열이면 인스턴스 기본 모델 사용. */
  model: z.string().default(""),
  /** 이미지(멀티모달) 임베딩 프로바이더 인스턴스 ID. 빈 문자열이면 이미지 임베딩 비활성화. */
  imageInstanceId: z.string().default(""),
  /** 이미지 임베딩 모델 오버라이드. 빈 문자열이면 인스턴스 기본 모델 사용. */
  imageModel: z.string().default(""),
});

const OrchestrationSchema = z.object({
  maxToolResultChars: z.number().min(50),
  orchestratorMaxTokens: z.number().min(256),
  /** 오케스트레이터 프로바이더 인스턴스 ID (Providers 페이지에서 등록). */
  orchestratorProvider: z.string().default(""),
  /** 오케스트레이터 모델 오버라이드. 빈 문자열이면 인스턴스/프로바이더 기본 모델. */
  orchestratorModel: z.string().default(""),
  /** 실행기 프로바이더 인스턴스 ID (Providers 페이지에서 등록). */
  executorProvider: z.string().default(""),
  /** 실행기 모델 오버라이드. 빈 문자열이면 인스턴스/프로바이더 기본 모델. */
  executorModel: z.string().default(""),
});

const DashboardSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().positive(),
  host: z.string(),
  portFallback: z.boolean(),
  /** 외부 공개 URL (예: https://dashboard.example.com). OAuth redirect_uri 기준으로 사용됨. */
  publicUrl: z.string().optional(),
  /** /hooks/* 엔드포인트 인증 토큰. 설정 시 Authorization: Bearer <token> 필수. */
  webhookSecret: z.string().optional(),
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

const BusRedisSchema = z.object({
  url: z.string(),
  keyPrefix: z.string(),
  blockMs: z.number().int().positive(),
  claimIdleMs: z.number().int().positive(),
  streamMaxlen: z.object({
    inbound: z.number().int().positive(),
    outbound: z.number().int().positive(),
    progress: z.number().int().positive(),
  }),
});

const BusSchema = z.object({
  backend: z.enum(["memory", "redis"]),
  redis: BusRedisSchema,
});

const MemorySchema = z.object({
  consolidation: z.object({
    enabled: z.boolean(),
    trigger: z.enum(["idle", "cron"]),
    /** idle trigger: 세션 비활성 후 압축까지 대기 시간 (ms). */
    idleAfterMs: z.number().int().min(60_000),
    /** cron trigger: 압축 실행 주기 (ms). 기본 24시간. */
    intervalMs: z.number().int().min(60_000),
    /** 압축 대상 daily memory 윈도우 (일). */
    windowDays: z.number().int().min(1).max(365),
    /** 압축 후 사용된 daily 엔트리 삭제 여부. */
    archiveUsed: z.boolean(),
  }),
  /** daily memory 중 최근 N일을 system prompt에 자동 주입. 0이면 비활성. */
  dailyInjectionDays: z.number().int().min(0).max(30),
  /** 자동 주입 시 최대 글자 수 상한. 초과 시 최근 엔트리부터 우선 포함. */
  dailyInjectionMaxChars: z.number().int().min(0),
});

const OpsSchema = z.object({
  healthLogEnabled: z.boolean(),
  healthLogOnChange: z.boolean(),
  bridgePumpEnabled: z.boolean(),
});

export const AppConfigSchema = z.object({
  agentLoopMaxTurns: z.number().min(1),
  taskLoopMaxTurns: z.number().min(1),
  dataDir: z.string().transform((p) => isAbsolute(p) ? p : resolve(p)),
  workspaceDir: z.string().transform((p) => isAbsolute(p) ? p : resolve(p)),
  channel: ChannelSchema,
  orchestration: OrchestrationSchema,
  orchestratorLlm: OrchestratorLlmSchema,
  embedding: EmbeddingSchema,
  dashboard: DashboardSchema,
  cli: CliSchema,
  mcp: McpSchema,
  bus: BusSchema,
  memory: MemorySchema,
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
      pollMaxIntervalMs: 0,
      readLimit: 30,
      readAckEnabled: true,
      readAckReaction: "eyes",
      seenTtlMs: 86_400_000,
      seenMaxSize: 50_000,
      inboundConcurrency: 4,
      inboundDebounce: { enabled: false, windowMs: 400, maxMessages: 5 },
      sessionLanePruneIntervalMs: 300_000,
      staleRunTimeoutMs: 7_200_000,
      sessionHistoryMaxAgeMs: 1_800_000,
      approvalReactionEnabled: true,
      controlReactionEnabled: true,
      reactionActionTtlMs: 86_400_000,
      streaming: {
        enabled: true,
        mode: "status" as const,
        intervalMs: 1400,
        minChars: 48,
        suppressFinalAfterStream: true,
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
      grouping: {
        enabled: false,
        windowMs: 800,
        maxMessages: 5,
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
    embedding: {
      instanceId: "",
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
    bus: {
      backend: (process.env.BUS_BACKEND || "memory") as "memory" | "redis",
      redis: {
        url: process.env.BUS_REDIS_URL || "redis://redis:6379",
        keyPrefix: "sf:bus:",
        blockMs: 5_000,
        claimIdleMs: 30_000,
        streamMaxlen: {
          inbound: 10_000,
          outbound: 10_000,
          progress: 2_000,
        },
      },
    },
    memory: {
      consolidation: {
        enabled: false,
        trigger: "idle" as const,
        idleAfterMs: 300_000,
        intervalMs: 86_400_000,
        windowDays: 7,
        archiveUsed: true,
      },
      dailyInjectionDays: 1,
      dailyInjectionMaxChars: 4_000,
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
