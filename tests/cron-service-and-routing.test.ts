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
import { CronService } from "../src/cron/service.ts";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function remove_with_retry(path: string): Promise<void> {
  let last_error: unknown = null;
  for (let i = 0; i < 6; i += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      last_error = error;
      await sleep(40 * (i + 1));
    }
  }
  if (last_error) throw last_error;
}

test("cron service executes overdue one-shot immediately on start and removes it", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "cron-service-test-"));
  const store_root = join(workspace, "runtime", "cron");
  let executed = 0;
  const cron = new CronService(store_root, async () => {
    executed += 1;
    return "ok";
  }, {
    default_tick_ms: 20,
  });
  try {
    await cron.add_job(
      "overdue-once",
      { kind: "at", at_ms: Date.now() - 5_000 },
      "run once",
      false,
      "telegram",
      "chat-1",
      true,
    );
    await cron.start();
    await sleep(120);
    assert.equal(executed, 1);
    const rows = await cron.list_jobs(true);
    assert.equal(rows.length, 0);
  } finally {
    await cron.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("cron add intent with mention is handled by cron service without agent execution", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "cron-route-test-"));
  const bus = new MessageBus();
  const agent = new AgentDomain(workspace, { providers: null, bus });
  let agent_calls = 0;
  (agent.loop as unknown as {
    run_agent_loop: (...args: unknown[]) => Promise<{ state: Record<string, unknown>; final_content: string | null }>;
  }).run_agent_loop = async () => {
    agent_calls += 1;
    return {
      state: {
        status: "completed",
      },
      final_content: "agent-called",
    };
  };

  const cron_calls = { add: 0 };
  const cron_stub = {
    add_job: async (
      name: string,
      schedule: Record<string, unknown>,
      message: string,
      deliver: boolean,
      channel: string,
      to: string,
      delete_after_run: boolean,
    ) => {
      cron_calls.add += 1;
      return {
        id: "job-test-1",
        name,
        enabled: true,
        schedule,
        payload: {
          kind: "agent_turn",
          message,
          deliver,
          channel,
          to,
        },
        state: { next_run_at_ms: Date.now() + 60_000 },
        created_at_ms: Date.now(),
        updated_at_ms: Date.now(),
        delete_after_run,
      };
    },
    status: async () => ({ enabled: true, paused: false, jobs: 1, next_wake_at_ms: Date.now() + 60_000 }),
    list_jobs: async () => ([]),
    remove_job: async () => false,
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
    cron: cron_stub as unknown as CronService,
    auto_reply_on_plain_message: true,
  });

  try {
    await manager.handle_inbound_message(inbound("@assistant 1분 후 알림 물 마시기"));
    assert.equal(cron_calls.add, 1);
    assert.equal(agent_calls, 0);
    assert.equal(registry.sent.length > 0, true);
    const last = registry.sent[registry.sent.length - 1];
    assert.equal(String((last.metadata as Record<string, unknown>)?.kind || ""), "cron_quick");
    assert.match(String(last.content || ""), /cron 등록 완료/i);
  } finally {
    await manager.stop();
    await agent.stop();
    await remove_with_retry(workspace);
  }
});

