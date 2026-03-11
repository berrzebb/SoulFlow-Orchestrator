import type { InboundMessage, OutboundMessage } from "../bus/types.js";
import type { CommandDescriptor } from "./commands/registry.js";

/** 채널 프로바이더 식별자. 동적 프로바이더 지원을 위해 string으로 확장. */
export type ChannelProvider = string;

const KNOWN_PROVIDERS = new Set(["slack", "discord", "telegram", "web"]);

/** 알려진 빌트인 프로바이더인지 검사. */
export function is_known_provider(provider: string): boolean {
  return KNOWN_PROVIDERS.has(provider.toLowerCase());
}

/** provider/channel 문자열에서 프로바이더를 추출. 빈 문자열이면 null. */
export function resolve_provider(msg: { provider?: string; channel?: string }): string | null {
  const raw = String(msg.provider || msg.channel || "").toLowerCase().trim();
  return raw || null;
}

/** 메시지에 대한 reply_to 값을 provider 규칙에 따라 결정. */
export function resolve_reply_to(provider: ChannelProvider, message: InboundMessage): string {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  if (provider === "slack") {
    const thread = String(message.thread_id || "").trim();
    if (thread) return thread;
    return String(meta.message_id || message.id || "").trim();
  }
  if (provider === "telegram") return "";
  return String(meta.message_id || message.id || "").trim();
}

export type ChannelTypingState = {
  chat_id: string;
  typing: boolean;
  updated_at: string;
};

export type ChannelCommand = {
  raw: string;
  name: string;
  args: string[];
};

export type AgentMention = {
  raw: string;
  alias: string;
};

export type FileRequestResult = {
  ok: boolean;
  request_id: string;
  chat_id: string;
  message?: string;
  error?: string;
};

/** 투표/설문 옵션. */
export type PollOption = {
  text: string;
};

/** 투표/설문 요청. */
export type SendPollRequest = {
  chat_id: string;
  question: string;
  options: PollOption[];
  /** 복수 선택 허용 여부. 기본 false. */
  allows_multiple_answers?: boolean;
  /** 익명 투표 여부. 기본 true. */
  is_anonymous?: boolean;
  /** 투표 자동 종료 시간 (초). */
  open_period?: number;
  /** Telegram forum topic ID. */
  message_thread_id?: number;
};

export type SendPollResult = {
  ok: boolean;
  message_id?: string;
  error?: string;
};

export type ChannelHealth = {
  provider: string;
  instance_id: string;
  running: boolean;
  last_error?: string;
};

export type ChannelConfig = {
  provider: string;
  enabled?: boolean;
  default_chat_id?: string;
};

export interface ChatChannel {
  readonly provider: string;
  readonly instance_id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  is_running(): boolean;
  send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  edit_message(chat_id: string, message_id: string, content: string, parse_mode?: string): Promise<{ ok: boolean; error?: string }>;
  read(chat_id: string, limit?: number): Promise<InboundMessage[]>;
  send_command(chat_id: string, command: string, args?: string[]): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  request_file(chat_id: string, prompt: string, accept?: string[]): Promise<FileRequestResult>;
  send_agent_mention(
    chat_id: string,
    from_alias: string,
    to_alias: string,
    message: string,
  ): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  add_reaction(chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }>;
  remove_reaction(chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }>;
  /** 투표/설문 전송. 미지원 채널은 { ok: false, error: "poll_not_supported" } 반환. */
  send_poll(poll: SendPollRequest): Promise<SendPollResult>;
  set_typing(chat_id: string, typing: boolean, anchor_message_id?: string): Promise<void>;
  get_typing_state(chat_id: string): ChannelTypingState;
  parse_command(content: string): ChannelCommand | null;
  parse_agent_mentions(content: string): AgentMention[];
  sync_commands(descriptors: CommandDescriptor[]): Promise<void>;
  get_health(): ChannelHealth;
}

export interface ChannelRegistryLike {
  start_all(): Promise<void>;
  stop_all(): Promise<void>;
  register(channel: ChatChannel): void;
  unregister(instance_id: string): boolean;
  get_channel(id: string): ChatChannel | null;
  get_channels_by_provider(provider: string): ChatChannel[];
  list_channels(): Array<{ provider: string; instance_id: string }>;
  send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  edit_message(id: string, chat_id: string, message_id: string, content: string, parse_mode?: string): Promise<{ ok: boolean; error?: string }>;
  add_reaction(id: string, chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }>;
  remove_reaction(id: string, chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }>;
  read(id: string, chat_id: string, limit?: number): Promise<InboundMessage[]>;
  find_latest_agent_mention(
    id: string,
    chat_id: string,
    agent_alias: string,
    limit?: number,
  ): Promise<InboundMessage | null>;
  set_typing(id: string, chat_id: string, typing: boolean, anchor_message_id?: string): Promise<void>;
  get_typing_state(id: string, chat_id: string): ChannelTypingState | null;
  send_poll(id: string, poll: SendPollRequest): Promise<SendPollResult>;
  get_health(): ChannelHealth[];
}
