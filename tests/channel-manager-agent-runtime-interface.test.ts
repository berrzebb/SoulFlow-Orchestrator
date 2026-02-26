import assert from "node:assert/strict";
import test from "node:test";
import { MessageBus } from "../src/bus/index.ts";
import type { InboundMessage, OutboundMessage } from "../src/bus/types.ts";
import { ChannelManager } from "../src/channels/manager.ts";
import type { ChannelProvider } from "../src/channels/types.ts";
import type { AgentRuntimeLike } from "../src/agent/runtime.types.ts";
import { LlmResponse } from "../src/providers/types.ts";

class FakeChannelRegistry {
  readonly sent: OutboundMessage[] = [];

  async start_all(): Promise<void> {
    // no-op
  }

  async stop_all(): Promise<void> {
    // no-op
  }

  list_channels(): Array<{ provider: ChannelProvider }> {
    return [{ provider: "telegram" }];
  }

  get_channel(): null {
    return null;
  }

  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id: string }> {
    this.sent.push(message);
    return { ok: true, message_id: String(this.sent.length) };
  }

  async read(): Promise<InboundMessage[]> {
    return [];
  }

  async find_latest_agent_mention(): Promise<InboundMessage | null> {
    return null;
  }

  async set_typing(): Promise<void> {
    // no-op
  }
}

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

function completed_state(): Record<string, unknown> {
  return {
    loopId: "loop-test",
    agentId: "assistant",
    objective: "test",
    currentTurn: 1,
    maxTurns: 1,
    checkShouldContinue: false,
    status: "completed",
    terminationReason: "done",
  };
}

test("channel manager can run with injected agent runtime interface", async () => {
  const bus = new MessageBus();
  const registry = new FakeChannelRegistry();
  const seen: { tool_context?: Record<string, unknown>; task_id?: string } = {};

  const runtime: AgentRuntimeLike = {
    get_context_builder: () => ({ build_messages: async () => [] } as never),
    get_always_skills: () => [],
    recommend_skills: () => [],
    has_tool: () => true,
    register_tool: () => undefined,
    get_tool_definitions: () => [],
    apply_tool_runtime_context: (context) => {
      seen.tool_context = {
        channel: context.channel,
        chat_id: context.chat_id,
      };
    },
    execute_tool: async (_name, _params, context) => {
      seen.task_id = String(context?.task_id || "");
      return "RUNTIME_OK";
    },
    append_daily_memory: async () => undefined,
    list_approval_requests: () => [],
    get_approval_request: () => null,
    resolve_approval_request: () => ({
      ok: false,
      decision: "unknown",
      status: "pending",
      confidence: 0,
    }),
    execute_approved_request: async () => ({
      ok: false,
      status: "unknown",
      error: "not_supported",
    }),
    run_agent_loop: async (options) => {
      const output = await options.on_tool_calls?.({
        state: completed_state() as never,
        tool_calls: [
          {
            id: "call-read-file-1",
            name: "read_file",
            arguments: { path: "README.md" },
          },
        ],
        response: new LlmResponse({ content: null }),
      });
      return {
        state: completed_state() as never,
        final_content: output || "EMPTY",
      };
    },
    run_task_loop: async () => ({
      state: {
        taskId: "task-1",
        title: "task",
        currentTurn: 1,
        maxTurns: 1,
        status: "completed",
        memory: {},
      },
    }),
  };

  const manager = new ChannelManager({
    bus,
    registry,
    providers: {} as never,
    agent: null,
    agent_runtime: runtime,
    auto_reply_on_plain_message: true,
  });

  await manager.handle_inbound_message(inbound("인터페이스 기반 실행 테스트"));

  assert.equal(String(seen.tool_context?.channel || ""), "telegram");
  assert.equal(String(seen.tool_context?.chat_id || ""), "chat-1");
  assert.match(String(seen.task_id || ""), /adhoc:telegram:chat-1:assistant:/i);
  assert.equal(registry.sent.length > 0, true);
  assert.match(String(registry.sent[registry.sent.length - 1]?.content || ""), /RUNTIME_OK/);
});

test("approval reply path works with runtime interface only", async () => {
  const bus = new MessageBus();
  const registry = new FakeChannelRegistry();
  let execute_called = 0;

  const runtime: AgentRuntimeLike = {
    get_context_builder: () => ({ build_messages: async () => [] } as never),
    get_always_skills: () => [],
    recommend_skills: () => [],
    has_tool: () => true,
    register_tool: () => undefined,
    get_tool_definitions: () => [],
    apply_tool_runtime_context: () => undefined,
    execute_tool: async () => "ok",
    append_daily_memory: async () => undefined,
    list_approval_requests: () => [
      {
        request_id: "req-approve-1",
        tool_name: "exec",
        params: {},
        created_at: new Date().toISOString(),
        status: "pending",
        context: {
          channel: "telegram",
          chat_id: "chat-1",
        },
      },
    ],
    get_approval_request: () => ({
      request_id: "req-approve-1",
      tool_name: "exec",
      params: {},
      created_at: new Date().toISOString(),
      status: "pending",
      context: {
        channel: "telegram",
        chat_id: "chat-1",
      },
    }),
    resolve_approval_request: () => ({
      ok: true,
      decision: "approve",
      status: "approved",
      confidence: 1,
    }),
    execute_approved_request: async () => {
      execute_called += 1;
      return {
        ok: true,
        status: "approved",
        tool_name: "exec",
        result: "APPROVED_OK",
      };
    },
    run_agent_loop: async () => ({
      state: completed_state() as never,
      final_content: "ok",
    }),
    run_task_loop: async () => ({
      state: {
        taskId: "task-1",
        title: "task",
        currentTurn: 1,
        maxTurns: 1,
        status: "completed",
        memory: {},
      },
    }),
  };

  const manager = new ChannelManager({
    bus,
    registry,
    providers: {} as never,
    agent: null,
    agent_runtime: runtime,
    auto_reply_on_plain_message: true,
  });

  await manager.handle_inbound_message(inbound("✅ request_id:req-approve-1"));
  assert.equal(execute_called, 1);
  const approval = registry.sent.find((row) =>
    String((row.metadata as Record<string, unknown> | undefined)?.kind || "") === "approval_result"
  );
  assert.equal(Boolean(approval), true);
  assert.match(String(approval?.content || ""), /승인 반영 완료|APPROVED_OK/i);
});
