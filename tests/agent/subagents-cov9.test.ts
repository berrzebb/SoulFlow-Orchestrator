/**
 * SubagentRegistry — tool execution loop 커버리지 (cov9).
 * - L545-566: else 분기 (native_tool_loop=false) — run_headless → tool_calls → headless_tools.execute → followup run_headless
 */
import { describe, it, expect, vi } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

function make_tool_registry() {
  return {
    get_definitions: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue("tool result"),
    tool_names: [] as string[],
    get_all: vi.fn().mockReturnValue({}),
    filtered: vi.fn().mockReturnThis(),
  } as any;
}

// ══════════════════════════════════════════
// L545-566: tool execution loop
// ══════════════════════════════════════════

describe("SubagentRegistry — tool execution loop (L545-566)", () => {
  it("run_headless가 tool_calls 반환 → execute 호출 → followup run_headless 호출 (L545-566)", async () => {
    let run_headless_call_count = 0;

    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
      run_orchestrator: vi.fn()
        // 1st iteration: executor_prompt 있음, done=false → executor 실행
        .mockResolvedValueOnce({
          content: JSON.stringify({ done: false, executor_prompt: "do some work" }),
        })
        // 2nd iteration: done=true → 루프 종료
        .mockResolvedValueOnce({
          content: JSON.stringify({ done: true, final_answer: "all done" }),
        }),
      run_headless: vi.fn().mockImplementation(async () => {
        run_headless_call_count++;
        if (run_headless_call_count === 1) {
          // 1st call: tool calls 있음 → L545 tool loop 진입
          return {
            content: "",
            has_tool_calls: true,
            tool_calls: [{ name: "think", id: "tc1", arguments: { thought: "thinking" } }],
            finish_reason: "tool_calls",
            metadata: {},
          };
        }
        // 2nd call (followup): tool calls 없음 → L566 current_response 갱신
        return {
          content: "followup done",
          has_tool_calls: false,
          tool_calls: [],
          finish_reason: "stop",
          metadata: {},
        };
      }),
    } as any;

    const tool_registry = make_tool_registry();

    const reg = new SubagentRegistry({
      workspace: "/tmp/cov9",
      providers,
      bus: null,
      build_tools: () => tool_registry,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      agent_backends: null, // → executor_backend=null → else branch (L476)
    });

    const { subagent_id } = await reg.spawn({
      task: "test tool loop task",
      max_iterations: 3,
    });

    const result = await reg.wait_for_completion(subagent_id, 8000, 20);

    // 서브에이전트가 정상 완료
    expect(result?.status).toBe("completed");

    // tool_calls가 있었으므로 headless_tools.execute 호출됨 (L549)
    expect(tool_registry.execute).toHaveBeenCalledWith(
      "think",
      { thought: "thinking" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // followup run_headless가 호출됨 (L558-564)
    expect(run_headless_call_count).toBeGreaterThanOrEqual(2);
  });

  it("run_headless → 텍스트에서 parse_tool_calls_from_text로 implicit tool_calls 감지 (L541-542)", async () => {
    let run_headless_count = 0;

    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
      run_orchestrator: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({ done: false, executor_prompt: "execute implicit tools" }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({ done: true, final_answer: "implicit done" }),
        }),
      run_headless: vi.fn().mockImplementation(async () => {
        run_headless_count++;
        // has_tool_calls: false이지만 tool_calls 배열이 있음
        // → implicit = parse_tool_calls_from_text(content) → probably empty for plain text
        return {
          content: "just text content, no tool calls",
          has_tool_calls: false,
          tool_calls: [],
          finish_reason: "stop",
          metadata: {},
        };
      }),
    } as any;

    const tool_registry = make_tool_registry();

    const reg = new SubagentRegistry({
      workspace: "/tmp/cov9b",
      providers,
      bus: null,
      build_tools: () => tool_registry,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      agent_backends: null,
    });

    const { subagent_id } = await reg.spawn({
      task: "implicit tools test",
      max_iterations: 3,
    });

    const result = await reg.wait_for_completion(subagent_id, 8000, 20);

    expect(result?.status).toBe("completed");
    // plain text → effective.length = 0 → break immediately (L543)
    // No execute calls
    expect(tool_registry.execute).not.toHaveBeenCalled();
  });

  it("run_headless on_stream 소량 청크 → stream_buffer 누적 → L522-529 flush 시 L528 clear_stream_buffer 실행", async () => {
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
      run_orchestrator: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({ done: false, executor_prompt: "work with streaming" }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({ done: true, final_answer: "stream done" }),
        }),
      run_headless: vi.fn().mockImplementation(async (args: any) => {
        // on_stream 소량 청크 호출 → L496 stream_buffer 누적 → L498 조기 반환 (< 120자)
        // → stream_buffer에 잔류 → L522-529 flush 시 L528 clear_stream_buffer 실행
        await args.on_stream?.("small streaming chunk");
        return {
          content: "no tool calls",
          has_tool_calls: false,
          tool_calls: [],
          finish_reason: "stop",
          metadata: {},
        };
      }),
    } as any;

    const tool_registry = make_tool_registry();

    const reg = new SubagentRegistry({
      workspace: "/tmp/cov9c",
      providers,
      bus: null,
      build_tools: () => tool_registry,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      agent_backends: null,
    });

    const { subagent_id } = await reg.spawn({
      task: "streaming test",
      max_iterations: 3,
    });

    const result = await reg.wait_for_completion(subagent_id, 8000, 20);
    expect(result?.status).toBe("completed");
  });
});
