/**
 * ChannelFactory — 프로바이더명으로 ChatChannel 인스턴스를 생성하는 팩토리 레지스트리.
 * 빌트인(slack, discord, telegram) 팩토리를 기본 등록하고,
 * 동적 프로바이더는 register_channel_factory()로 추가 가능.
 */

import type { ChatChannel } from "./types.js";
import type { ChannelInstanceConfig } from "./instance-store.js";
import { SlackChannel } from "./slack.channel.js";
import { DiscordChannel } from "./discord.channel.js";
import { TelegramChannel } from "./telegram.channel.js";

export type ChannelFactoryFn = (config: ChannelInstanceConfig, token: string) => ChatChannel;

const FACTORIES = new Map<string, ChannelFactoryFn>();

export function register_channel_factory(provider: string, factory: ChannelFactoryFn): void {
  FACTORIES.set(provider.toLowerCase(), factory);
}

export function get_channel_factory(provider: string): ChannelFactoryFn | null {
  return FACTORIES.get(provider.toLowerCase()) || null;
}

export function list_registered_providers(): string[] {
  return [...FACTORIES.keys()];
}

/** ChannelInstanceConfig + 토큰으로 ChatChannel 인스턴스 생성. */
export function create_channel_instance(config: ChannelInstanceConfig, token: string): ChatChannel | null {
  const factory = FACTORIES.get(config.provider.toLowerCase());
  if (!factory) return null;
  return factory(config, token);
}

// ── 빌트인 팩토리 등록 ──

register_channel_factory("slack", (config, token) => {
  const settings = config.settings as Record<string, unknown>;
  return new SlackChannel({
    instance_id: config.instance_id,
    bot_token: token,
    default_channel: String(settings.default_channel || ""),
    settings,
  });
});

register_channel_factory("discord", (config, token) => {
  const settings = config.settings as Record<string, unknown>;
  return new DiscordChannel({
    instance_id: config.instance_id,
    bot_token: token,
    default_channel: String(settings.default_channel || ""),
    api_base: String(settings.api_base || "https://discord.com/api/v10"),
  });
});

register_channel_factory("telegram", (config, token) => {
  const settings = config.settings as Record<string, unknown>;
  return new TelegramChannel({
    instance_id: config.instance_id,
    bot_token: token,
    default_chat_id: String(settings.default_chat_id || ""),
    api_base: String(settings.api_base || "https://api.telegram.org"),
    settings,
  });
});
