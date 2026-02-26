import type { InboundMessage, OutboundMessage } from "../bus/types.js";

export type ChannelProvider = "slack" | "discord" | "telegram";

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
  read(chat_id: string, limit?: number): Promise<InboundMessage[]>;
  send_command(chat_id: string, command: string, args?: string[]): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  request_file(chat_id: string, prompt: string, accept?: string[]): Promise<FileRequestResult>;
  send_agent_mention(
    chat_id: string,
    from_alias: string,
    to_alias: string,
    message: string,
  ): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  set_typing(chat_id: string, typing: boolean): Promise<void>;
  get_typing_state(chat_id: string): ChannelTypingState;
  parse_command(content: string): ChannelCommand | null;
  parse_agent_mentions(content: string): AgentMention[];
  get_health(): ChannelHealth;
}

export interface ChannelRegistryLike {
  start_all(): Promise<void>;
  stop_all(): Promise<void>;
  get_channel(provider: ChannelProvider): ChatChannel | null;
  list_channels(): Array<{ provider: ChannelProvider }>;
  send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  read(provider: ChannelProvider, chat_id: string, limit?: number): Promise<InboundMessage[]>;
  find_latest_agent_mention(
    provider: ChannelProvider,
    chat_id: string,
    agent_alias: string,
    limit?: number,
  ): Promise<InboundMessage | null>;
  set_typing(provider: ChannelProvider, chat_id: string, typing: boolean): Promise<void>;
  get_typing_state(provider: ChannelProvider, chat_id: string): ChannelTypingState | null;
  get_health(): ChannelHealth[];
}

