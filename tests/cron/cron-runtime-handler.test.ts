import { describe, it, expect } from "vitest";
import type { AgentRuntimeLike } from "@src/agent/runtime.types.ts";
import type { OutboundMessage } from "@src/bus/types.ts";
import { create_cron_job_handler } from "@src/cron/runtime-handler.ts";
import type { CronJob } from "@src/cron/types.ts";

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

function make_agent_runtime(): AgentRuntimeLike {
  return {
    get_context_builder: () => ({ build_system_prompt: async () => "system prompt" }) as never,
    get_always_skills: () => [],
    recommend_skills: () => [],
    has_tool: () => false,
    register_tool: () => undefined,
    get_tool_definitions: () => [],
    get_tool_executors: () => [],
    execute_tool: async () => "",
    append_daily_memory: async () => undefined,
    list_approval_requests: () => [],
    get_approval_request: () => null,
    resolve_approval_request: () => ({ ok: false, decision: "unknown", status: "pending", confidence: 0 }),
    execute_approved_request: async () => ({ ok: false, status: "unknown" }),
    run_agent_loop: async () => ({ state: {} as never, final_content: null }),
    run_task_loop: async () => ({ state: {} as never }),
  };
}

function make_agent_backends(content: string | null) {
  return {
    resolve_backend_id: () => "codex_cli" as const,
    get_backend: () => ({
      id: "codex_cli" as const,
      native_tool_loop: true,
      supports_resume: false,
      capabilities: { approval: false, structured_output: false, thinking: false, budget_tracking: false, tool_filtering: false, tool_result_events: false, send_input: false, tool_executors: true },
    }),
    run: async () => ({
      content,
      session: null,
      tool_calls_count: 0,
      usage: {},
      finish_reason: "stop" as const,
      metadata: {},
    }),
  } as never;
}

describe("cron runtime handler", () => {
  it("sends fallback done notice when agent output is empty", async () => {
    const sent: OutboundMessage[] = [];
    const handler = create_cron_job_handler({
      config: {
        agent_loop_max_turns: 5,
        default_alias: "test-agent",
        executor_provider: "chatgpt",
        provider_caps: { chatgpt_available: true, claude_available: false, openrouter_available: false },
        resolve_default_target: () => ({ provider: "telegram", chat_id: "chat-1" }),
      },
      bus: {
        publish_outbound: async (message: OutboundMessage) => { sent.push(message); },
      } as never,
      events: { append: async () => undefined } as never,
      agent_runtime: make_agent_runtime(),
      agent_backends: make_agent_backends(""),
      secret_vault: { seal: async (t: string) => t, unseal: async (t: string) => t, has_key: () => false } as never,
    });

    const result = await handler(make_job());
    expect(String(result || "")).toMatch(/cron 작업 완료/i);
    expect(sent.some((m) => String((m.metadata as Record<string, unknown>)?.kind || "") === "cron_run_start")).toBe(true);
    const done = sent.find((m) => String((m.metadata as Record<string, unknown>)?.kind || "") === "cron_result");
    expect(done).toBeTruthy();
    expect(Boolean((done!.metadata as Record<string, unknown>)?.empty)).toBe(true);
  });

  it("uses fallback chat when no explicit target provided", async () => {
    const sent: OutboundMessage[] = [];
    const handler = create_cron_job_handler({
      config: {
        agent_loop_max_turns: 5,
        default_alias: "test-agent",
        executor_provider: "chatgpt",
        provider_caps: { chatgpt_available: true, claude_available: false, openrouter_available: false },
        resolve_default_target: () => ({ provider: "telegram", chat_id: "fallback-chat" }),
      },
      bus: {
        publish_outbound: async (message: OutboundMessage) => { sent.push(message); },
      } as never,
      events: { append: async () => undefined } as never,
      agent_runtime: make_agent_runtime(),
      agent_backends: make_agent_backends("done"),
      secret_vault: { seal: async (t: string) => t, unseal: async (t: string) => t, has_key: () => false } as never,
    });

    const job = make_job({
      payload: {
        kind: "agent_turn",
        message: "do something",
        deliver: false,
        channel: "", // ← 명시적 provider 없음 → fallback 사용
        to: "",
      },
    });
    // target = null이지만 fallback = { provider: "telegram", chat_id: "fallback-chat" }
    // 따라서 fallback_target으로 실행하고 결과 메시지를 보냄
    const result = await handler(job);
    expect(result).toBeTruthy(); // 정상 완료
    const cron_result = sent.find((m) => String((m.metadata as Record<string, unknown>)?.kind || "") === "cron_result");
    expect(cron_result?.chat_id).toBe("fallback-chat"); // fallback chat으로 발송됨
  });
});
