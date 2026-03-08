/**
 * 설정 필드 메타데이터 — 각 필드의 섹션, 타입, 민감도, 환경변수 매핑.
 * Settings UI와 config-store에서 활용.
 */

export type FieldType = "string" | "number" | "boolean" | "select";

export interface ConfigFieldMeta {
  /** 설정 경로 (dot notation): "channels.slack.botToken" */
  path: string;
  /** UI 라벨 */
  label: string;
  /** 논리적 섹션 */
  section: ConfigSection;
  /** 입력 타입 */
  type: FieldType;
  /** 환경변수 키 */
  env_key: string;
  /** 기본값 */
  default_value: unknown;
  /** 민감 설정 (SecretVault 암호화) */
  sensitive: boolean;
  /** select 타입의 옵션 목록 */
  options?: string[];
  /** 변경 후 재시작 필요 */
  restart_required: boolean;
  /** 필드 설명 */
  description?: string;
}

export type ConfigSection =
  | "general"
  | "channel"
  | "channel.streaming"
  | "channel.dispatch"
  | "channel.dedupe"
  | "channel.grouping"
  | "memory.consolidation"
  | "orchestration"
  | "dashboard"
  | "cli"
  | "mcp"
  | "logging"
  | "orchestratorLlm"
  | "embedding"
  | "ops";

export const SECTION_LABELS: Record<ConfigSection, string> = {
  general: "General",
  channel: "Channel Behavior",
  "channel.streaming": "Streaming",
  "channel.dispatch": "Dispatch & Retry",
  "channel.dedupe": "Outbound Dedupe",
  "channel.grouping": "Message Grouping",
  "memory.consolidation": "Memory & Consolidation",
  orchestration: "Orchestration",
  dashboard: "Dashboard",
  cli: "CLI Providers",
  mcp: "MCP Servers",
  logging: "Logging",
  orchestratorLlm: "Orchestrator LLM",
  embedding: "Embedding",
  ops: "Operations",
};

export const SECTION_ORDER: ConfigSection[] = [
  "general",
  "channel",
  "channel.streaming",
  "channel.grouping",
  "channel.dispatch",
  "channel.dedupe",
  "memory.consolidation",
  "orchestration",
  "dashboard",
  "cli",
  "mcp",
  "orchestratorLlm",
  "embedding",
  "logging",
  "ops",
];

