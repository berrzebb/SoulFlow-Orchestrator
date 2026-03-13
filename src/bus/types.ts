export type MessageProvider = "slack" | "discord" | "telegram" | "web" | "system" | string;

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
  instance_id?: string;
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
  /** 멀티테넌트: SSE 스코프 브로드캐스트에 사용. */
  team_id?: string;
};

export type MessageBusObserver = (direction: "inbound" | "outbound", message: Message) => void;

/* ── 기본 publish/consume 인터페이스 ── */

export interface MessageBusLike {
  publish_inbound(message: InboundMessage): Promise<void>;
  publish_outbound(message: OutboundMessage): Promise<void>;
  consume_inbound(options?: ConsumeMessageOptions): Promise<InboundMessage | null>;
  consume_outbound(options?: ConsumeMessageOptions): Promise<OutboundMessage | null>;
  publish_progress(event: ProgressEvent): Promise<void>;
  consume_progress(options?: ConsumeMessageOptions): Promise<ProgressEvent | null>;
  get_size(direction?: "inbound" | "outbound"): number;
  get_sizes(): { inbound: number; outbound: number; total: number };
  close(): Promise<void>;
  is_closed(): boolean;
}

/* ── observer/tap 포트 (concrete leak 제거) ── */

export interface MessageBusTap {
  on_publish(observer: MessageBusObserver): void;
}

/* ── lease/ack 인터페이스 (Redis Streams 지원) ── */

export interface MessageLease<T> {
  value: T;
  ack(): Promise<void>;
  retry(delay_ms?: number): Promise<void>;
  release(): Promise<void>;
}

export interface ReliableMessageBus extends MessageBusLike {
  consume_inbound_lease(options?: ConsumeMessageOptions): Promise<MessageLease<InboundMessage> | null>;
  consume_outbound_lease(options?: ConsumeMessageOptions): Promise<MessageLease<OutboundMessage> | null>;
  consume_progress_lease(options?: ConsumeMessageOptions): Promise<MessageLease<ProgressEvent> | null>;
}

/* ── 메트릭 ── */

export type BusQueueStats = {
  depth: number;
  overflow: number;
};

export type BusMetrics = {
  inbound: BusQueueStats;
  outbound: BusQueueStats;
  progress: BusQueueStats;
  capacity: number;
  /** Redis 전용 — pending count, oldest age 등. */
  pending_count?: number;
  oldest_pending_age_ms?: number;
  consumer_lag?: number;
};

/* ── 런타임 통합 타입 ── */

export type MessageBusRuntime = MessageBusLike & MessageBusTap & {
  readonly kind: "memory" | "redis";
  get_metrics(): BusMetrics;
};
