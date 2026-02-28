export type MessageProvider = "slack" | "discord" | "telegram" | "system" | string;

export type MediaItemType = "image" | "video" | "audio" | "file" | "link";

export type MediaItem = {
  type: MediaItemType;
  url: string;
  mime?: string;
  name?: string;
  size?: number;
};

export type Message = {
  id: string;
  provider: MessageProvider;
  channel: string;
  sender_id: string;
  chat_id: string;
  content: string;
  at: string;
  reply_to?: string;
  thread_id?: string;
  media?: MediaItem[];
  metadata?: Record<string, unknown>;
};

export type InboundMessage = Message;
export type OutboundMessage = Message;

export type ConsumeMessageOptions = {
  timeout_ms?: number;
};

export type ProgressEvent = {
  task_id: string;
  step: number;
  total_steps?: number;
  description: string;
  provider: string;
  chat_id: string;
  at: string;
};
