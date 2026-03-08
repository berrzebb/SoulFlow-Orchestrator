/**
 * BaseChannel 추상 클래스 + channel-factory 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import type { InboundMessage, OutboundMessage } from "@src/bus/types.js";
import type { CommandDescriptor } from "@src/channels/commands/registry.js";
import { BaseChannel } from "@src/channels/base.js";
import {
  register_channel_factory,
  get_channel_factory,
  list_registered_providers,
  create_channel_instance,
} from "@src/channels/channel-factory.js";
import { is_known_provider, resolve_provider } from "@src/channels/types.js";

// ── 테스트용 구체 채널 ──
class TestChannel extends BaseChannel {
  sent_messages: OutboundMessage[] = [];
  typing_remote_calls: Array<{ chat_id: string; typing: boolean }> = [];
  send_ok = true;

  constructor(provider = "test", instance_id?: string) {
    super(provider, instance_id);
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    this.sent_messages.push(message);
    if (!this.send_ok) return { ok: false, error: "send_failed" };
    return { ok: true, message_id: "msg-1" };
  }

  async read(_chat_id: string, _limit?: number): Promise<InboundMessage[]> {
    return [];
  }

  protected async set_typing_remote(chat_id: string, typing: boolean): Promise<void> {
    this.typing_remote_calls.push({ chat_id, typing });
  }
}

class FailTypingChannel extends TestChannel {
  protected override async set_typing_remote(_chat_id: string, _typing: boolean): Promise<void> {
    throw new Error("typing network error");
  }
}

// ── BaseChannel 테스트 ──

describe("BaseChannel — 기본 프로퍼티 및 lifecycle", () => {
  it("provider/instance_id 초기화", () => {
    const ch = new TestChannel("slack", "inst-1");
    expect(ch.provider).toBe("slack");
    expect(ch.instance_id).toBe("inst-1");
  });

  it("instance_id 미지정 시 provider로 폴백", () => {
    const ch = new TestChannel("discord");
    expect(ch.instance_id).toBe("discord");
  });

  it("start() → is_running() true", async () => {
    const ch = new TestChannel();
    expect(ch.is_running()).toBe(false);
    await ch.start();
    expect(ch.is_running()).toBe(true);
  });

  it("stop() → is_running() false", async () => {
    const ch = new TestChannel();
    await ch.start();
    await ch.stop();
    expect(ch.is_running()).toBe(false);
  });
});

describe("BaseChannel — get_health()", () => {
  it("실행 중 → running=true", async () => {
    const ch = new TestChannel("test", "id-1");
    await ch.start();
    const h = ch.get_health();
    expect(h.running).toBe(true);
    expect(h.provider).toBe("test");
    expect(h.instance_id).toBe("id-1");
    expect(h.last_error).toBeUndefined();
  });

  it("오류 발생 후 → last_error 포함", async () => {
    const ch = new FailTypingChannel("test", "id-2");
    await ch.set_typing("room-1", true);
    const h = ch.get_health();
    expect(h.last_error).toContain("typing network error");
  });
});

describe("BaseChannel — set_typing / get_typing_state", () => {
  it("set_typing → typing_state 업데이트", async () => {
    const ch = new TestChannel();
    await ch.set_typing("room-a", true);
    const state = ch.get_typing_state("room-a");
    expect(state.typing).toBe(true);
    expect(state.chat_id).toBe("room-a");
    expect(typeof state.updated_at).toBe("string");
  });

  it("set_typing → set_typing_remote 호출됨", async () => {
    const ch = new TestChannel();
    await ch.set_typing("room-b", false);
    expect(ch.typing_remote_calls).toContainEqual({ chat_id: "room-b", typing: false });
  });

  it("set_typing: 빈 chat_id → 무시", async () => {
    const ch = new TestChannel();
    await ch.set_typing("", true);
    expect(ch.typing_remote_calls).toHaveLength(0);
  });

  it("get_typing_state: 없는 chat_id → 기본값 반환", () => {
    const ch = new TestChannel();
    const state = ch.get_typing_state("unknown-room");
    expect(state.chat_id).toBe("unknown-room");
    expect(state.typing).toBe(false);
  });

  it("set_typing_remote 예외 → last_error 기록, 예외 무시", async () => {
    const ch = new FailTypingChannel();
    await expect(ch.set_typing("room-c", true)).resolves.toBeUndefined();
    const h = ch.get_health();
    expect(h.last_error).toContain("typing network error");
  });
});

describe("BaseChannel — 기본 edit/reaction 반환", () => {
  it("edit_message → ok=false, edit_not_supported", async () => {
    const ch = new TestChannel();
    const r = await ch.edit_message("room", "msg-1", "new content");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("edit_not_supported");
  });

  it("add_reaction → ok=false, reactions_not_supported", async () => {
    const ch = new TestChannel();
    const r = await ch.add_reaction("room", "msg-1", "👍");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("reactions_not_supported");
  });

  it("remove_reaction → ok=false, reactions_not_supported", async () => {
    const ch = new TestChannel();
    const r = await ch.remove_reaction("room", "msg-1", "👎");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("reactions_not_supported");
  });
});

describe("BaseChannel — send_command()", () => {
  it("커맨드 전송 → /{command} 형식으로 send 호출", async () => {
    const ch = new TestChannel();
    const r = await ch.send_command("room-1", "help");
    expect(r.ok).toBe(true);
    expect(ch.sent_messages[0].content).toBe("/help");
    expect(ch.sent_messages[0].metadata?.kind).toBe("command");
  });

  it("args 포함 → 공백으로 결합", async () => {
    const ch = new TestChannel();
    await ch.send_command("room-1", "run", ["arg1", "arg2"]);
    expect(ch.sent_messages[0].content).toBe("/run arg1 arg2");
  });

  it("args 빈 배열 → 커맨드만", async () => {
    const ch = new TestChannel();
    await ch.send_command("room-1", "status", []);
    expect(ch.sent_messages[0].content).toBe("/status");
  });

  it("send 실패 → error 전파", async () => {
    const ch = new TestChannel();
    ch.send_ok = false;
    const r = await ch.send_command("room-1", "fail");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("send_failed");
  });
});

describe("BaseChannel — request_file()", () => {
  it("파일 요청 전송 성공", async () => {
    const ch = new TestChannel();
    const r = await ch.request_file("room-1", "파일을 업로드하세요", ["image/png"]);
    expect(r.ok).toBe(true);
    expect(r.request_id).toBeTruthy();
    expect(r.chat_id).toBe("room-1");
    expect(r.message).toBe("file request sent");
    expect(ch.sent_messages[0].metadata?.kind).toBe("file_request");
    expect(ch.sent_messages[0].content).toContain("FILE_REQUEST");
    expect(ch.sent_messages[0].content).toContain("image/png");
  });

  it("accept 없이 요청 → accepted_types 없음", async () => {
    const ch = new TestChannel();
    const r = await ch.request_file("room-1", "파일 올려주세요");
    expect(r.ok).toBe(true);
    expect(ch.sent_messages[0].content).not.toContain("accepted_types");
  });

  it("send 실패 → ok=false, error 반환", async () => {
    const ch = new TestChannel();
    ch.send_ok = false;
    const r = await ch.request_file("room-1", "업로드");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("send_failed");
    expect(r.message).toBeUndefined();
  });
});

describe("BaseChannel — send_agent_mention()", () => {
  it("에이전트 멘션 전송", async () => {
    const ch = new TestChannel();
    const r = await ch.send_agent_mention("room-1", "alice", "bob", "안녕!");
    expect(r.ok).toBe(true);
    expect(ch.sent_messages[0].content).toContain("[AGENT-MENTION]");
    expect(ch.sent_messages[0].content).toContain("@alice");
    expect(ch.sent_messages[0].content).toContain("@bob");
    expect(ch.sent_messages[0].metadata?.kind).toBe("agent_mention");
  });
});

describe("BaseChannel — parse_command()", () => {
  it("슬래시 커맨드 파싱", () => {
    const ch = new TestChannel();
    const cmd = ch.parse_command("/help me");
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("help");
  });

  it("슬래시 없으면 null", () => {
    const ch = new TestChannel();
    expect(ch.parse_command("일반 텍스트")).toBeNull();
  });
});

describe("BaseChannel — parse_agent_mentions()", () => {
  it("@alias 멘션 파싱", () => {
    const ch = new TestChannel();
    const mentions = ch.parse_agent_mentions("@alice @bob 안녕");
    const aliases = mentions.map((m) => m.alias);
    expect(aliases).toContain("alice");
    expect(aliases).toContain("bob");
  });

  it("<@slack-id> 형식 파싱", () => {
    const ch = new TestChannel();
    const mentions = ch.parse_agent_mentions("<@U12345> hello");
    expect(mentions[0].alias).toBe("U12345");
  });

  it("중복 멘션 → 단일 결과", () => {
    const ch = new TestChannel();
    const mentions = ch.parse_agent_mentions("@alice @alice");
    const aliases = mentions.map((m) => m.alias);
    expect(aliases.filter((a) => a === "alice")).toHaveLength(1);
  });

  it("빈 텍스트 → 빈 배열", () => {
    const ch = new TestChannel();
    expect(ch.parse_agent_mentions("")).toHaveLength(0);
  });
});

describe("BaseChannel — sync_commands()", () => {
  it("기본 no-op → 예외 없이 완료", async () => {
    const ch = new TestChannel();
    await expect(ch.sync_commands([] as CommandDescriptor[])).resolves.toBeUndefined();
  });
});

describe("BaseChannel — split_text_chunks() (protected, 간접 테스트)", () => {
  // split_text_chunks는 protected이지만 subclass에서 호출 가능
  class SplittingChannel extends TestChannel {
    public chunk(text: string, max: number): string[] {
      return this.split_text_chunks(text, max);
    }
  }

  it("짧은 텍스트 → 단일 청크", () => {
    const ch = new SplittingChannel();
    const chunks = ch.chunk("hello world", 3500);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("hello world");
  });

  it("긴 텍스트 → 여러 청크", () => {
    const ch = new SplittingChannel();
    const long = "a".repeat(2000);
    const chunks = ch.chunk(long, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("").length).toBeLessThanOrEqual(2000);
  });

  it("빈 텍스트 → 빈 또는 단일 빈 청크", () => {
    const ch = new SplittingChannel();
    const result = ch.chunk("", 3500);
    // 빈 텍스트는 [""] 반환(length<=max 조건)하거나 빈 배열 반환
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it("개행 문자 경계에서 분할", () => {
    const ch = new SplittingChannel();
    const line = "line\n".repeat(200);
    const chunks = ch.chunk(line, 100);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("max_chars < 500 → 500으로 클램프", () => {
    const ch = new SplittingChannel();
    const text = "x".repeat(600);
    const chunks = ch.chunk(text, 100); // 100 → 클램프 → 500
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ── channel-factory 테스트 ──

describe("channel-factory — register/get/list/create", () => {
  it("빌트인 팩토리(slack/discord/telegram) 기본 등록됨", () => {
    const providers = list_registered_providers();
    expect(providers).toContain("slack");
    expect(providers).toContain("discord");
    expect(providers).toContain("telegram");
  });

  it("get_channel_factory: 등록된 provider → 함수 반환", () => {
    const factory = get_channel_factory("slack");
    expect(typeof factory).toBe("function");
  });

  it("get_channel_factory: 미등록 provider → null", () => {
    expect(get_channel_factory("nonexistent_xyz")).toBeNull();
  });

  it("get_channel_factory: 대소문자 무관", () => {
    const factory = get_channel_factory("SLACK");
    expect(factory).not.toBeNull();
  });

  it("register_channel_factory: 새 팩토리 등록 후 조회", () => {
    const mock_factory = vi.fn().mockReturnValue(new TestChannel("custom-prov"));
    register_channel_factory("custom-prov", mock_factory);
    expect(get_channel_factory("custom-prov")).toBe(mock_factory);
  });

  it("create_channel_instance: 등록된 provider → 채널 인스턴스 반환", () => {
    register_channel_factory("test-factory", (_cfg, _token) => new TestChannel("test-factory"));
    const config = {
      instance_id: "inst-1",
      provider: "test-factory",
      label: "Test",
      bot_token_secret: "",
      settings: {},
      enabled: true,
    };
    const ch = create_channel_instance(config, "token-xxx");
    expect(ch).not.toBeNull();
    expect(ch!.provider).toBe("test-factory");
  });

  it("create_channel_instance: 미등록 provider → null", () => {
    const config = {
      instance_id: "inst-2",
      provider: "totally-unknown-xyz",
      label: "X",
      bot_token_secret: "",
      settings: {},
      enabled: true,
    };
    expect(create_channel_instance(config, "token")).toBeNull();
  });
});

// ── types 헬퍼 테스트 ──

describe("types — is_known_provider / resolve_provider", () => {
  it("is_known_provider: 빌트인 프로바이더 → true", () => {
    expect(is_known_provider("slack")).toBe(true);
    expect(is_known_provider("discord")).toBe(true);
    expect(is_known_provider("telegram")).toBe(true);
    expect(is_known_provider("web")).toBe(true);
  });

  it("is_known_provider: 미등록 → false", () => {
    expect(is_known_provider("whatsapp")).toBe(false);
  });

  it("is_known_provider: 대소문자 무관", () => {
    expect(is_known_provider("SLACK")).toBe(true);
  });

  it("resolve_provider: provider 필드 추출", () => {
    expect(resolve_provider({ provider: "slack" })).toBe("slack");
  });

  it("resolve_provider: channel 폴백", () => {
    expect(resolve_provider({ channel: "discord" })).toBe("discord");
  });

  it("resolve_provider: 빈 객체 → null", () => {
    expect(resolve_provider({})).toBeNull();
  });
});
