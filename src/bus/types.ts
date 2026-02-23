export type MediaItem = {
  type: "image" | "video" | "audio" | "file" | "link";
  url?: string;
  mime?: string;
  name?: string;
  size?: number;
};

export type BaseMessage = {
  id: string;
  provider: string;
  channel: string;
  sender_id: string;
  chat_id: string;
  content: string;
  at: string;
  thread_id?: string;
  media?: MediaItem[];
  metadata?: Record<string, unknown>;
};

export type InboundMessage = BaseMessage & {
  timestamp?: number | string;
  session_key?: string;
};

export type OutboundMessage = BaseMessage & {
  reply_to?: string;
};

export type BusDirection = "inbound" | "outbound";

export type ConsumeOptions = {
  timeout_ms?: number;
};

export type BusSizes = {
  inbound: number;
  outbound: number;
  total: number;
};

export type BusDrainResult = {
  drained_inbound: number;
  drained_outbound: number;
};
