import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentDomain } from "../src/agent/index.ts";
import { MessageBus } from "../src/bus/index.ts";
import type { InboundMessage, OutboundMessage } from "../src/bus/types.ts";
import { ChannelManager } from "../src/channels/manager.ts";
import type { ChannelProvider } from "../src/channels/types.ts";

type FakeRegistry = {
  sent: OutboundMessage[];
  start_all: () => Promise<void>;
  stop_all: () => Promise<void>;
  list_channels: () => Array<{ provider: "telegram" }>;
  get_channel: () => null;
  send: (message: OutboundMessage) => Promise<{ ok: boolean; message_id: string }>;
  read: (_provider: "telegram", _chat_id: string) => Promise<InboundMessage[]>;
  find_latest_agent_mention: (
    _provider: ChannelProvider,
    _chat_id: string,
    _agent_alias: string,
    _limit?: number,
  ) => Promise<InboundMessage | null>;
  set_typing: (_provider: "telegram", _chat_id: string, _typing: boolean) => Promise<void>;
};

function inbound(content: string): InboundMessage {
  const id = `msg-${Date.now()}`;
  return {
    id,
    provider: "telegram",
    channel: "telegram",
    sender_id: "user-1",
    chat_id: "chat-1",
    content,
    at: new Date().toISOString(),
    media: [],
    metadata: {
      message_id: id,
    },
  };
}

test("memory status command is handled by orchestrator without agent loop", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "orch-memory-direct-test-"));
  const bus = new MessageBus();
  const agent = new AgentDomain(workspace, { providers: null, bus });
  let agent_calls = 0;
  (agent.loop as unknown as {
    run_agent_loop: (...args: unknown[]) => Promise<{ state: Record<string, unknown>; final_content: string | null }>;
  }).run_agent_loop = async () => {
    agent_calls += 1;
    return {
      state: { status: "completed" },
      final_content: "agent-called",
    };
  };

  await agent.context.memory_store.append_daily("- 상태 점검 완료\n", "2026-02-26");

  const registry: FakeRegistry = {
    sent: [],
    start_all: async () => undefined,
    stop_all: async () => undefined,
    list_channels: () => [{ provider: "telegram" }],
    get_channel: () => null,
    send: async (message) => {
      registry.sent.push(message);
      return { ok: true, message_id: String(registry.sent.length) };
    },
    read: async () => [],
    find_latest_agent_mention: async () => null,
    set_typing: async () => undefined,
  };

  const manager = new ChannelManager({
    bus,
    registry,
    providers: {} as never,
    agent,
    auto_reply_on_plain_message: true,
  });

  try {
    await manager.handle_inbound_message(inbound("@assistant 메모리 상태 확인"));
    assert.equal(agent_calls, 0);
    assert.equal(registry.sent.length > 0, true);
    const last = registry.sent[registry.sent.length - 1];
    assert.equal(String((last.metadata as Record<string, unknown>)?.kind || ""), "command_memory");
    assert.match(String(last.content || ""), /메모리 상태/i);
  } finally {
    await manager.stop();
    await agent.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("decision set/status commands are handled by orchestrator without agent loop", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "orch-decision-direct-test-"));
  const bus = new MessageBus();
  const agent = new AgentDomain(workspace, { providers: null, bus });
  let agent_calls = 0;
  (agent.loop as unknown as {
    run_agent_loop: (...args: unknown[]) => Promise<{ state: Record<string, unknown>; final_content: string | null }>;
  }).run_agent_loop = async () => {
    agent_calls += 1;
    return {
      state: { status: "completed" },
      final_content: "agent-called",
    };
  };

  const registry: FakeRegistry = {
    sent: [],
    start_all: async () => undefined,
    stop_all: async () => undefined,
    list_channels: () => [{ provider: "telegram" }],
    get_channel: () => null,
    send: async (message) => {
      registry.sent.push(message);
      return { ok: true, message_id: String(registry.sent.length) };
    },
    read: async () => [],
    find_latest_agent_mention: async () => null,
    set_typing: async () => undefined,
  };

  const manager = new ChannelManager({
    bus,
    registry,
    providers: {} as never,
    agent,
    auto_reply_on_plain_message: true,
  });

  try {
    await manager.handle_inbound_message(inbound("/decision set language 한국어 우선"));
    await manager.handle_inbound_message(inbound("@assistant 현재 지침은?"));
    assert.equal(agent_calls, 0);
    assert.equal(registry.sent.length >= 2, true);
    const last = registry.sent[registry.sent.length - 1];
    assert.equal(String((last.metadata as Record<string, unknown>)?.kind || ""), "command_decision");
    assert.match(String(last.content || ""), /language/i);
    assert.match(String(last.content || ""), /한국어 우선/i);
  } finally {
    await manager.stop();
    await agent.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

