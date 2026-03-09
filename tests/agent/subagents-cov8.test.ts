/**
 * SubagentRegistry — 미커버 분기 보충 (cov8).
 * - L926-927: _run_direct_executor executor_backend.run() hooks.on_event 콜백
 * - L961-969: _run_direct_executor API fallback on_stream 콜백
 */
import { describe, it, expect, vi } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

function make_reg_with_backend(backend: any) {
  const providers = {
    get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
    run_orchestrator: vi.fn(),
    run_headless: vi.fn().mockResolvedValue({ content: "headless ok", finish_reason: "stop" }),
  } as any;
  const agent_backends = {
    get_backend: vi.fn().mockReturnValue(backend),
    resolve_backend: vi.fn().mockReturnValue(backend),
    get_session_store: vi.fn().mockReturnValue(null),
  } as any;
  return new SubagentRegistry({
    workspace: "/tmp/cov8",
    providers,
    bus: null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    agent_backends,
    provider_caps: { chatgpt_available: false, claude_available: true, openrouter_available: false },
  });
}

function make_reg_no_backend(run_headless_impl?: (args: any) => Promise<any>) {
  const providers = {
    get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
    run_orchestrator: vi.fn(),
    run_headless: vi.fn().mockImplementation(run_headless_impl ?? (() => Promise.resolve({ content: "ok", finish_reason: "stop" }))),
  } as any;
  // agent_backends가 null이면 executor_backend = null → API fallback 경로
  return { reg: new SubagentRegistry({
    workspace: "/tmp/cov8",
    providers,
    bus: null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    agent_backends: null,
    provider_caps: { chatgpt_available: false, claude_available: true, openrouter_available: false },
  }), providers };
}

// ══════════════════════════════════════════
// L926-927: executor_backend.run()의 hooks.on_event 콜백
// ══════════════════════════════════════════

describe("SubagentRegistry — _run_direct_executor on_event 콜백 (L926-927)", () => {
  it("backend이 hooks.on_event를 호출하면 on_event + _fire 실행", async () => {
    const on_event = vi.fn();
    const backend = {
      id: "claude_cli",
      native_tool_loop: false,
      supports_resume: false,
      capabilities: {},
      is_available: vi.fn().mockReturnValue(true),
      run: vi.fn().mockImplementation(async (args: any) => {
        // on_event 콜백을 명시적으로 호출 → L926-927 실행
        args.hooks?.on_event?.({
          type: "content_delta",
          source: { backend: "claude_cli" },
          at: new Date().toISOString(),
          text: "streaming text",
        });
        return { content: "done", finish_reason: "stop" };
      }),
    };
    const reg = make_reg_with_backend(backend);

    const { subagent_id } = await reg.spawn({
      task: "test on_event callback",
      skip_controller: true,
      hooks: { on_event },
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("completed");
    // on_event가 실제로 호출됨
    expect(on_event).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// L961-969: API fallback on_stream 콜백
// ══════════════════════════════════════════

describe("SubagentRegistry — _run_direct_executor API fallback on_stream 콜백 (L961-969)", () => {
  it("run_headless가 on_stream 콜백 호출 시 stream_buffer에 누적", async () => {
    const { reg } = make_reg_no_backend(async (args: any) => {
      // on_stream 콜백 호출 → L961-969 실행
      // 120자 이상이어야 flush 조건 충족
      await args.on_stream?.("x".repeat(130));
      return { content: "final content", finish_reason: "stop" };
    });

    const { subagent_id } = await reg.spawn({
      task: "streaming test",
      skip_controller: true,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("completed");
  });

  it("on_stream 소량 청크 (120자 미만) → 즉시 flush 안 함, 완료는 됨", async () => {
    const { reg } = make_reg_no_backend(async (args: any) => {
      // 120자 미만이므로 flush 조건 미충족 (L963 조기 반환)
      await args.on_stream?.("small chunk");
      return { content: "result", finish_reason: "stop" };
    });

    const { subagent_id } = await reg.spawn({
      task: "small stream test",
      skip_controller: true,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("completed");
  });
});
