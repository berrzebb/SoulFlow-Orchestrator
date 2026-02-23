export type ProviderId = "chatgpt" | "claude_code" | "openrouter" | "phi4_local";

export type ChatRole = "system" | "user" | "assistant" | "tool";

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

export type LlmUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export class LlmResponse {
  readonly content: string | null;
  readonly tool_calls: ToolCallRequest[];
  readonly finish_reason: string;
  readonly usage: LlmUsage;
  readonly reasoning_content: string | null;

  constructor(args: {
    content?: string | null;
    tool_calls?: ToolCallRequest[];
    finish_reason?: string;
    usage?: LlmUsage;
    reasoning_content?: string | null;
  }) {
    this.content = args.content ?? null;
    this.tool_calls = args.tool_calls ?? [];
    this.finish_reason = args.finish_reason ?? "stop";
    this.usage = args.usage ?? {};
    this.reasoning_content = args.reasoning_content ?? null;
  }

  get has_tool_calls(): boolean {
    return this.tool_calls.length > 0;
  }
}

export type ChatOptions = {
  messages: ChatMessage[];
  tools?: Record<string, unknown>[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  on_stream?: (chunk: string) => void | Promise<void>;
  abort_signal?: AbortSignal;
};

export interface LlmProvider {
  readonly id: ProviderId;
  chat(options: ChatOptions): Promise<LlmResponse>;
  get_default_model(): string;
}
