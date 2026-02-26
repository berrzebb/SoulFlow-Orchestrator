import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRuntimeLike } from "../src/agent/runtime.types.ts";
import type { OutboundMessage } from "../src/bus/types.ts";
import { create_cron_job_handler } from "../src/cron/runtime-handler.ts";
import type { CronJob } from "../src/cron/types.ts";

function make_job(overrides?: Partial<CronJob>): CronJob {
  const now = Date.now();
  return {
    id: "job-1",
    name: "test-job",
    enabled: true,
    schedule: { kind: "at", at_ms: now + 60_000 },
    payload: {
      kind: "agent_turn",
      message: "do something",
      deliver: false,
      channel: "telegram",
      to: "chat-1",
    },
    state: {
      next_run_at_ms: now + 60_000,
      last_run_at_ms: null,
      last_status: null,
      last_error: null,
      running: false,
      running_started_at_ms: null,
    },
    created_at_ms: now,
    updated_at_ms: now,
    delete_after_run: true,
    ...overrides,
  };
}

function make_agent_runtime(final_content: string | null): AgentRuntimeLike {
  return {
    get_context_builder: () => ({ build: () => "" }) as never,
    get_always_skills: () => [],
    recommend_skills: () => [],
    has_tool: () => false,
    register_tool: () => undefined,
    get_tool_definitions: () => [],
    apply_tool_runtime_context: () => undefined,
    execute_tool: async () => "",
    append_daily_memory: async () => undefined,
    list_approval_requests: () => [],
    get_approval_request: () => null,
    resolve_approval_request: () => ({ ok: false, decision: "unknown", status: "pending", confidence: 0 }),
    execute_approved_request: async () => ({ ok: false, status: "unknown" }),
    run_agent_loop: async () => ({
      state: {
        loopId: "loop-1",
        agentId: "assistant",
        objective: "test",
        currentTurn: 1,
        maxTurns: 1,
        checkShouldContinue: false,
        status: "completed",
      },
      final_content,
    }) as never,
    run_task_loop: async () => ({ state: {} as never }),
  };
}

test("cron runtime handler sends fallback done notice when agent output is empty", async () => {
  const sent: OutboundMessage[] = [];
  const handler = create_cron_job_handler({
    config: {
      provider: "telegram",
      channels: {
        slack: { bot_token: "", default_channel: "" },
        discord: { bot_token: "", app_id: "", public_key: "", default_channel: "" },
        telegram: { bot_token: "", default_chat_id: "chat-1", allowed_chat_ids: [] },
      },
      workspace: ".",
      commands: {
        codex: "codex",
        claude: "claude",
      },
      qualityGate: {},
      dashboard: {
        enabled: false,
        port: 0,
      },
      locale: {
        language: "ko",
        timezone: "Asia/Seoul",
      },
      security: {
        secrets: {
          key: "",
        },
      },
    } as never,
    bus: {
      publish_outbound: async (message: OutboundMessage) => {
        sent.push(message);
      },
    } as never,
    events: {
      append: async () => undefined,
    } as never,
    agent_runtime: make_agent_runtime(""),
    providers: {} as never,
  });

  const result = await handler(make_job());
  assert.match(String(result || ""), /cron 작업 완료/i);
  assert.equal(sent.some((m) => String((m.metadata as Record<string, unknown>)?.kind || "") === "cron_run_start"), true);
  const done = sent.find((m) => String((m.metadata as Record<string, unknown>)?.kind || "") === "cron_result");
  assert.ok(done);
  assert.equal(Boolean((done!.metadata as Record<string, unknown>)?.empty), true);
});

test("cron runtime handler reports unresolved target to fallback chat", async () => {
  const sent: OutboundMessage[] = [];
  const handler = create_cron_job_handler({
    config: {
      provider: "telegram",
      channels: {
        slack: { bot_token: "", default_channel: "" },
        discord: { bot_token: "", app_id: "", public_key: "", default_channel: "" },
        telegram: { bot_token: "", default_chat_id: "fallback-chat", allowed_chat_ids: [] },
      },
      workspace: ".",
      commands: {
        codex: "codex",
        claude: "claude",
      },
      qualityGate: {},
      dashboard: {
        enabled: false,
        port: 0,
      },
      locale: {
        language: "ko",
        timezone: "Asia/Seoul",
      },
      security: {
        secrets: {
          key: "",
        },
      },
    } as never,
    bus: {
      publish_outbound: async (message: OutboundMessage) => {
        sent.push(message);
      },
    } as never,
    events: {
      append: async () => undefined,
    } as never,
    agent_runtime: make_agent_runtime("done"),
    providers: {} as never,
  });

  const job = make_job({
    payload: {
      kind: "agent_turn",
      message: "do something",
      deliver: false,
      channel: "invalid-provider" as never,
      to: "chat-1",
    },
  });
  await assert.rejects(async () => handler(job), /cron_target_unresolved/);
  assert.equal(sent.length > 0, true);
  const failed = sent[sent.length - 1];
  assert.equal(String((failed.metadata as Record<string, unknown>)?.kind || ""), "cron_failed");
  assert.equal(String(failed.chat_id || ""), "fallback-chat");
});

