/** Pty 인터페이스 — node-pty 호환 추상화. 상위 레이어는 transport를 모른다. */

export type Disposable = { dispose(): void };

export type PtySpawnOptions = {
  name: string;
  cols?: number;
  rows?: number;
  cwd: string;
  env: Record<string, string>;
};

export interface Pty {
  readonly pid: string;
  write(data: string): void;
  /** stdin에 데이터를 쓰고 닫는다. single-shot CLI (-p 모드)용. */
  end(data?: string): void;
  onData(cb: (data: string) => void): Disposable;
  onExit(cb: (e: { exitCode: number }) => void): Disposable;
  kill(): void;
  resize(cols: number, rows: number): void;
}

export type PtyFactory = (
  file: string,
  args: string[],
  options: PtySpawnOptions,
) => Pty;

// ── NDJSON Wire Protocol ──

export type AgentInputMessage =
  | { type: "user_message"; content: string; metadata?: Record<string, unknown> };

export type AgentOutputMessage =
  | { type: "assistant_chunk"; content: string; delta: true }
  | { type: "assistant_message"; content: string }
  | { type: "tool_use"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "complete"; result: string; usage?: { input: number; output: number } }
  | { type: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "timeout"
  | "crash"
  | "buffer_overflow"
  | "token_limit"
  | "auth"
  | "rate_limit"
  | "billing"
  | "failover"
  | "fatal";

// ── Error Classification ──

export type ErrorClass =
  | "context_overflow"
  | "auth_error"
  | "rate_limit"
  | "crash"
  | "failover"
  | "billing"
  | "fatal";

export function classify_error(msg: AgentOutputMessage): ErrorClass {
  if (msg.type !== "error") return "fatal";
  const text = msg.message ?? "";

  if (msg.code === "token_limit" || /context.*overflow|prompt.*too.*large/i.test(text))
    return "context_overflow";
  if (msg.code === "auth" || /invalid.*api.*key|unauthorized|authentication/i.test(text))
    return "auth_error";
  if (msg.code === "rate_limit" || /rate.*limit|too.*many.*requests/i.test(text))
    return "rate_limit";
  if (msg.code === "billing" || /billing|quota.*exceeded|insufficient.*funds/i.test(text))
    return "billing";
  if (msg.code === "crash")
    return "crash";
  if (msg.code === "failover" || /failover|model.*unavailable|overloaded/i.test(text))
    return "failover";
  return "fatal";
}

// ── CLI Adapter ──

/** stdin 모드. close = EOF로 프롬프트 전달 (-p 모드), keep = 스트리밍 유지 (interactive). */
export type StdinMode = "close" | "keep";

/** build_args()에 전달할 옵션. 매개변수 과다 방지를 위해 객체로 캡슐화. */
export type BuildArgsOptions = {
  session_key: string;
  system_prompt?: string;
  /** 도구 정의 프롬프트. Codex developer_instructions에 시스템 프롬프트와 함께 주입. */
  tool_definitions?: string;
  model?: string;
  max_turns?: number;
  allowed_tools?: string[];
  disallowed_tools?: string[];
  /** 추가 작업 디렉토리. Claude: --add-dir, Codex: --add-dir, Gemini: --include-directories. */
  add_dirs?: string[];
  /** 세션 비영구화. Claude: --no-session-persistence, Codex: --ephemeral. */
  ephemeral?: boolean;
  /** 비용 상한 (USD). Claude: --max-budget-usd. */
  max_budget_usd?: number;
  /** 구조화된 출력 JSON Schema. Claude: --json-schema, Codex: --output-schema (파일경로). */
  json_schema?: string;
  /** MCP 서버 설정 파일 경로. Claude: --mcp-config, Gemini: 확장 로드. */
  mcp_config?: string;
};

export interface CliAdapter {
  readonly cli_id: string;
  /** stdin 처리 방식. "close" → end(), "keep" → write(). */
  readonly stdin_mode: StdinMode;
  /** CLI가 시스템 프롬프트를 별도 플래그로 전달 가능한지 여부. false면 task에 합침. */
  readonly supports_system_prompt_flag: boolean;
  /** CLI가 --allowedTools/--disallowedTools를 지원하는지 여부. */
  readonly supports_tool_filtering: boolean;
  /** CLI가 구조화된 출력(JSON Schema)을 지원하는지 여부. Claude: --json-schema, Codex: --output-schema. */
  readonly supports_structured_output: boolean;
  /** CLI가 비용 상한 추적을 지원하는지 여부. Claude: --max-budget-usd. */
  readonly supports_budget_tracking: boolean;
  /** CLI가 도구 실행 전 승인 흐름을 지원하는지 여부. Claude: --permission-prompt-tool. */
  readonly supports_approval: boolean;
  /** CLI가 확장 사고(extended thinking)를 지원하는지 여부. */
  readonly supports_thinking: boolean;
  /** CLI에서 캡처한 세션 ID (init 이벤트). resume에 사용. */
  readonly session_id: string | null;
  build_args(options: BuildArgsOptions): string[];
  parse_output(line: string): AgentOutputMessage | AgentOutputMessage[] | null;
  format_input(msg: AgentInputMessage): string;
}

// ── AgentTransport ──

/** 전송 계층 추상화. AgentBus가 이 인터페이스를 통해 에이전트와 통신. */
export interface AgentTransport {
  send(session_key: string, msg: AgentInputMessage, args_options: BuildArgsOptions, env?: Record<string, string>): Promise<AgentOutputMessage>;
  on_output(handler: (key: string, msg: AgentOutputMessage) => void): Disposable;
  list_sessions(): string[];
  remove_session(session_key: string): Promise<void>;
  shutdown(): Promise<void>;
  /** 실행 중 stdin에 직접 쓰기 (Steer Mode). stdin_mode="keep" 어댑터만 지원. */
  write_stdin?(session_key: string, text: string): boolean;
}

// ── Failover ──

export class FailoverError extends Error {
  constructor(
    message: string,
    public readonly meta: {
      reason: "auth" | "rate_limit" | "quota" | "timeout" | "unknown";
      provider: string;
      model?: string;
      profile_id?: string;
    },
  ) {
    super(message);
    this.name = "FailoverError";
  }
}
