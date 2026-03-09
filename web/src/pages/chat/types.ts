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
  name?: string;
}

export interface ChatMessage {
  direction: "user" | "assistant";
  content: string;
  at: string;
  media?: ChatMediaItem[];
  model?: string;
  provider_instance_id?: string;
}

export interface ChatSession {
  id: string;
  created_at: string;
  messages: ChatMessage[];
}