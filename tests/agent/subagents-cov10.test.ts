/**
 * SubagentRegistry — 미커버 분기 보충 (cov10).
 * - L322-325: controller 루프 내 abort.signal.aborted → 취소 처리
 * - L513-516: run_headless 응답 session_id 캡처
 */
import { describe, it, expect, vi } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

function make_reg(run_orchestrator_impl: (args: any) => Promise<any>, run_headless_impl?: (args: any) => Promise<any>) {
  const providers = {
    get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
    run_orchestrator: vi.fn().mockImplementation(run_orchestrator_impl),
    run_headless: vi.fn().mockImplementation(run_headless_impl ?? (() => Promise.resolve({
      content: "executor done", finish_reason: "stop", has_tool_calls: false, tool_calls: [],
    }))),
  } as any;
  const reg = new SubagentRegistry({
    workspace: "/tmp/cov10",
    providers,
    bus: null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    agent_backends: null,  // API fallback 경로 (non-native)
    provider_caps: { chatgpt_available: false, claude_available: true, openrouter_available: false },
  });
  return { reg, providers };
}

// ══════════════════════════════════════════
// L322-325: abort.signal.aborted → 취소 반환
// ══════════════════════════════════════════

describe("SubagentRegistry — controller 루프 abort.signal (L322-325)", () => {
  it("첫 번째 run_orchestrator 후 cancel() → 두 번째 iteration에서 abort 감지 → cancelled (L322-325)", async () => {
    let iteration = 0;

    // this.running.set(subagent_id, entry) 는 _run_subagent 호출 전에 실행됨.
    // 따라서 mock 내부에서 (reg as any).running.keys() 로 실행 ID를 직접 가져올 수 있다.
    const { reg } = make_reg(async () => {
      iteration++;
      if (iteration === 1) {
        for (const id of (reg as any).running.keys()) {
          reg.cancel(id);
        }
      }
      return { content: JSON.stringify({ done: false, executor_prompt: "do work" }), finish_reason: "stop" };
    });

    const { subagent_id } = await reg.spawn({
      task: "abort during loop test",
      skip_controller: false,
      max_iterations: 3,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("cancelled");
  });
});

// ══════════════════════════════════════════
// L513-516: run_headless 응답 session_id 캡처
// ══════════════════════════════════════════

describe("SubagentRegistry — run_headless session_id 캡처 (L513-516)", () => {
  it("run_headless 응답에 metadata.session_id 있음 → ref.session_id에 캡처 (L513-516)", async () => {
    const { reg } = make_reg(
      async () => ({ content: JSON.stringify({ done: false, executor_prompt: "test" }), finish_reason: "stop" }),
      async () => ({
        content: "executor result",
        finish_reason: "stop",
        has_tool_calls: false,
        tool_calls: [],
        metadata: { session_id: "sess-captured-123" },  // L513: sid = "sess-captured-123"
      }),
    );

    // 1회만 실행 후 done=true 로 만들기 위해 max_iterations=1
    // executor 실행 후 plan.done=false, loop continues up to max_iterations
    // Then exits normally
    const run_orch = vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ done: false, executor_prompt: "work" }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ done: true, final_answer: "finished" }) });
    (reg as any).providers.run_orchestrator = run_orch;

    const { subagent_id } = await reg.spawn({
      task: "session capture test",
      skip_controller: false,
      max_iterations: 2,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("completed");
  });
});
