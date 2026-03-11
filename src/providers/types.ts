export type ProviderId = "chatgpt" | "claude_code" | "openrouter" | "orchestrator_llm" | "gemini";

export type ChatRole = "system" | "user" | "assistant" | "tool";

// ── Sandbox Policy ──

/** 파일시스템 접근 수준. */
export type FsAccessLevel = "read-only" | "workspace-write" | "full-access";

/** 도구 실행 승인 모드. */
export type ApprovalMode = "always-ask" | "auto-approve" | "trusted-only";

/**
 * 오케스트레이터→에이전트 샌드박스 계약.
 * 백엔드가 지원하지 않는 필드는 조용히 무시.
 */
export type SandboxPolicy = {
  fs_access: FsAccessLevel;
  network_access: boolean;
  approval: ApprovalMode;
  /** 쓰기 허용 추가 디렉토리. Codex 전용. */
  writable_roots?: string[];
  /** 계획 전용 모드 (도구 실행 차단). Claude SDK 전용. */
  plan_only?: boolean;
};

/** MCP 서버 설정. 샌드박스와 직교. */
export type McpPolicy = {
  servers?: string[] | null;
  enable_all_project?: boolean;
};

/** 프리셋 이름 — permission_profile 후속. */
export type SandboxPreset = "strict" | "workspace-write" | "full-auto";

/** 프리셋 → SandboxPolicy 팩토리. */
export function sandbox_from_preset(preset: SandboxPreset): SandboxPolicy {
  switch (preset) {
    case "strict":
      return { fs_access: "read-only", network_access: false, approval: "always-ask" };
    case "workspace-write":
      return { fs_access: "workspace-write", network_access: true, approval: "trusted-only" };
    case "full-auto":
      return { fs_access: "full-access", network_access: true, approval: "auto-approve" };
  }
}

export type RuntimeExecutionPolicy = {
  sandbox: SandboxPolicy;
  mcp?: McpPolicy;
};

export type ChatMessage = {
  role: ChatRole;
  content?: unknown;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
  name?: string;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** 모델별 토큰/비용 내역. SDK result.modelUsage 기반. */
export type ModelUsageEntry = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
};

export type LlmUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  /** 총 비용 (USD). SDK total_cost_usd 기반. */
  total_cost_usd?: number;
  /** 모델별 토큰/비용 내역. SDK modelUsage 기반. */
  model_usage?: Record<string, ModelUsageEntry>;
};

export class LlmResponse {
  readonly content: string | null;
  readonly tool_calls: ToolCallRequest[];
  readonly finish_reason: string;
  readonly usage: LlmUsage;
  readonly reasoning_content: string | null;
  /** CLI 세션 ID, 모델명 등 프로바이더가 전달하는 부가 정보. */
  readonly metadata: Record<string, unknown>;

  constructor(args: {
    content?: string | null;
    tool_calls?: ToolCallRequest[];
    finish_reason?: string;
    usage?: LlmUsage;
    reasoning_content?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    this.content = args.content ?? null;
    this.tool_calls = args.tool_calls ?? [];
    this.finish_reason = args.finish_reason ?? "stop";
    this.usage = args.usage ?? {};
    this.reasoning_content = args.reasoning_content ?? null;
    this.metadata = args.metadata ?? {};
  }

  get has_tool_calls(): boolean {
    return this.tool_calls.length > 0;
  }
}

export type ChatOptions = {
  messages: ChatMessage[];
  tools?: Record<string, unknown>[];
  runtime_policy?: RuntimeExecutionPolicy;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  effort?: import("../agent/agent.types.js").EffortLevel;
  on_stream?: (chunk: string) => void | Promise<void>;
  abort_signal?: AbortSignal;
};

export interface LlmProvider {
  readonly id: ProviderId;
  /** 도구 호출 → 결과 → 재호출 루프를 지원하는지 여부. */
  readonly supports_tool_loop: boolean;
  chat(options: ChatOptions): Promise<LlmResponse>;
  get_default_model(): string;
}

/** JSON 문자열 또는 객체를 Record로 변환. 파싱 실패 시 { raw } 반환. */
export function parse_json_or_raw(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { raw };
  } catch {
    process.stderr.write(`[parse_json_or_raw] tool argument JSON parse failed: ${raw.slice(0, 200)}\n`);
    return { raw };
  }
}

/** OpenAI 호환 JSON 응답을 파싱하여 content, tool_calls, usage를 추출. */
export function parse_openai_response(raw: Record<string, unknown>): {
  content: string | null;
  tool_calls: ToolCallRequest[];
  finish_reason: string;
  usage: LlmUsage;
} {
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const first = (choices[0] as Record<string, unknown>) || {};
  const message = (first.message as Record<string, unknown>) || {};
  const tool_calls_raw = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const tool_calls: ToolCallRequest[] = tool_calls_raw
    .map((tc): ToolCallRequest | null => {
      const rec = tc as Record<string, unknown>;
      const fn = (rec.function as Record<string, unknown>) || {};
      const id = String(rec.id || "");
      const name = String(fn.name || rec.name || "");
      if (!id || !name) return null;
      return { id, name, arguments: parse_json_or_raw(fn.arguments || rec.arguments) };
    })
    .filter((v): v is ToolCallRequest => Boolean(v));
  const usage_raw = (raw.usage as Record<string, unknown>) || {};
  return {
    content: typeof message.content === "string" ? message.content : null,
    tool_calls,
    finish_reason: typeof first.finish_reason === "string" ? first.finish_reason : "stop",
    usage: {
      prompt_tokens: Number(usage_raw.prompt_tokens || 0),
      completion_tokens: Number(usage_raw.completion_tokens || 0),
      total_tokens: Number(usage_raw.total_tokens || 0),
    },
  };
}

/** ChatMessage[] → API 전송용 plain object 배열. */
export function sanitize_messages_for_api(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    const out: Record<string, unknown> = {
      role: m.role,
      content: m.content ?? "",
    };
    if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) out.tool_calls = m.tool_calls;
    if (typeof m.tool_call_id === "string") out.tool_call_id = m.tool_call_id;
    if (typeof m.name === "string") out.name = m.name;
    return out;
  });
}
