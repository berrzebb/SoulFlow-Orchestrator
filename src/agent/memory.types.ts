export type MemoryKind = "longterm" | "daily";

export interface MemoryStoreLike {
  list_daily(): Promise<string[]>;
  read_longterm(): Promise<string>;
  write_longterm(content: string): Promise<void>;
  append_longterm(content: string): Promise<void>;
  read_daily(day?: string): Promise<string>;
  write_daily(content: string, day?: string): Promise<void>;
  append_daily(content: string, day?: string): Promise<void>;
  search(
    query: string,
    args?: { kind?: "all" | MemoryKind; day?: string; limit?: number; case_sensitive?: boolean },
  ): Promise<Array<{ file: string; line: number; text: string }>>;
  /** 임베딩 함수 주입 (벡터 시멘틱 검색 활성화). */
  set_embed?(fn: (texts: string[], opts: { model?: string; dimensions?: number }) => Promise<{ embeddings: number[][] }>): void;
  /** 메모리 압축. 구현체가 제공하지 않으면 consolidation service가 fallback 로직을 사용. */
  consolidate?(options?: MemoryConsolidateOptions): Promise<MemoryConsolidateResult>;
}

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
  daily_entries_used: string[];
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
  content?: string | null;
};

export type LlmProviderLike = {
  chat(args: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    tools: unknown[];
    model: string;
  }): Promise<LlmConsolidationResponse>;
};

