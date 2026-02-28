import type { InboundMessage, OutboundMessage } from "../bus/types.js";
import type { CommandDescriptor } from "./commands/registry.js";

export type ChannelProvider = "slack" | "discord" | "telegram";

const CHANNEL_PROVIDERS = new Set<ChannelProvider>(["slack", "discord", "telegram"]);

/** provider/channel 문자열에서 ChannelProvider를 추출. */
export function resolve_provider(msg: { provider?: string; channel?: string }): ChannelProvider | null {
  const raw = String(msg.provider || msg.channel || "").toLowerCase();
  return CHANNEL_PROVIDERS.has(raw as ChannelProvider) ? (raw as ChannelProvider) : null;
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

export type ChannelHealth = {
  provider: ChannelProvider;
  running: boolean;
  last_error?: string;
};

export type ChannelConfig = {
  provider: ChannelProvider;
  enabled?: boolean;
  default_chat_id?: string;
};

export interface ChatChannel {
  readonly provider: ChannelProvider;
  start(): Promise<void>;
  stop(): Promise<void>;
  is_running(): boolean;
  send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  edit_message(chat_id: string, message_id: string, content: string): Promise<{ ok: boolean; error?: string }>;
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
  set_typing(chat_id: string, typing: boolean, anchor_message_id?: string): Promise<void>;
  get_typing_state(chat_id: string): ChannelTypingState;
  parse_command(content: string): ChannelCommand | null;
  parse_agent_mentions(content: string): AgentMention[];
  /** 채널 플랫폼에 사용 가능한 커맨드 목록을 등록. */
  sync_commands(descriptors: CommandDescriptor[]): Promise<void>;
  get_health(): ChannelHealth;
}

export interface ChannelRegistryLike {
  start_all(): Promise<void>;
  stop_all(): Promise<void>;
  get_channel(provider: ChannelProvider): ChatChannel | null;
  list_channels(): Array<{ provider: ChannelProvider }>;
  send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  edit_message(provider: ChannelProvider, chat_id: string, message_id: string, content: string): Promise<{ ok: boolean; error?: string }>;
  add_reaction(provider: ChannelProvider, chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }>;
  remove_reaction(provider: ChannelProvider, chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }>;
  read(provider: ChannelProvider, chat_id: string, limit?: number): Promise<InboundMessage[]>;
  find_latest_agent_mention(
    provider: ChannelProvider,
    chat_id: string,
    agent_alias: string,
    limit?: number,
  ): Promise<InboundMessage | null>;
  set_typing(provider: ChannelProvider, chat_id: string, typing: boolean, anchor_message_id?: string): Promise<void>;
  get_typing_state(provider: ChannelProvider, chat_id: string): ChannelTypingState | null;
  get_health(): ChannelHealth[];
}

