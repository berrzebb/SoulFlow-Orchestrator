export type SessionMessage = {
  role: string;
  content?: string;
  timestamp?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
  tools_used?: string[];
  [key: string]: unknown;
};

export type SessionHistoryEntry = {
  role: string;
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
};

export type SessionHistoryRange = {
  start_offset: number;
  end_offset: number;
  items: SessionHistoryEntry[];
};
