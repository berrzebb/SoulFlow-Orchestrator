export type MemoryKind = "longterm" | "daily";

export type MemoryConsolidateOptions = {
  session?: string;
  provider?: string;
  model?: string;
  memory_window?: number;
  archive?: boolean;
};

export type MemoryConsolidateResult = {
  ok: boolean;
  longterm_appended_chars: number;
  daily_files_used: string[];
  archived_files: string[];
  summary: string;
  compressed_prompt: string;
};

export type ConsolidationMessage = {
  role: string;
  content?: string;
  timestamp?: string;
  tools_used?: string[];
};

export type ConsolidationSession = {
  messages: ConsolidationMessage[];
  last_consolidated: number;
};

export type LlmToolCall = {
  arguments: Record<string, unknown>;
};

export type LlmConsolidationResponse = {
  has_tool_calls: boolean;
  tool_calls: LlmToolCall[];
};

export type LlmProviderLike = {
  chat(args: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    tools: unknown[];
    model: string;
  }): Promise<LlmConsolidationResponse>;
};

