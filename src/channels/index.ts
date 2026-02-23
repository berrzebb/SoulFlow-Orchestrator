import type { InboundMessage, OutboundMessage } from "../bus/types.js";
import { DiscordChannel } from "./discord.channel.js";
import { SlackChannel } from "./slack.channel.js";
import { TelegramChannel } from "./telegram.channel.js";
import type { ChannelHealth, ChannelProvider, ChannelRef, ChannelTypingState, ChatChannel } from "./types.js";

export type {
  ChannelConfig,
  ChannelHealth,
  ChannelProvider,
  ChannelRef,
  ChannelTypingState,
  ChatChannel,
} from "./types.js";
export { BaseChannel } from "./base.js";
export { SlackChannel } from "./slack.channel.js";
export { DiscordChannel } from "./discord.channel.js";
export { TelegramChannel } from "./telegram.channel.js";
export { ChannelManager } from "./manager.js";
export type { ChannelManagerStatus } from "./manager.js";

export class ChannelRegistry {
  private readonly refs = new Map<string, ChannelRef>();
  private readonly channels = new Map<ChannelProvider, ChatChannel>();

  set(key: string, ref: ChannelRef): void {
    this.refs.set(key, ref);
  }

  get(key: string): ChannelRef | null {
    return this.refs.get(key) || null;
  }

  register(channel: ChatChannel): void {
    this.channels.set(channel.provider, channel);
  }

  get_channel(provider: ChannelProvider): ChatChannel | null {
    return this.channels.get(provider) || null;
  }

  list_channels(): ChatChannel[] {
    return [...this.channels.values()];
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

  async send(provider: ChannelProvider, message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const channel = this.channels.get(provider);
    if (!channel) return { ok: false, error: `channel_not_registered:${provider}` };
    return channel.send(message);
  }

  async read(provider: ChannelProvider, chat_id: string, limit?: number): Promise<InboundMessage[]> {
    const channel = this.channels.get(provider);
    if (!channel) return [];
    return channel.read(chat_id, limit);
  }

  async find_latest_agent_mention(
    provider: ChannelProvider,
    chat_id: string,
    agent_alias: string,
    limit = 50,
  ): Promise<InboundMessage | null> {
    const channel = this.channels.get(provider);
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

  async reply_as_agent(
    provider: ChannelProvider,
    chat_id: string,
    agent_alias: string,
    content: string,
    options?: {
      mention_sender?: boolean;
      sender_alias?: string;
      limit?: number;
      media?: OutboundMessage["media"];
    },
  ): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const channel = this.channels.get(provider);
    if (!channel) return { ok: false, error: `channel_not_registered:${provider}` };
    const trigger = await this.find_latest_agent_mention(provider, chat_id, agent_alias, options?.limit || 50);
    const sender_alias = options?.sender_alias || (trigger?.sender_id || "");
    const mention_prefix = options?.mention_sender && sender_alias ? `@${sender_alias} ` : "";
    const message: OutboundMessage = {
      id: `${provider}-${Date.now()}`,
      provider,
      channel: provider,
      sender_id: agent_alias,
      chat_id,
      content: `${mention_prefix}${content}`.trim(),
      at: new Date().toISOString(),
      reply_to: this.resolve_reply_to(provider, trigger),
      thread_id: trigger?.thread_id,
      media: options?.media || [],
      metadata: {
        kind: "agent_reply",
        agent_alias,
        trigger_message_id: String(trigger?.metadata?.message_id || trigger?.id || ""),
      },
    };
    return channel.send(message);
  }

  private resolve_reply_to(provider: ChannelProvider, trigger: InboundMessage | null): string {
    if (!trigger) return "";
    const meta = (trigger.metadata || {}) as Record<string, unknown>;
    if (provider === "slack") {
      const thread_ts = String(trigger.thread_id || "").trim();
      if (thread_ts) return thread_ts;
      return String(meta.message_id || trigger.id || "").trim();
    }
    if (provider === "telegram") {
      const telegram_message_id = String(meta.telegram_message_id || "").trim();
      if (telegram_message_id) return telegram_message_id;
      return String(meta.message_id || trigger.id || "").trim();
    }
    return String(meta.message_id || trigger.id || "").trim();
  }

  async set_typing(provider: ChannelProvider, chat_id: string, typing: boolean): Promise<void> {
    const channel = this.channels.get(provider);
    if (!channel) return;
    await channel.set_typing(chat_id, typing);
  }

  get_typing_state(provider: ChannelProvider, chat_id: string): ChannelTypingState | null {
    const channel = this.channels.get(provider);
    if (!channel) return null;
    return channel.get_typing_state(chat_id);
  }

  get_health(): ChannelHealth[] {
    return [...this.channels.values()].map((channel) => channel.get_health());
  }
}

export function create_default_channels(provider_hint?: string): ChannelRegistry {
  return create_channels_from_config({
    provider_hint,
    channels: {
      slack: {
        enabled: true,
        bot_token: process.env.SLACK_BOT_TOKEN || "",
        default_channel: process.env.SLACK_DEFAULT_CHANNEL || "",
      },
      discord: {
        enabled: true,
        bot_token: process.env.DISCORD_BOT_TOKEN || "",
        default_channel: process.env.DISCORD_DEFAULT_CHANNEL || "",
        api_base: process.env.DISCORD_API_BASE || "https://discord.com/api/v10",
      },
      telegram: {
        enabled: true,
        bot_token: process.env.TELEGRAM_BOT_TOKEN || "",
        default_chat_id: process.env.TELEGRAM_DEFAULT_CHAT_ID || "",
        api_base: process.env.TELEGRAM_API_BASE || "https://api.telegram.org",
      },
    },
  });
}

export function create_channels_from_config(args: {
  provider_hint?: string;
  channels: {
    slack: { enabled: boolean; bot_token: string; default_channel: string };
    discord: { enabled: boolean; bot_token: string; default_channel: string; api_base: string };
    telegram: { enabled: boolean; bot_token: string; default_chat_id: string; api_base: string };
  };
}): ChannelRegistry {
  const registry = new ChannelRegistry();
  const hint = String(args.provider_hint || process.env.CHANNEL_PROVIDER || "").toLowerCase();
  const slack = new SlackChannel({
    bot_token: args.channels.slack.bot_token,
    default_channel: args.channels.slack.default_channel,
  });
  const discord = new DiscordChannel({
    bot_token: args.channels.discord.bot_token,
    default_channel: args.channels.discord.default_channel,
    api_base: args.channels.discord.api_base,
  });
  const telegram = new TelegramChannel({
    bot_token: args.channels.telegram.bot_token,
    default_chat_id: args.channels.telegram.default_chat_id,
    api_base: args.channels.telegram.api_base,
  });

  const register_if_enabled = (provider: ChannelProvider): void => {
    if (provider === "slack" && args.channels.slack.enabled) registry.register(slack);
    if (provider === "discord" && args.channels.discord.enabled) registry.register(discord);
    if (provider === "telegram" && args.channels.telegram.enabled) registry.register(telegram);
  };
  // Multi-channel is the default behavior.
  // provider_hint is kept for compatibility but no longer limits channel registration.
  if (hint === "slack" || hint === "discord" || hint === "telegram") {
    register_if_enabled(hint);
  }
  register_if_enabled("slack");
  register_if_enabled("discord");
  register_if_enabled("telegram");
  return registry;
}
