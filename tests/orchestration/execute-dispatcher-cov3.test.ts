/**
 * execute-dispatcher.ts — 미커버 분기 (cov3):
 * - L130-131: matched_skills 배열 → get_skill_metadata 매핑 + null 필터
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
  provider: "slack", alias: "validator",
  run_id: "run-1", media_inputs: [],
  session_history: [], signal: undefined as any,
};

const mockPreflight: ReadyPreflight = {
  kind: "ready",
  task_with_media: "review this PR",
  media: [],
  skill_names: ["coder"],
  secret_guard: { ok: true, missing_keys: [], invalid_ciphertexts: [] },
  runtime_policy: { max_turns: 5, tools_blocklist: [], tools_allowlist: [] },
  all_tool_definitions: [],
  request_scope: "scope-1",
  request_task_id: "task-1",
  run_id: "run-1",
  evt_base: {
    run_id: "run-1", task_id: "task-1", agent_id: "validator",
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
          get_skill_metadata: vi.fn(() => null),
          get_role_skill: vi.fn(() => null),
        },
      })),
      // L130: matched_skills에서 직접 호출되는 get_skill_metadata
      get_skill_metadata: vi.fn((name: string) =>
        name === "coder"
          ? { name: "coder", checks: ["Did you write tests?"], tools: [], triggers: [], shared_protocols: [], type: "task", source: "local", summary: "writes code" }
          : null,
      ),
    } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    config: { executor_provider: "chatgpt" },
    process_tracker: null,
    guard: null,
    tool_index: null,
    log_event: vi.fn(),
    build_identity_reply: vi.fn(() => "I am Claude"),
    build_system_prompt: vi.fn(async () => "system"),
    generate_guard_summary: vi.fn(async () => "summary"),
    run_once: vi.fn(async () => ({
      reply: "validation complete",
      mode: "once" as const,
      tool_calls_count: 2,
      streamed: false,
      tools_used: ["bash"],
      matched_skills: ["coder", "unknown_skill"], // L130: 2개 → map 호출, L131: null 필터
    })),
    run_agent_loop: vi.fn(async () => ({ reply: "done", mode: "agent" as const, tool_calls_count: 0, streamed: false })),
    run_task_loop: vi.fn(async () => ({ reply: "done", mode: "task" as const, tool_calls_count: 0, streamed: false })),
    run_phase_loop: vi.fn(async () => ({ reply: "done", mode: "phase" as const, tool_calls_count: 0, streamed: false })),
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

// ── L130-131: matched_skills → get_skill_metadata + null 필터 ─────────────

describe("execute_dispatch — matched_skills map + filter (L130-131)", () => {
  it("validator alias + matched_skills=['coder','unknown'] → get_skill_metadata 2회 호출 + null 필터", async () => {
    const deps = make_deps();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "once", executor: "chatgpt" } as GatewayDecision);

    const result = await execute_dispatch(deps, mockRequest, mockPreflight);

    // get_skill_metadata: "coder"→메타 반환, "unknown_skill"→null → filter에서 제거
    expect(deps.runtime.get_skill_metadata).toHaveBeenCalledWith("coder");
    expect(deps.runtime.get_skill_metadata).toHaveBeenCalledWith("unknown_skill");

    // reply에 completion check 포함 여부 (bash 도구 사용 → 체크리스트 추가)
    expect(result.reply).toContain("validation complete");
  });
});