test("cron natural relative add supports compact korean forms (N분후/N시간후)", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "cron-route-compact-test-"));
  const bus = new MessageBus();
  const agent = new AgentDomain(workspace, { providers: null, bus });
  let agent_calls = 0;
  (agent.loop as unknown as {
    run_agent_loop: (...args: unknown[]) => Promise<{ state: Record<string, unknown>; final_content: string | null }>;
  }).run_agent_loop = async () => {
    agent_calls += 1;
    return {
      state: {
        status: "completed",
      },
      final_content: "agent-called",
    };
  };

  const captured: Array<{ schedule: Record<string, unknown>; message: string }> = [];
  const cron_stub = {
    add_job: async (
      name: string,
      schedule: Record<string, unknown>,
      message: string,
      deliver: boolean,
      channel: string,
      to: string,
      delete_after_run: boolean,
    ) => {
      captured.push({ schedule, message });
      return {
        id: `job-${captured.length}`,
        name,
        enabled: true,
        schedule,
        payload: {
          kind: "agent_turn",
          message,
          deliver,
          channel,
          to,
        },
        state: { next_run_at_ms: Date.now() + 60_000 },
        created_at_ms: Date.now(),
        updated_at_ms: Date.now(),
        delete_after_run,
      };
    },
    status: async () => ({ enabled: true, paused: false, jobs: 1, next_wake_at_ms: Date.now() + 60_000 }),
    list_jobs: async () => ([]),
    remove_job: async () => false,
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
    cron: cron_stub as unknown as CronService,
    auto_reply_on_plain_message: true,
  });

  try {
    const start = Date.now();
    await manager.handle_inbound_message(inbound("@assistant 1분후 알림 물 마시기"));
    await manager.handle_inbound_message(inbound("@assistant 2시간후 알림 회의 준비"));
    assert.equal(captured.length, 2);
    assert.equal(agent_calls, 0);

    const first = captured[0]?.schedule || {};
    const second = captured[1]?.schedule || {};
    assert.equal(String(first.kind || ""), "at");
    assert.equal(String(second.kind || ""), "at");
    const first_delta = Number(first.at_ms || 0) - start;
    const second_delta = Number(second.at_ms || 0) - start;
    assert.equal(first_delta >= 50_000 && first_delta <= 120_000, true);
    assert.equal(second_delta >= 7_000_000 && second_delta <= 7_500_000, true);
  } finally {
    await manager.stop();
    await agent.stop();
    await remove_with_retry(workspace);
  }
});

test("cron natural add supports delayed interval form (N후 M간격으로)", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "cron-route-delayed-every-test-"));
  const bus = new MessageBus();
  const agent = new AgentDomain(workspace, { providers: null, bus });
  let agent_calls = 0;
  (agent.loop as unknown as {
    run_agent_loop: (...args: unknown[]) => Promise<{ state: Record<string, unknown>; final_content: string | null }>;
  }).run_agent_loop = async () => {
    agent_calls += 1;
    return {
      state: {
        status: "completed",
      },
      final_content: "agent-called",
    };
  };

  const captured: Array<{ schedule: Record<string, unknown>; message: string }> = [];
  const cron_stub = {
    add_job: async (
      name: string,
      schedule: Record<string, unknown>,
      message: string,
      deliver: boolean,
      channel: string,
      to: string,
      delete_after_run: boolean,
    ) => {
      captured.push({ schedule, message });
      return {
        id: `job-${captured.length}`,
        name,
        enabled: true,
        schedule,
        payload: {
          kind: "agent_turn",
          message,
          deliver,
          channel,
          to,
        },
        state: { next_run_at_ms: Date.now() + 60_000 },
        created_at_ms: Date.now(),
        updated_at_ms: Date.now(),
        delete_after_run,
      };
    },
    status: async () => ({ enabled: true, paused: false, jobs: 1, next_wake_at_ms: Date.now() + 60_000 }),
    list_jobs: async () => ([]),
    remove_job: async () => false,
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
    cron: cron_stub as unknown as CronService,
    auto_reply_on_plain_message: true,
  });

  try {
    const start = Date.now();
    await manager.handle_inbound_message(inbound("@assistant 1분후 30분간격으로 시스템 상태 점검 실행"));
    assert.equal(captured.length, 1);
    assert.equal(agent_calls, 0);
    const schedule = captured[0]?.schedule || {};
    assert.equal(String(schedule.kind || ""), "every");
    assert.equal(Number(schedule.every_ms || 0), 1_800_000);
    const first_run_delta = Number(schedule.at_ms || 0) - start;
    assert.equal(first_run_delta >= 50_000 && first_run_delta <= 120_000, true);
  } finally {
    await manager.stop();
    await agent.stop();
    await remove_with_retry(workspace);
  }
});