/** 전체 설정 필드 메타데이터 목록 */
export const CONFIG_FIELDS: ConfigFieldMeta[] = [
  // ── General ──
  { path: "agentLoopMaxTurns", label: "Agent Loop Max Turns", section: "general", type: "number", env_key: "AGENT_LOOP_MAX_TURNS", default_value: 20, sensitive: false, restart_required: false, description: "Maximum turns per agent conversation before auto-stop" },
  { path: "taskLoopMaxTurns", label: "Task Loop Max Turns", section: "general", type: "number", env_key: "TASK_LOOP_MAX_TURNS", default_value: 50, sensitive: false, restart_required: false, description: "Maximum turns for long-running background tasks" },

  // ── Channel Behavior ──
  { path: "channel.debug", label: "Debug Mode", section: "channel", type: "boolean", env_key: "CHANNEL_DEBUG", default_value: false, sensitive: false, restart_required: false, description: "Log detailed channel processing information" },
  { path: "channel.autoReply", label: "Auto Reply", section: "channel", type: "boolean", env_key: "CHANNEL_AUTO_REPLY", default_value: true, sensitive: false, restart_required: false, description: "Automatically process and reply to incoming messages" },
  { path: "channel.defaultAlias", label: "Default Agent Alias", section: "channel", type: "string", env_key: "DEFAULT_AGENT_ALIAS", default_value: "assistant", sensitive: false, restart_required: false, description: "Agent alias used when no specific agent is mentioned" },
  { path: "channel.pollIntervalMs", label: "Poll Interval (ms)", section: "channel", type: "number", env_key: "CHANNEL_POLL_INTERVAL_MS", default_value: 2000, sensitive: false, restart_required: false, description: "How often to check channels for new messages" },
  { path: "channel.readLimit", label: "Read Limit", section: "channel", type: "number", env_key: "CHANNEL_READ_LIMIT", default_value: 30, sensitive: false, restart_required: false, description: "Max messages to fetch per channel per poll cycle" },
  { path: "channel.readAckEnabled", label: "Read Ack Enabled", section: "channel", type: "boolean", env_key: "READ_ACK_ENABLED", default_value: true, sensitive: false, restart_required: false, description: "Add a reaction to confirm message was received" },
  { path: "channel.readAckReaction", label: "Read Ack Reaction", section: "channel", type: "string", env_key: "READ_ACK_REACTION", default_value: "eyes", sensitive: false, restart_required: false, description: "Emoji reaction to add when a message is read" },
  { path: "channel.seenTtlMs", label: "Seen TTL (ms)", section: "channel", type: "number", env_key: "CHANNEL_SEEN_TTL_MS", default_value: 86_400_000, sensitive: false, restart_required: false, description: "How long to remember processed message IDs (dedup window)" },
  { path: "channel.seenMaxSize", label: "Seen Max Size", section: "channel", type: "number", env_key: "CHANNEL_SEEN_MAX_SIZE", default_value: 50_000, sensitive: false, restart_required: false, description: "Maximum entries in the seen-messages cache" },
  { path: "channel.inboundConcurrency", label: "Inbound Concurrency", section: "channel", type: "number", env_key: "CHANNEL_INBOUND_CONCURRENCY", default_value: 4, sensitive: false, restart_required: false, description: "Max concurrent inbound messages being processed" },
  { path: "channel.sessionHistoryMaxAgeMs", label: "Session History Max Age (ms)", section: "channel", type: "number", env_key: "CHANNEL_SESSION_HISTORY_MAX_AGE_MS", default_value: 1_800_000, sensitive: false, restart_required: false, description: "Conversation context window; older messages are pruned" },
  { path: "channel.approvalReactionEnabled", label: "Approval Reaction", section: "channel", type: "boolean", env_key: "APPROVAL_REACTION_ENABLED", default_value: true, sensitive: false, restart_required: false, description: "Allow users to approve actions via emoji reactions" },
  { path: "channel.controlReactionEnabled", label: "Control Reaction", section: "channel", type: "boolean", env_key: "CONTROL_REACTION_ENABLED", default_value: true, sensitive: false, restart_required: false, description: "Allow stop/cancel actions via emoji reactions" },
  { path: "channel.reactionActionTtlMs", label: "Reaction Action TTL (ms)", section: "channel", type: "number", env_key: "REACTION_ACTION_TTL_MS", default_value: 86_400_000, sensitive: false, restart_required: false, description: "How long reaction-based actions remain valid" },

  // ── Streaming ──
  { path: "channel.streaming.enabled", label: "Enabled", section: "channel.streaming", type: "boolean", env_key: "CHANNEL_STREAMING_ENABLED", default_value: true, sensitive: false, restart_required: false, description: "Stream partial responses while agent is thinking" },
  { path: "channel.streaming.mode", label: "Mode", section: "channel.streaming", type: "string", env_key: "CHANNEL_STREAMING_MODE", default_value: "status", sensitive: false, restart_required: false, description: "live: stream partial text, status: show status indicator cycling then final response as new message" },
  { path: "channel.streaming.intervalMs", label: "Interval (ms)", section: "channel.streaming", type: "number", env_key: "CHANNEL_STREAMING_INTERVAL_MS", default_value: 1400, sensitive: false, restart_required: false, description: "How often to flush buffered text to the channel" },
  { path: "channel.streaming.minChars", label: "Min Chars", section: "channel.streaming", type: "number", env_key: "CHANNEL_STREAMING_MIN_CHARS", default_value: 48, sensitive: false, restart_required: false, description: "Minimum characters before sending a stream update" },
  { path: "channel.streaming.suppressFinalAfterStream", label: "Suppress Final After Stream", section: "channel.streaming", type: "boolean", env_key: "CHANNEL_SUPPRESS_FINAL_AFTER_STREAM", default_value: true, sensitive: false, restart_required: false, description: "Skip sending the final message if already streamed" },

  // ── Dispatch ──
  { path: "channel.dispatch.inlineRetries", label: "Inline Retries", section: "channel.dispatch", type: "number", env_key: "CHANNEL_MANAGER_INLINE_RETRIES", default_value: 0, sensitive: false, restart_required: false, description: "Immediate retries before entering exponential backoff" },
  { path: "channel.dispatch.retryMax", label: "Retry Max", section: "channel.dispatch", type: "number", env_key: "CHANNEL_DISPATCH_RETRY_MAX", default_value: 3, sensitive: false, restart_required: false, description: "Maximum retry attempts with exponential backoff" },
  { path: "channel.dispatch.retryBaseMs", label: "Retry Base (ms)", section: "channel.dispatch", type: "number", env_key: "CHANNEL_DISPATCH_RETRY_BASE_MS", default_value: 700, sensitive: false, restart_required: false, description: "Base delay for exponential backoff calculation" },
  { path: "channel.dispatch.retryMaxMs", label: "Retry Max (ms)", section: "channel.dispatch", type: "number", env_key: "CHANNEL_DISPATCH_RETRY_MAX_MS", default_value: 25_000, sensitive: false, restart_required: false, description: "Upper bound for retry delay (cap)" },
  { path: "channel.dispatch.retryJitterMs", label: "Retry Jitter (ms)", section: "channel.dispatch", type: "number", env_key: "CHANNEL_DISPATCH_RETRY_JITTER_MS", default_value: 250, sensitive: false, restart_required: false, description: "Random jitter added to retry delays to avoid thundering herd" },
  { path: "channel.dispatch.dlqEnabled", label: "DLQ Enabled", section: "channel.dispatch", type: "boolean", env_key: "CHANNEL_DISPATCH_DLQ_ENABLED", default_value: true, sensitive: false, restart_required: false, description: "Save permanently failed messages to Dead Letter Queue" },
  { path: "channel.dispatch.dlqPath", label: "DLQ Path", section: "channel.dispatch", type: "string", env_key: "CHANNEL_DISPATCH_DLQ_PATH", default_value: "", sensitive: false, restart_required: true, description: "SQLite file path for DLQ storage" },

  // ── Grouping ──
  { path: "channel.grouping.enabled", label: "Enabled", section: "channel.grouping", type: "boolean", env_key: "CHANNEL_GROUPING_ENABLED", default_value: false, sensitive: false, restart_required: false, description: "Combine multiple rapid responses into a single message to reduce spam" },
  { path: "channel.grouping.windowMs", label: "Window (ms)", section: "channel.grouping", type: "number", env_key: "CHANNEL_GROUPING_WINDOW_MS", default_value: 800, sensitive: false, restart_required: false, description: "Time window to collect messages before grouping and sending" },
  { path: "channel.grouping.maxMessages", label: "Max Messages", section: "channel.grouping", type: "number", env_key: "CHANNEL_GROUPING_MAX_MESSAGES", default_value: 5, sensitive: false, restart_required: false, description: "Maximum messages to group; flush immediately when reached" },

  // ── Dedupe ──
  { path: "channel.outboundDedupe.ttlMs", label: "TTL (ms)", section: "channel.dedupe", type: "number", env_key: "CHANNEL_OUTBOUND_DEDUPE_TTL_MS", default_value: 25_000, sensitive: false, restart_required: false, description: "Window for detecting duplicate outbound messages" },
  { path: "channel.outboundDedupe.maxSize", label: "Max Size", section: "channel.dedupe", type: "number", env_key: "CHANNEL_OUTBOUND_DEDUPE_MAX_SIZE", default_value: 20_000, sensitive: false, restart_required: false, description: "Maximum fingerprints stored in dedupe cache" },

  // ── Memory & Consolidation ──
  { path: "memory.consolidation.enabled", label: "Consolidation Enabled", section: "memory.consolidation", type: "boolean", env_key: "", default_value: false, sensitive: false, restart_required: false, description: "Automatically compress conversation history into long-term memory" },
  { path: "memory.consolidation.trigger", label: "Trigger Mode", section: "memory.consolidation", type: "select", env_key: "", default_value: "idle", sensitive: false, restart_required: false, options: ["idle", "cron"], description: "idle: run after session goes quiet; cron: run on fixed schedule" },
  { path: "memory.consolidation.idleAfterMs", label: "Idle After (ms)", section: "memory.consolidation", type: "number", env_key: "", default_value: 1_800_000, sensitive: false, restart_required: false, description: "Wait time after last activity before triggering idle consolidation" },
  { path: "memory.consolidation.intervalMs", label: "Interval (ms)", section: "memory.consolidation", type: "number", env_key: "", default_value: 86_400_000, sensitive: false, restart_required: false, description: "How often to run consolidation in cron mode (default: 24h)" },
  { path: "memory.consolidation.windowDays", label: "Window Days", section: "memory.consolidation", type: "number", env_key: "", default_value: 7, sensitive: false, restart_required: false, description: "Number of recent daily memory days included in each consolidation run" },
  { path: "memory.consolidation.archiveUsed", label: "Archive After Consolidation", section: "memory.consolidation", type: "boolean", env_key: "", default_value: false, sensitive: false, restart_required: false, description: "Delete daily memory entries after they have been consolidated" },
  { path: "memory.dailyInjectionDays", label: "Daily Injection Days", section: "memory.consolidation", type: "number", env_key: "", default_value: 1, sensitive: false, restart_required: false, description: "Number of recent daily memory days to inject into the system prompt (0 = disabled)" },
  { path: "memory.dailyInjectionMaxChars", label: "Daily Injection Max Chars", section: "memory.consolidation", type: "number", env_key: "", default_value: 4_000, sensitive: false, restart_required: false, description: "Character limit for daily memory injected into system prompt" },

  // ── Orchestration ──
  { path: "orchestration.maxToolResultChars", label: "Max Tool Result Chars", section: "orchestration", type: "number", env_key: "ORCHESTRATION_MAX_TOOL_RESULT_CHARS", default_value: 500, sensitive: false, restart_required: false, description: "Truncate tool outputs beyond this length before sending to LLM" },
  { path: "orchestration.orchestratorMaxTokens", label: "Max Tokens", section: "orchestration", type: "number", env_key: "ORCHESTRATION_MAX_TOKENS", default_value: 4096, sensitive: false, restart_required: false, description: "Maximum output tokens for orchestrator LLM calls" },
  { path: "orchestration.orchestratorProvider", label: "Orchestrator Provider", section: "orchestration", type: "string", env_key: "", default_value: "", sensitive: false, restart_required: true, description: "Provider instance for orchestrator classification (registered in Providers page with purpose=chat). Empty = auto-select" },
  { path: "orchestration.orchestratorModel", label: "Orchestrator Model", section: "orchestration", type: "string", env_key: "", default_value: "", sensitive: false, restart_required: true, description: "Model override for orchestrator. Empty = use instance default model" },
  { path: "orchestration.executorProvider", label: "Executor Provider", section: "orchestration", type: "string", env_key: "", default_value: "", sensitive: false, restart_required: true, description: "Provider instance for task execution (registered in Providers page with purpose=chat). Empty = auto-select" },
  { path: "orchestration.executorModel", label: "Executor Model", section: "orchestration", type: "string", env_key: "", default_value: "", sensitive: false, restart_required: true, description: "Model override for executor. Empty = use instance default model" },

  // ── Dashboard ──
  { path: "dashboard.enabled", label: "Enabled", section: "dashboard", type: "boolean", env_key: "DASHBOARD_ENABLED", default_value: true, sensitive: false, restart_required: true, description: "Enable the web dashboard HTTP server" },
  { path: "dashboard.port", label: "Port", section: "dashboard", type: "number", env_key: "DASHBOARD_PORT", default_value: 4200, sensitive: false, restart_required: true, description: "HTTP port for the dashboard" },
  { path: "dashboard.host", label: "Host", section: "dashboard", type: "string", env_key: "DASHBOARD_HOST", default_value: "0.0.0.0", sensitive: false, restart_required: true, description: "Bind address (0.0.0.0 for all interfaces, 127.0.0.1 for local only)" },
  { path: "dashboard.portFallback", label: "Port Fallback", section: "dashboard", type: "boolean", env_key: "", default_value: false, sensitive: false, restart_required: true, description: "Fallback to an ephemeral port if the configured port is in use" },
  { path: "dashboard.publicUrl", label: "Public URL", section: "dashboard", type: "string", env_key: "DASHBOARD_PUBLIC_URL", default_value: "", sensitive: false, restart_required: true, description: "Publicly accessible base URL (e.g. https://dashboard.example.com). Used as OAuth redirect_uri base. Required when running behind a reverse proxy or with a custom domain." },

  // ── CLI Providers ──
  { path: "cli.maxCaptureChars", label: "Max Capture Chars", section: "cli", type: "number", env_key: "", default_value: 500_000, sensitive: false, restart_required: false, description: "Maximum stdout/stderr capture size for CLI providers" },
  { path: "cli.maxStreamStateChars", label: "Max Stream State Chars", section: "cli", type: "number", env_key: "", default_value: 200_000, sensitive: false, restart_required: false, description: "Maximum buffer size for CLI stream state" },

  // ── MCP Servers ──
  { path: "mcp.enabled", label: "Enabled", section: "mcp", type: "boolean", env_key: "", default_value: true, sensitive: false, restart_required: false, description: "Enable MCP server integration for CLI providers" },
  { path: "mcp.startupTimeoutSec", label: "Startup Timeout (sec)", section: "mcp", type: "number", env_key: "", default_value: 0, sensitive: false, restart_required: false, description: "Default startup timeout for MCP servers (0 = none)" },
  { path: "mcp.serversFile", label: "Servers File", section: "mcp", type: "string", env_key: "", default_value: "", sensitive: false, restart_required: false, description: "Path to additional MCP servers JSON config file" },
  { path: "mcp.serversJson", label: "Servers JSON", section: "mcp", type: "string", env_key: "", default_value: "", sensitive: false, restart_required: false, description: "Inline JSON MCP servers configuration" },
  { path: "mcp.serverNames", label: "Server Names", section: "mcp", type: "string", env_key: "", default_value: "", sensitive: false, restart_required: false, description: "Comma-separated allowlist of MCP server names" },

  // ── Orchestrator LLM ──
  { path: "orchestratorLlm.enabled", label: "Enabled", section: "orchestratorLlm", type: "boolean", env_key: "ORCHESTRATOR_LLM_ENABLED", default_value: false, sensitive: false, restart_required: true, description: "Enable local orchestrator LLM runtime (Ollama)" },
  { path: "orchestratorLlm.engine", label: "Engine", section: "orchestratorLlm", type: "select", env_key: "ORCHESTRATOR_LLM_ENGINE", default_value: "auto", sensitive: false, restart_required: true, options: ["auto", "native", "docker", "podman"], description: "Container engine for Ollama runtime" },
  { path: "orchestratorLlm.image", label: "Image", section: "orchestratorLlm", type: "string", env_key: "ORCHESTRATOR_LLM_IMAGE", default_value: "ollama/ollama:latest", sensitive: false, restart_required: true, description: "Container image for Ollama" },
  { path: "orchestratorLlm.container", label: "Container Name", section: "orchestratorLlm", type: "string", env_key: "ORCHESTRATOR_LLM_CONTAINER", default_value: "orchestrator-llm", sensitive: false, restart_required: true, description: "Container name for Ollama instance" },
  { path: "orchestratorLlm.port", label: "Port", section: "orchestratorLlm", type: "number", env_key: "ORCHESTRATOR_LLM_PORT", default_value: 11434, sensitive: false, restart_required: true, description: "Ollama API port" },
  { path: "orchestratorLlm.model", label: "Model", section: "orchestratorLlm", type: "string", env_key: "ORCHESTRATOR_LLM_MODEL", default_value: "qwen3:4b", sensitive: false, restart_required: false, description: "Default model to load on startup" },
  { path: "orchestratorLlm.pullModel", label: "Auto Pull Model", section: "orchestratorLlm", type: "boolean", env_key: "ORCHESTRATOR_LLM_PULL_MODEL", default_value: true, sensitive: false, restart_required: false, description: "Automatically pull the model if not installed" },
  { path: "orchestratorLlm.autoStop", label: "Auto Stop", section: "orchestratorLlm", type: "boolean", env_key: "ORCHESTRATOR_LLM_AUTO_STOP", default_value: false, sensitive: false, restart_required: false, description: "Stop the container when the app shuts down" },
  { path: "orchestratorLlm.gpuEnabled", label: "GPU Enabled", section: "orchestratorLlm", type: "boolean", env_key: "ORCHESTRATOR_LLM_GPU_ENABLED", default_value: true, sensitive: false, restart_required: true, description: "Enable GPU acceleration for Ollama" },
  { path: "orchestratorLlm.apiBase", label: "API Base URL", section: "orchestratorLlm", type: "string", env_key: "ORCHESTRATOR_LLM_API_BASE", default_value: "http://ollama:11434/v1", sensitive: false, restart_required: true, description: "Ollama API base URL (OpenAI-compatible endpoint)" },

  // ── Embedding ──
  { path: "embedding.instanceId", label: "Embed Provider Instance", section: "embedding", type: "string", env_key: "EMBED_INSTANCE_ID", default_value: "", sensitive: false, restart_required: true, description: "Provider instance for embeddings (registered in Providers page with purpose=embedding). Empty = auto-select first available" },
  { path: "embedding.model", label: "Embed Model", section: "embedding", type: "string", env_key: "", default_value: "", sensitive: false, restart_required: true, description: "Model override for embeddings. Empty = use instance default model" },

  // ── Logging ──
  { path: "logging.level", label: "Log Level", section: "logging", type: "select", env_key: "", default_value: "info", sensitive: false, restart_required: true, options: ["debug", "info", "warn", "error"], description: "Minimum log level for console output" },

  // ── Operations ──
  { path: "ops.healthLogEnabled", label: "Health Log Enabled", section: "ops", type: "boolean", env_key: "", default_value: false, sensitive: false, restart_required: false, description: "Emit periodic health log entries" },
  { path: "ops.healthLogOnChange", label: "Health Log On Change", section: "ops", type: "boolean", env_key: "", default_value: true, sensitive: false, restart_required: false, description: "Only log health when state changes" },
  { path: "ops.bridgePumpEnabled", label: "Bridge Pump Enabled", section: "ops", type: "boolean", env_key: "", default_value: false, sensitive: false, restart_required: false, description: "Enable background inbound message polling bridge" },
];

/** 섹션별 필드 그룹핑 */
export function get_fields_by_section(): Map<ConfigSection, ConfigFieldMeta[]> {
  const map = new Map<ConfigSection, ConfigFieldMeta[]>();
  for (const f of CONFIG_FIELDS) {
    const list = map.get(f.section) ?? [];
    list.push(f);
    map.set(f.section, list);
  }
  return map;
}

/** 민감 필드 목록 */
export function get_sensitive_fields(): ConfigFieldMeta[] {
  return CONFIG_FIELDS.filter((f) => f.sensitive);
}

/** path → vault secret name 변환 (예: "channels.slack.botToken" → "config.channels.slack.botToken") */
export function to_vault_name(path: string): string {
  return `config.${path}`;
}
