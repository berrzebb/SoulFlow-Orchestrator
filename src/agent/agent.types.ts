import type { LlmUsage, RuntimeExecutionPolicy } from "../providers/types.js";
import type { JsonSchema, PreToolHook, PostToolHook, ToolSchema } from "./tools/types.js";
import type { ExecutionMode } from "../orchestration/types.js";

/** Agent 백엔드 식별자. 동적 프로바이더 인스턴스를 지원하기 위해 string으로 확장. */
export type AgentBackendId = string;

/** 빌트인 프로바이더 타입. 확장 시 register_agent_provider_factory()로 등록. */
export type AgentProviderType = "claude_cli" | "codex_cli" | "claude_sdk" | "codex_appserver" | (string & {});

/** 에이전트 프로바이더 인스턴스 설정. SQLite에 영속화되며 대시보드에서 CRUD. */
export type AgentProviderConfig = {
  instance_id: string;
  provider_type: AgentProviderType;
  label: string;
  enabled: boolean;
  /** 낮을수록 높은 우선순위. */
  priority: number;
  /** 지원하는 실행 모드. 빈 배열 = 모든 모드. */
  supported_modes: ExecutionMode[];
  /** 프로바이더 타입별 생성자 인자 (cwd, model, command 등). */
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CreateAgentProviderInput = Pick<
  AgentProviderConfig,
  "instance_id" | "provider_type" | "label" | "enabled" | "priority" | "supported_modes" | "settings"
>;

/** 백엔드가 제공하는 기능 선언. 오케스트레이터가 보상 전략을 결정하는 데 사용. */
export type BackendCapabilities = {
  approval: boolean;
  structured_output: boolean;
  thinking: boolean;
  budget_tracking: boolean;
  tool_filtering: boolean;
  tool_result_events: boolean;
  /** 실행 중 외부 입력 주입 (SDK: streamInput, Codex: turn/steer). */
  send_input: boolean;
  /** 클라이언트 등록 도구 네이티브 실행 (SDK: MCP bridge, Codex: item/tool/call). */
  tool_executors: boolean;
};

// ── AgentEvent 판별 유니온 ──

/** 이벤트 발생 주체 식별. 서브에이전트도 동일 타입으로 수렴. */
export type AgentEventSource = {
  backend: AgentBackendId;
  task_id?: string;
  subagent_id?: string;
  subagent_label?: string;
};

/** 정규화된 종료 이유. 4개 백엔드의 stop_reason을 통합. */
export type AgentFinishReason =
  | "stop"              // SDK: end_turn / success, Codex: completed
  | "max_turns"         // SDK: error_max_turns
  | "max_budget"        // SDK: error_max_budget_usd
  | "max_tokens"        // SDK: max_tokens
  | "output_retries"    // SDK: error_max_structured_output_retries
  | "error"             // SDK: error_during_execution, Codex: failed
  | "cancelled"         // Codex: interrupted
  | "approval_required";

/** Agent 실행 중 발행되는 타입 안전 이벤트. */
export type AgentEvent =
  | { type: "init";             source: AgentEventSource; at: string; session_id?: string }
  | { type: "content_delta";    source: AgentEventSource; at: string; text: string }
  | { type: "tool_use";         source: AgentEventSource; at: string;
      tool_name: string; tool_id: string; params: Record<string, unknown> }
  | { type: "tool_result";      source: AgentEventSource; at: string;
      tool_name: string; tool_id: string; result: string; is_error?: boolean;
      params?: Record<string, unknown> }
  | { type: "approval_request"; source: AgentEventSource; at: string;
      request: ApprovalBridgeRequest }
  | { type: "usage";            source: AgentEventSource; at: string;
      tokens: { input: number; output: number; cache_read?: number; cache_creation?: number };
      cost_usd?: number }
  | { type: "rate_limit";       source: AgentEventSource; at: string;
      status: "allowed" | "allowed_warning" | "rejected"; resets_at?: number; utilization?: number }
  | { type: "compact_boundary"; source: AgentEventSource; at: string;
      trigger: "manual" | "auto"; pre_tokens: number }
  | { type: "task_lifecycle";   source: AgentEventSource; at: string;
      sdk_task_id: string; status: "started" | "progress" | "completed" | "failed" | "stopped";
      description?: string; summary?: string;
      task_usage?: { total_tokens: number; tool_uses: number; duration_ms: number } }
  | { type: "tool_summary";    source: AgentEventSource; at: string;
      summary: string; tool_use_ids: string[] }
  | { type: "auth_request";     source: AgentEventSource; at: string;
      messages: string[]; is_error: boolean }
  | { type: "error";            source: AgentEventSource; at: string;
      error: string; code?: string }
  | { type: "complete";         source: AgentEventSource; at: string;
      finish_reason: AgentFinishReason; content?: string };

/** 세션 핸들. resume 지원 백엔드에서 반환. */
export type AgentSession = {
  session_id: string;
  backend: AgentBackendId;
  created_at: string;
  /** 이 세션에 연결된 태스크 ID. */
  task_id?: string;
  /** 저장 시 첨부된 메타데이터. */
  metadata?: Record<string, unknown>;
  /** 백엔드별 opaque resume 토큰. */
  resume_token?: string;
};

// ── Approval Bridge ──

/** 네이티브 백엔드가 tool 실행 전 승인을 요청할 때 보내는 페이로드. */
export type ApprovalBridgeRequest = {
  request_id: string;
  type: "command_execution" | "file_change" | "tool_use";
  detail: string;
  command?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

export type ApprovalBridgeDecision = "accept" | "accept_session" | "deny" | "cancel";

/** 오케스트레이터가 제공하는 승인 콜백. Promise가 사용자 응답까지 블로킹. */
export type ApprovalBridgeCallback =
  (request: ApprovalBridgeRequest) => Promise<ApprovalBridgeDecision>;

// ── Effort / Thinking ──

export type EffortLevel = "low" | "medium" | "high" | "max";

// ── Hooks ──

/** 오케스트레이터→에이전트 훅 계약. 분산 콜백을 단일 타입으로 통합. */
export type AgentHooks = {
  on_event?: (event: AgentEvent) => void | Promise<void>;
  on_stream?: (chunk: string) => void | Promise<void>;
  on_approval?: ApprovalBridgeCallback;
  pre_tool_use?: PreToolHook;
  post_tool_use?: PostToolHook;
};

// ── Run Options / Result ──

/**
 * 오케스트레이터→에이전트 계약.
 * 에이전트는 stateless: 오케스트레이터가 프롬프트, 도구, 문맥을 모두 제공.
 * 백엔드가 지원하지 않는 필드는 조용히 무시.
 */
export type AgentRunOptions = {
  task: string;
  /** 오케스트레이터가 부여한 작업 식별자. 세션 영속화 시 연결 키. */
  task_id?: string;
  system_prompt?: string;
  tools?: ToolSchema[];
  runtime_policy?: RuntimeExecutionPolicy;
  /** MCP 서버 설정. SDK 백엔드가 네이티브 연결에 사용. McpStdioServerConfig 형식. */
  mcp_server_configs?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  max_turns?: number;
  max_tokens?: number;
  temperature?: number;
  resume_session?: AgentSession;
  abort_signal?: AbortSignal;

  /** SDK 백엔드가 MCP 서버로 래핑할 실행 가능한 도구 목록. */
  tool_executors?: import("./tools/types.js").ToolLike[];

  /** 통합 훅 객체. on_event/on_stream/on_approval/pre_tool/post_tool. */
  hooks?: AgentHooks;

  /** per-run 모델 오버라이드. */
  model?: string;
  /** primary 모델 실패 시 자동 전환. SDK만 지원. */
  fallback_model?: string;
  /** 성능 트레이드오프. SDK: output_config.effort, Codex: reasoning.effort. */
  effort?: EffortLevel;
  /** thinking 활성화. 기본 false. 스킬이 opt-in. SDK: thinking.type=adaptive. */
  enable_thinking?: boolean;
  /** thinking 최대 토큰 수. SDK: maxThinkingTokens. enable_thinking=true일 때만 유효. */
  max_thinking_tokens?: number;
  /** 비용 상한. SDK: max_budget_usd, PTY(Claude): --max-budget-usd. */
  max_budget_usd?: number;

  /** 추가 작업 디렉토리. PTY: --add-dir / --include-directories. */
  add_dirs?: string[];
  /** 세션 비영구화. PTY(Claude): --no-session-persistence, PTY(Codex): --ephemeral. */
  ephemeral?: boolean;

  /** 허용 도구 이름 목록. SDK: allowedTools. */
  allowed_tools?: string[];
  /** 차단 도구 이름 목록. SDK: disallowedTools. */
  disallowed_tools?: string[];

  /** 응답 JSON 스키마 강제. SDK: outputFormat. */
  structured_output?: JsonSchema;

  /** 실행 중 외부 입력을 수신할 콜백 등록. 백엔드가 지원할 때만 호출. */
  register_send_input?: (fn: (text: string) => void) => void;

  /** complete 후 followup 대기 시간 (ms). task HITL용. 0 = 대기 없음 (기본). */
  wait_for_input_ms?: number;

  /** 도구 실행 시 전달할 요청별 컨텍스트. set_context() 전역 뮤테이션 대신 사용. */
  tool_context?: Partial<import("./tools/types.js").ToolExecutionContext>;

  /** 에이전트 프로세스에 주입할 환경변수. */
  env?: Record<string, string>;
  /** SDK 설정 소스 (예: ["project"]). CLAUDE.md 등 로드. */
  settings_sources?: string[];
};

/** 에이전트→오케스트레이터 계약. */
export type AgentRunResult = {
  content: string | null;
  session: AgentSession | null;
  tool_calls_count: number;
  usage: LlmUsage;
  finish_reason: AgentFinishReason;
  metadata: Record<string, unknown>;
  /** structured_output 사용 시 파싱된 결과. */
  parsed_output?: unknown;
};

/**
 * CLI, SDK, AppServer 등 다양한 에이전트 실행 백엔드를 추상화하는 통합 인터페이스.
 *
 * - native_tool_loop=true (SDK/AppServer): run()이 내부에서 전체 tool loop 실행.
 * - native_tool_loop=false (CLI): run()이 단일 턴 실행, 호출자가 tool loop 관리.
 */
export interface AgentBackend {
  readonly id: AgentBackendId;
  /** 백엔드가 tool 실행을 내부에서 처리하는지 여부. */
  readonly native_tool_loop: boolean;
  /** 세션 resume 지원 여부. */
  readonly supports_resume: boolean;
  /** 백엔드가 제공하는 기능 선언. */
  readonly capabilities: BackendCapabilities;
  /** Agent 실행. native_tool_loop에 따라 단일 턴 또는 전체 루프. */
  run(options: AgentRunOptions): Promise<AgentRunResult>;
  /** 백엔드가 사용 가능한 상태인지 확인. */
  is_available(): boolean;
  /** 백엔드가 보유한 자식 프로세스/소켓 등 리소스 정리. */
  stop?(): void;
}
