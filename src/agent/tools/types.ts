/** 도구 카테고리. 실행 정책 및 도구 필터링에 사용. */
export type ToolCategory =
  | "filesystem" | "shell" | "web" | "messaging" | "file_transfer"
  | "scheduling" | "memory" | "decision" | "promise" | "secret"
  | "diagram" | "admin" | "spawn" | "external";

/** 도구의 정책 플래그. sandbox 정책 판정에 사용. */
export type ToolPolicyFlags = {
  /** true면 쓰기 작업 — 승인 정책 대상. */
  write?: boolean;
  /** true면 네트워크 접근 — sandbox network 정책 대상. */
  network?: boolean;
};

export type JsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean;
  description?: string;
};

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export type ToolExecuteResult = string;

export type ToolExecutionContext = {
  signal?: AbortSignal;
  task_id?: string;
  channel?: string;
  chat_id?: string;
  sender_id?: string;
  reply_to?: string;
};

export interface ToolLike {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly category: ToolCategory;
  readonly policy_flags?: ToolPolicyFlags;
  execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolExecuteResult>;
  validate_params(params: Record<string, unknown>): string[];
  to_schema(): ToolSchema;
}

/** PreToolUse 훅이 반환하는 결정. deny > ask > allow 우선순위. */
export type ToolHookDecision = {
  permission?: "allow" | "deny" | "ask";
  reason?: string;
  /** allow 시 수정된 파라미터 (원본 대체). */
  updated_params?: Record<string, unknown>;
};

export type PreToolHook = (
  tool_name: string,
  params: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<ToolHookDecision> | ToolHookDecision;

export type PostToolHook = (
  tool_name: string,
  params: Record<string, unknown>,
  result: string,
  context?: ToolExecutionContext,
  is_error?: boolean,
) => Promise<void> | void;

