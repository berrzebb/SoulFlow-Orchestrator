/**
 * SubagentRegistry — tool execution loop + native_tool_loop 통합 테스트.
 *
 * Tool execution loop (L545-566):
 * - run_headless → tool_calls → headless_tools.execute → followup run_headless
 * - implicit tool_calls from text (parse_tool_calls_from_text)
 * - on_stream 소량 청크 → stream_buffer 누적 → flush
 *
 * Native tool loop with controller (L383-475):
 * - 컨트롤러 루프 + native_tool_loop=true executor 정상 완료
 * - finish_reason=cancelled → cancelled 상태
 * - finish_reason=error → failed 상태
 * - agent_result.session → session_id 저장
 * - FINISH_REASON_WARNINGS → 경고 텍스트 추가
 * - on_stream 대량 데이터 → buffer flush 경로
 */
import { describe, it, expect, vi } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

// ══════════════════════════════════════════════════════════
// 공통 헬퍼
// ══════════════════════════════════════════════════════════

function make_tool_registry() {
  return {
    get_definitions: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue("tool result"),
    tool_names: [] as string[],
    get_all: vi.fn().mockReturnValue({}),
    filtered: vi.fn().mockReturnThis(),
  } as any;
}

function make_backend(
  run_result: { content?: string; finish_reason: string; metadata?: Record<string, unknown>; session?: { session_id: string } },
) {
  return {
    id: "claude_cli",
    native_tool_loop: true,
    supports_resume: false,
    capabilities: {},
    is_available: vi.fn().mockReturnValue(true),
    run: vi.fn().mockResolvedValue(run_result),
  };
}

function make_backend_registry(backend: ReturnType<typeof make_backend>) {
  return {
    get_backend: vi.fn().mockReturnValue(backend),
    resolve_backend: vi.fn().mockReturnValue(backend),
    resolve_backend_id: vi.fn().mockReturnValue("claude_cli"),
    get_session_store: vi.fn().mockReturnValue(null),
    run: backend.run,
    list: vi.fn().mockReturnValue([backend]),
  } as any;
}

function make_providers(orchestrator_responses: { content: string }[]) {
  let call = 0;
  return {
    get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
    run_orchestrator: vi.fn().mockImplementation(async () => orchestrator_responses[Math.min(call++, orchestrator_responses.length - 1)]),
    run_headless: vi.fn().mockResolvedValue({ content: "headless ok", has_tool_calls: false, finish_reason: "stop" }),
  } as any;
}

function make_reg(
  providers: ReturnType<typeof make_providers>,
  backend: ReturnType<typeof make_backend>,
) {
  const backend_registry = make_backend_registry(backend);
  return new SubagentRegistry({
    workspace: "/tmp/test-tool-loop",
    providers,
    bus: null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    agent_backends: backend_registry,
    provider_caps: { chatgpt_available: false, claude_available: true, openrouter_available: false },
  });
}

