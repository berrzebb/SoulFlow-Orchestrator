/**
 * cron/runtime-handler — 미커버 분기 보충.
 * L203: setTimeout 콜백 → cron_abort.abort() 실행
 * L216: seal_inbound_sensitive_text throw → catch → redact_sensitive_text 사용
 */
import { describe, it, expect, vi } from "vitest";
import { create_cron_job_handler } from "@src/cron/runtime-handler.js";
import type { CronJob } from "@src/cron/types.js";
import type { OutboundMessage } from "@src/bus/types.js";

function make_job(overrides?: Partial<CronJob>): CronJob {
  const now = Date.now();
  return {
    id: "job-cov2",
    name: "cov2-job",
    enabled: true,
    schedule: { kind: "at", at_ms: now + 60_000 },
    payload: {
      kind: "agent_turn",
      message: "do something safe",
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

function make_agent_runtime_stub() {
  return {
    get_context_builder: () => ({ build_system_prompt: async () => "prompt" }) as never,
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

const base_config = {
  agent_loop_max_turns: 5,
  default_alias: "test-agent",
  executor_provider: "chatgpt",
  provider_caps: { chatgpt_available: true, claude_available: false, openrouter_available: false },
  resolve_default_target: () => ({ provider: "telegram" as const, chat_id: "chat-1" }),
};

const base_vault = {
  seal: async (t: string) => t,
  unseal: async (t: string) => t,
  has_key: () => false,
} as never;

// ══════════════════════════════════════════
// L203: setTimeout 콜백 — cron_abort.abort()
// ══════════════════════════════════════════

describe("cron runtime-handler — L203 setTimeout abort", () => {
  it("timeout 만료 → setTimeout 콜백 → abort → run이 cancelled 반환 (L203)", async () => {
    vi.useFakeTimers();

    // per_turn_timeout_ms=10, max_turns=5 → job_timeout=50ms
    const config = { ...base_config, per_turn_timeout_ms: 10 };

    // run이 abort_signal을 감지하면 cancelled로 resolve
    const backends = {
      resolve_backend_id: () => "codex_cli" as const,
      get_backend: () => ({
        id: "codex_cli" as const,
        native_tool_loop: true,
        supports_resume: false,
        capabilities: {
          approval: false, structured_output: false, thinking: false,
          budget_tracking: false, tool_filtering: false,
          tool_result_events: false, send_input: false, tool_executors: true,
        },
      }),
      run: (_id: string, args: { abort_signal?: AbortSignal;[k: string]: unknown }) =>
        new Promise<{
          content: string | null; session: null; tool_calls_count: number;
          usage: {}; finish_reason: string; metadata: {};
        }>((resolve) => {
          const on_abort = () => resolve({
            content: null, session: null, tool_calls_count: 0,
            usage: {}, finish_reason: "cancelled", metadata: {},
          });
          if (args.abort_signal?.aborted) { on_abort(); return; }
          args.abort_signal?.addEventListener("abort", on_abort);
        }),
    } as never;

    const sent: OutboundMessage[] = [];
    const handler = create_cron_job_handler({
      config,
      bus: { publish_outbound: async (m: OutboundMessage) => { sent.push(m); } } as never,
      events: { append: async () => undefined } as never,
      agent_runtime: make_agent_runtime_stub() as never,
      agent_backends: backends,
      secret_vault: base_vault,
    });

    const promise = handler(make_job());
    // job_timeout_ms = 5 * 10 = 50ms → setTimeout fires → abort
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    vi.useRealTimers();
    expect(result).toBe("cancelled");
  });
});

// ══════════════════════════════════════════
// L216: seal_inbound_sensitive_text throw → catch → redact
// ══════════════════════════════════════════

describe("cron runtime-handler — L216 seal throw → redact fallback", () => {
  it("vault.put_secret throw → seal 실패 → L216 catch → redact 사용 후 정상 완료", async () => {
    // put_secret이 throw하는 vault
    const throwing_vault = {
      ...base_vault,
      put_secret: async () => { throw new Error("vault unavailable"); },
    } as never;

    // 메시지에 private key 패턴 포함 → seal_value 호출 → put_secret 호출 → throw
    const pkey_message = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtQeADu0S/rHSzXlKEFtFLFHj",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    const sent: OutboundMessage[] = [];
    const backends = {
      resolve_backend_id: () => "codex_cli" as const,
      get_backend: () => ({
        id: "codex_cli" as const,
        native_tool_loop: true,
        supports_resume: false,
        capabilities: {
          approval: false, structured_output: false, thinking: false,
          budget_tracking: false, tool_filtering: false,
          tool_result_events: false, send_input: false, tool_executors: true,
        },
      }),
      run: async () => ({
        content: "done",
        session: null,
        tool_calls_count: 0,
        usage: {},
        finish_reason: "stop",
        metadata: {},
      }),
    } as never;

    const handler = create_cron_job_handler({
      config: base_config,
      bus: { publish_outbound: async (m: OutboundMessage) => { sent.push(m); } } as never,
      events: { append: async () => undefined } as never,
      agent_runtime: make_agent_runtime_stub() as never,
      agent_backends: backends,
      secret_vault: throwing_vault,
    });

    const result = await handler(make_job({
      payload: {
        kind: "agent_turn",
        message: pkey_message,
        deliver: false,
        channel: "telegram",
        to: "chat-1",
      },
    }));

    // seal 실패 후 redact로 폴백하여 정상 완료됨
    expect(result).toBeTruthy();
  });
});
