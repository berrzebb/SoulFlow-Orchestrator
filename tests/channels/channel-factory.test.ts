/**
 * channel-factory — register/get/list/create_channel_instance 테스트.
 */
import { describe, it, expect } from "vitest";
import {
  register_channel_factory,
  get_channel_factory,
  list_registered_providers,
  create_channel_instance,
} from "../../src/channels/channel-factory.js";
import type { ChannelInstanceConfig } from "../../src/channels/instance-store.js";

function make_config(provider: string): ChannelInstanceConfig {
  return {
    instance_id: "test-1",
    provider,
    name: "Test Channel",
    settings: { default_channel: "#general", default_chat_id: "123" },
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ══════════════════════════════════════════
// 빌트인 팩토리 등록 확인
// ══════════════════════════════════════════

describe("channel-factory — 빌트인 등록", () => {
  it("slack 팩토리 등록됨", () => {
    expect(get_channel_factory("slack")).not.toBeNull();
  });

  it("discord 팩토리 등록됨", () => {
    expect(get_channel_factory("discord")).not.toBeNull();
  });

  it("telegram 팩토리 등록됨", () => {
    expect(get_channel_factory("telegram")).not.toBeNull();
  });

  it("대소문자 무관 조회", () => {
    expect(get_channel_factory("SLACK")).not.toBeNull();
    expect(get_channel_factory("Telegram")).not.toBeNull();
  });

  it("미등록 프로바이더 → null", () => {
    expect(get_channel_factory("nonexistent_provider_xyz")).toBeNull();
  });

  it("list_registered_providers에 빌트인 포함", () => {
    const providers = list_registered_providers();
    expect(providers).toContain("slack");
    expect(providers).toContain("discord");
    expect(providers).toContain("telegram");
  });
});

// ══════════════════════════════════════════
// register_channel_factory
// ══════════════════════════════════════════

describe("register_channel_factory()", () => {
  it("커스텀 팩토리 등록 후 get_channel_factory로 조회", () => {
    const factory_fn = () => ({ name: "custom" } as any);
    register_channel_factory("custom_test_provider", factory_fn);
    expect(get_channel_factory("custom_test_provider")).toBe(factory_fn);
  });

  it("대소문자 변환되어 저장", () => {
    const factory_fn = () => ({ name: "upper" } as any);
    register_channel_factory("UPPER_PROVIDER", factory_fn);
    expect(get_channel_factory("upper_provider")).toBe(factory_fn);
  });
});

// ══════════════════════════════════════════
// create_channel_instance
// ══════════════════════════════════════════

describe("create_channel_instance()", () => {
  it("미등록 프로바이더 → null", () => {
    const cfg = make_config("unknown_xyz");
    expect(create_channel_instance(cfg, "token")).toBeNull();
  });

  it("slack → SlackChannel 인스턴스 생성", () => {
    const cfg = make_config("slack");
    const instance = create_channel_instance(cfg, "xoxb-test-token");
    expect(instance).not.toBeNull();
    expect(instance).toBeDefined();
  });

  it("discord → DiscordChannel 인스턴스 생성", () => {
    const cfg = make_config("discord");
    const instance = create_channel_instance(cfg, "discord-bot-token");
    expect(instance).not.toBeNull();
  });

  it("telegram → TelegramChannel 인스턴스 생성", () => {
    const cfg = make_config("telegram");
    const instance = create_channel_instance(cfg, "telegram-bot-token");
    expect(instance).not.toBeNull();
  });
});