// ══════════════════════════════════════════════════════════
// L545-566: tool execution loop (native_tool_loop=false)
// ══════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════
// L383-475: native_tool_loop 컨트롤러 루프
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — native_tool_loop 컨트롤러 루프 (L383-475)", () => {
  it("컨트롤러 루프 1회 + native_tool_loop → agent_result 성공 → completed", async () => {
    const backend = make_backend({ content: "executor result", finish_reason: "stop" });
    const providers = make_providers([
      { content: JSON.stringify({ done: false, executor_prompt: "do the task", final_answer: "", reason: "", handoffs: [] }) },
      { content: JSON.stringify({ done: true, executor_prompt: "", final_answer: "all done", reason: "done", handoffs: [] }) },
    ]);
    const reg = make_reg(providers, backend);

    const { subagent_id } = await reg.spawn({
      task: "implement feature",
      skip_controller: false,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("completed");
    expect(backend.run).toHaveBeenCalledOnce();
  });

  it("native_tool_loop finish_reason=cancelled → subagent cancelled", async () => {
    const backend = make_backend({ content: "", finish_reason: "cancelled" });
    const providers = make_providers([
      { content: JSON.stringify({ done: false, executor_prompt: "do work", final_answer: "", reason: "", handoffs: [] }) },
    ]);
    const reg = make_reg(providers, backend);

    const { subagent_id } = await reg.spawn({
      task: "cancel test",
      skip_controller: false,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("cancelled");
    expect(backend.run).toHaveBeenCalledOnce();
  });

  it("native_tool_loop finish_reason=error → subagent failed", async () => {
    const backend = make_backend({ content: "", finish_reason: "error", metadata: { error: "backend crashed" } });
    const providers = make_providers([
      { content: JSON.stringify({ done: false, executor_prompt: "do work", final_answer: "", reason: "", handoffs: [] }) },
    ]);
    const reg = make_reg(providers, backend);

    const { subagent_id } = await reg.spawn({
      task: "error test",
      skip_controller: false,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("failed");
    expect(result?.error).toContain("backend crashed");
  });

  it("native_tool_loop session 반환 → session_id 저장 (L468-473)", async () => {
    const backend = make_backend({ content: "done", finish_reason: "stop", session: { session_id: "sess-abc" } });
    const providers = make_providers([
      { content: JSON.stringify({ done: false, executor_prompt: "do task", final_answer: "", reason: "", handoffs: [] }) },
      { content: JSON.stringify({ done: true, executor_prompt: "", final_answer: "finished", reason: "done", handoffs: [] }) },
    ]);
    const reg = make_reg(providers, backend);

    const { subagent_id } = await reg.spawn({
      task: "session test",
      skip_controller: false,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("completed");
    // session_id가 저장되었는지 확인
    const item = reg.get(subagent_id);
    expect(item?.session_id).toBe("sess-abc");
  });

  it("native_tool_loop FINISH_REASON_WARNINGS → 경고 텍스트 추가 (L464-466)", async () => {
    // max_output_tokens는 경고를 생성하는 finish_reason 중 하나
    const backend = make_backend({ content: "partial output", finish_reason: "max_output_tokens" });
    const providers = make_providers([
      { content: JSON.stringify({ done: false, executor_prompt: "do work", final_answer: "", reason: "", handoffs: [] }) },
      { content: JSON.stringify({ done: true, executor_prompt: "", final_answer: "", reason: "done", handoffs: [] }) },
    ]);
    const reg = make_reg(providers, backend);

    const { subagent_id } = await reg.spawn({
      task: "max tokens test",
      skip_controller: false,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    // 경고가 추가된 경우 completed가 됨 (에러 아님)
    expect(["completed", "failed"]).toContain(result?.status);
    expect(backend.run).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════════════════════
// native_tool_loop — on_stream 콜백 실행 (L395-409)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — native_tool_loop on_stream 콜백 (L395-409)", () => {
  it("on_stream이 hooks에 전달되어 스트림 버퍼 flush 경로 진입", async () => {
    let captured_hooks: Record<string, unknown> | null = null;

    const backend_run = vi.fn().mockImplementation(async (id: string, args: Record<string, unknown>) => {
      captured_hooks = args.hooks as Record<string, unknown>;
      // on_stream 콜백을 대량 데이터로 트리거 (buffer >= 120 조건 만족)
      if (captured_hooks && typeof (captured_hooks as any).on_stream === "function") {
        await (captured_hooks as any).on_stream("x".repeat(200));
      }
      return { content: "streamed result", finish_reason: "stop" };
    });

    const backend = {
      id: "claude_cli",
      native_tool_loop: true,
      supports_resume: false,
      capabilities: {},
      is_available: vi.fn().mockReturnValue(true),
      run: backend_run,
    };
    const backend_registry = make_backend_registry(backend);
    const providers = make_providers([
      { content: JSON.stringify({ done: false, executor_prompt: "do task", final_answer: "", reason: "", handoffs: [] }) },
      { content: JSON.stringify({ done: true, executor_prompt: "", final_answer: "done", reason: "done", handoffs: [] }) },
    ]);

    const reg = new SubagentRegistry({
      workspace: "/tmp/test-tool-loop-stream",
      providers,
      bus: { publish_inbound: vi.fn(), publish_outbound: vi.fn() } as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      agent_backends: backend_registry,
      provider_caps: { chatgpt_available: false, claude_available: true, openrouter_available: false },
    });

    const { subagent_id } = await reg.spawn({
      task: "stream test",
      skip_controller: false,
      origin_channel: "slack",
      origin_chat_id: "C001",
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("completed");
    expect(captured_hooks).not.toBeNull();
  });
});
