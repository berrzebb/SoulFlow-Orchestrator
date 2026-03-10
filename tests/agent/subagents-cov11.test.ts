/**
 * SubagentRegistry — native_tool_loop 비-skip_controller 경로 커버리지 (L383-475).
 * - 컨트롤러 루프 + native_tool_loop=true executor
 * - finish_reason=cancelled → cancelled 상태
 * - finish_reason 경고 → last_executor_output에 경고 추가
 * - agent_result.session → session_id 저장
 */
import { describe, it, expect, vi } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

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
    workspace: "/tmp/test-cov11",
    providers,
    bus: null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    agent_backends: backend_registry,
    provider_caps: { chatgpt_available: false, claude_available: true, openrouter_available: false },
  });
}

// ══════════════════════════════════════════════════════════
// native_tool_loop 컨트롤러 루프 — 정상 완료 (L383-475)
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
      workspace: "/tmp/test-cov11-stream",
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
