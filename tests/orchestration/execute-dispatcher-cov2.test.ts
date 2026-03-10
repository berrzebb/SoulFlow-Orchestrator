/**
 * execute-dispatcher.ts — 미커버 분기 커버리지 (L131-133, L223-226).
 * - check.has_checks → completion check 추가 (L131-133)
 * - 비 claude_code executor + 루프 결과 없음 → finalize(first) (L226)
 * - claude_code executor fallback → second 결과 있음 (L222)
 * - claude_code executor fallback → second도 없음 (L223)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ExecuteDispatcherDeps } from "@src/orchestration/execution/execute-dispatcher.js";
import { execute_dispatch } from "@src/orchestration/execution/execute-dispatcher.js";
import * as gatewayModule from "@src/orchestration/gateway.js";
import type { GatewayDecision } from "@src/orchestration/gateway.js";
import type { ReadyPreflight } from "@src/orchestration/request-preflight.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

const mockRequest: OrchestrationRequest = {
  message: {
    id: "msg-1", provider: "slack", channel: "general",
    sender_id: "user1", chat_id: "chat1", content: "test",
    at: new Date().toISOString(), thread_id: undefined,
    metadata: { message_id: "msg-1" },
  },
  provider: "slack", alias: "assistant",
  run_id: "run-1", media_inputs: [],
  session_history: [], signal: undefined as any,
};

const mockPreflight: ReadyPreflight = {
  kind: "ready",
  task_with_media: "implement feature X",
  media: [],
  skill_names: ["coder"],
  secret_guard: { ok: true, missing_keys: [], invalid_ciphertexts: [] },
  runtime_policy: { max_turns: 5, tools_blocklist: [], tools_allowlist: [] },
  all_tool_definitions: [],
  request_scope: "scope-1",
  request_task_id: "task-1",
  run_id: "run-1",
  evt_base: {
    run_id: "run-1", task_id: "task-1", agent_id: "assistant",
    provider: "slack", channel: "slack", chat_id: "chat1", source: "inbound",
  },
  history_lines: [],
  context_block: "context",
  tool_ctx: { task_id: "task-1", signal: undefined as any, channel: "slack", chat_id: "chat1", sender_id: "user1" },
  skill_tool_names: [],
  skill_provider_prefs: [],
  category_map: {},
  tool_categories: [],
  active_tasks_in_chat: [],
} as any;

function make_deps(overrides: Partial<ExecuteDispatcherDeps> = {}): ExecuteDispatcherDeps {
  return {
    providers: { run_orchestrator: vi.fn(async () => ({ content: "mock" })) } as any,
    runtime: {
      list_active_tasks: vi.fn(() => []),
      find_session_by_task: vi.fn(() => null),
      get_context_builder: vi.fn(() => ({
        skills_loader: {
          get_skill_metadata: vi.fn((name: string) => name === "coder" ? {
            name: "coder", summary: "writes code",
            type: "task", source: "local", shared_protocols: [],
            checks: ["Did you write tests?", "Did you run linting?"],
            tools: [], triggers: [],
          } : null),
          get_role_skill: vi.fn(() => null),
        },
      })),
    } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    config: { executor_provider: "chatgpt", provider_caps: {} },
    process_tracker: null,
    guard: null,
    tool_index: null,
    log_event: vi.fn(),
    build_identity_reply: vi.fn(() => "I am Claude"),
    build_system_prompt: vi.fn(async () => "system"),
    generate_guard_summary: vi.fn(async () => "summary"),
    run_once: vi.fn(async () => ({ reply: "completed", mode: "once" as const, tool_calls_count: 3, streamed: false, tools_used: ["bash", "write_file"] })),
    run_agent_loop: vi.fn(async () => ({ reply: "agent done", mode: "agent" as const, tool_calls_count: 2, streamed: false })),
    run_task_loop: vi.fn(async () => ({ reply: "task done", mode: "task" as const, tool_calls_count: 0, streamed: false })),
    run_phase_loop: vi.fn(async () => ({ reply: "phase done", mode: "phase" as const, tool_calls_count: 0, streamed: false })),
    caps: vi.fn(() => ({ chatgpt_available: true, claude_available: true })),
    ...overrides,
  };
}

let gatewaySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  gatewaySpy = vi.spyOn(gatewayModule, "resolve_gateway");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════
// check.has_checks → completion check 추가 (L131-133)
// ══════════════════════════════════════════════════════════

describe("execute_dispatch — check.has_checks 분기 (L131-133)", () => {
  it("validator alias + bash 도구 사용 → reply에 completion check 추가됨", async () => {
    const deps = make_deps();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "once", executor: "chatgpt" } as GatewayDecision);
    // run_once → reply 있음 + bash 도구 사용 → validation role 시 completion check 분기 진입
    (deps.run_once as any).mockResolvedValue({
      reply: "I implemented feature X",
      mode: "once" as const,
      tool_calls_count: 3,
      streamed: false,
      tools_used: ["bash"],
    });

    // VALIDATION_ROLES.has("reviewer") === true → completion check 코드 블록 진입
    const reviewer_request = { ...mockRequest, alias: "reviewer" };
    const result = await execute_dispatch(deps, reviewer_request, mockPreflight);

    // bash 도구 사용으로 동적 체크 질문이 reply에 추가됨
    expect(result.reply).toContain("I implemented feature X");
    expect(result.reply).toContain("완료 체크리스트");
  });
});

// ══════════════════════════════════════════════════════════
// 루프 결과 없음 + 비 claude_code → finalize(first) (L226)
// ══════════════════════════════════════════════════════════

describe("execute_dispatch — 루프 결과 없음 → finalize(first) (L226)", () => {
  it("agent 모드 + 첫 루프 결과 없음 + chatgpt executor → finalize(first)", async () => {
    const deps = make_deps();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "agent", executor: "chatgpt" } as GatewayDecision);
    // run_agent_loop → reply 없음
    (deps.run_agent_loop as any).mockResolvedValue({
      reply: "",
      mode: "agent" as const,
      tool_calls_count: 0,
      streamed: false,
      error: "agent_no_output",
    });

    const result = await execute_dispatch(deps, mockRequest, mockPreflight);

    // finalize(first) → reply 없음, error 있음
    expect(result.mode).toBe("agent");
    expect(result.error).toBe("agent_no_output");
  });
});

// ══════════════════════════════════════════════════════════
// claude_code executor fallback → second 결과 있음 (L222)
// ══════════════════════════════════════════════════════════

describe("execute_dispatch — claude_code fallback → second 성공 (L222)", () => {
  it("executor=claude_code + 첫 결과 없음 → fallback 실행 → second 결과로 반환", async () => {
    const deps = make_deps();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "agent", executor: "claude_code" } as GatewayDecision);

    let call_count = 0;
    (deps.run_agent_loop as any).mockImplementation(async () => {
      call_count++;
      if (call_count === 1) {
        // 첫 실행 → 결과 없음
        return { reply: "", mode: "agent" as const, tool_calls_count: 0, streamed: false };
      }
      // 두 번째 실행 (fallback chatgpt) → 결과 있음
      return { reply: "fallback result", mode: "agent" as const, tool_calls_count: 1, streamed: false };
    });

    const result = await execute_dispatch(deps, mockRequest, mockPreflight);

    // L222: second.reply → return finalize(second)
    expect(result.reply).toContain("fallback result");
    expect(call_count).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════
// claude_code executor fallback → second도 결과 없음 (L223)
// ══════════════════════════════════════════════════════════

describe("execute_dispatch — claude_code fallback → 양쪽 모두 실패 (L223)", () => {
  it("executor=claude_code + 양쪽 모두 결과 없음 → 합성 error 반환", async () => {
    const deps = make_deps();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "agent", executor: "claude_code" } as GatewayDecision);

    let call_count = 0;
    (deps.run_agent_loop as any).mockImplementation(async () => {
      call_count++;
      return {
        reply: "",
        mode: "agent" as const,
        tool_calls_count: 0,
        streamed: false,
        error: call_count === 1 ? "primary_failed" : "fallback_failed",
      };
    });

    const result = await execute_dispatch(deps, mockRequest, mockPreflight);

    // L223: return finalize({...second, error: second.error || first.error})
    expect(result.mode).toBe("agent");
    expect(call_count).toBe(2);
    // error는 second.error || first.error
    expect(result.error).toBeTruthy();
  });
});
