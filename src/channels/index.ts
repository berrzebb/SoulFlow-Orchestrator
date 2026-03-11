import type { InboundMessage, OutboundMessage } from "../bus/types.js";
import type { ChannelHealth, ChannelRegistryLike, ChannelTypingState, ChatChannel } from "./types.js";
import type { ChannelInstanceStore } from "./instance-store.js";
import { create_channel_instance } from "./channel-factory.js";

export type {
  ChannelConfig,
  ChannelHealth,
  ChannelProvider,
  ChannelRegistryLike,
  ChannelTypingState,
  ChatChannel,
} from "./types.js";
export { BaseChannel } from "./base.js";
export { SlackChannel } from "./slack.channel.js";
export { DiscordChannel } from "./discord.channel.js";
export { TelegramChannel } from "./telegram.channel.js";
export { ChannelManager } from "./manager.js";
export { SqliteDispatchDlqStore, type DispatchDlqStoreLike, type DispatchDlqRecord } from "./dlq-store.js";
export type { ChannelManagerStatus } from "./manager.js";
export { ChannelInstanceStore, type ChannelInstanceConfig, type CreateChannelInstanceInput } from "./instance-store.js";
export { create_channel_instance, register_channel_factory, list_registered_providers } from "./channel-factory.js";

/**
 * instance_id 기반 채널 레지스트리.
 * 같은 프로바이더의 다중 인스턴스를 지원하며,
 * 기존 provider 기반 API와 후방 호환.
 */
export class ChannelRegistry implements ChannelRegistryLike {
  private readonly channels = new Map<string, ChatChannel>();

  register(channel: ChatChannel): void {
    this.channels.set(channel.instance_id, channel);
  }

  unregister(instance_id: string): boolean {
    return this.channels.delete(instance_id);
  }

  /** instance_id로 조회. 폴백: provider명으로 첫 번째 일치 반환. */
  get_channel(id: string): ChatChannel | null {
    const direct = this.channels.get(id);
    if (direct) return direct;
    for (const ch of this.channels.values()) {
      if (ch.provider === id) return ch;
    }
    return null;
  }

  get_channels_by_provider(provider: string): ChatChannel[] {
    const lower = provider.toLowerCase();
    return [...this.channels.values()].filter((ch) => ch.provider.toLowerCase() === lower);
  }

  list_channels(): Array<{ provider: string; instance_id: string }> {
    return [...this.channels.values()].map((ch) => ({ provider: ch.provider, instance_id: ch.instance_id }));
  }

  async start_all(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.start();
    }
  }

  async stop_all(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
  }

  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const id = String(message.instance_id || message.provider || message.channel || "").toLowerCase();
    const channel = this.get_channel(id);
    if (!channel) return { ok: false, error: `channel_not_registered:${id}` };
    return channel.send(message);
  }

  async edit_message(id: string, chat_id: string, message_id: string, content: string, parse_mode?: string): Promise<{ ok: boolean; error?: string }> {
    const channel = this.get_channel(id);
    if (!channel) return { ok: false, error: `channel_not_registered:${id}` };
    return channel.edit_message(chat_id, message_id, content, parse_mode);
  }

  async add_reaction(id: string, chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    const channel = this.get_channel(id);
    if (!channel) return { ok: false, error: `channel_not_registered:${id}` };
    return channel.add_reaction(chat_id, message_id, reaction);
  }

  async remove_reaction(id: string, chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    const channel = this.get_channel(id);
    if (!channel) return { ok: false, error: `channel_not_registered:${id}` };
    return channel.remove_reaction(chat_id, message_id, reaction);
  }

  async read(id: string, chat_id: string, limit?: number): Promise<InboundMessage[]> {
    const channel = this.get_channel(id);
    if (!channel) return [];
    return channel.read(chat_id, limit);
  }

  async find_latest_agent_mention(
    id: string,
    chat_id: string,
    agent_alias: string,
    limit = 50,
  ): Promise<InboundMessage | null> {
    const channel = this.get_channel(id);
    if (!channel) return null;
    const rows = await channel.read(chat_id, Math.max(1, Math.min(200, limit)));
    const needle = `@${agent_alias}`.toLowerCase();
    for (const row of rows) {
      const content = String(row.content || "");
      const mentions = channel.parse_agent_mentions(content).map((m) => m.raw.toLowerCase());
      if (mentions.includes(needle)) return row;
    }
    return null;
  }

  async set_typing(id: string, chat_id: string, typing: boolean, anchor_message_id?: string): Promise<void> {
    const channel = this.get_channel(id);
    if (!channel) return;
    await channel.set_typing(chat_id, typing, anchor_message_id);
  }

  get_typing_state(id: string, chat_id: string): ChannelTypingState | null {
    const channel = this.get_channel(id);
    if (!channel) return null;
    return channel.get_typing_state(chat_id);
  }

  async send_poll(id: string, poll: import("./types.js").SendPollRequest): Promise<import("./types.js").SendPollResult> {
    const channel = this.get_channel(id);
    if (!channel) return { ok: false, error: "channel_not_found" };
    return channel.send_poll(poll);
  }

  get_health(): ChannelHealth[] {
    return [...this.channels.values()].map((channel) => channel.get_health());
  }
}

/** instance store 기반으로 채널 레지스트리 구성. */
export async function create_channels_from_store(
  store: ChannelInstanceStore,
): Promise<ChannelRegistry> {
  const registry = new ChannelRegistry();
  const instances = store.list();

  for (const config of instances) {
    if (!config.enabled) continue;
    const token = await store.get_token(config.instance_id) || "";
    const channel = create_channel_instance(config, token);
    if (channel) registry.register(channel);
  }

  return registry;
}
