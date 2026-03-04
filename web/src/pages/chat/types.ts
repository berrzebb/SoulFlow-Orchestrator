export interface ChatMediaItem {
  type: string;
  url: string;
  mime?: string;
  name?: string;
}

export interface ChatSessionSummary {
  id: string;
  created_at: string;
  message_count: number;
}

export interface ChatMessage {
  direction: "user" | "assistant";
  content: string;
  at: string;
  media?: ChatMediaItem[];
}

export interface ChatSession {
  id: string;
  created_at: string;
  messages: ChatMessage[];
}

export interface PendingApproval {
  request_id: string;
  tool_name: string;
  status: string;
  created_at: string;
  params?: Record<string, unknown>;
  context?: { channel?: string; chat_id?: string; task_id?: string };
}
