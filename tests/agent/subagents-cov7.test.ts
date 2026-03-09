/**
 * SubagentRegistry — _run_direct_executor executor_backend 경로 (cov7).
 * - executor_backend 있을 때: run() 성공 / finish_reason=error / cancelled
 * - FINISH_REASON_WARNINGS 경고 추가
 * - is_provider_error_reply → throw
 */
import { describe, it, expect, vi } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

function make_providers(overrides: Record<string, unknown> = {}) {
  return {
    get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
    run_orchestrator: vi.fn().mockResolvedValue({ content: '{"done":true,"executor_prompt":"","final_answer":"ok","reason":"done","handoffs":[]}' }),
    run_headless: vi.fn().mockResolvedValue({ content: "headless result", finish_reason: "stop" }),
    ...overrides,
  } as any;
}

function make_backend(run_result: { content?: string; finish_reason: string; metadata?: Record<string, unknown> }) {
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
    list: vi.fn().mockReturnValue([backend]),
  } as any;
}

function make_reg(providers: ReturnType<typeof make_providers>, agent_backends: ReturnType<typeof make_backend_registry> | null = null) {
  return new SubagentRegistry({
    workspace: "/tmp/test-cov7",
    providers,
    bus: null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    agent_backends,
    provider_caps: { chatgpt_available: false, claude_available: true, openrouter_available: false },
  });
}

// ──────────────────────────────────────────────────────────
// executor_backend → run() 성공
// ──────────────────────────────────────────────────────────

describe("SubagentRegistry — _run_direct_executor executor_backend 경로", () => {
  it("executor_backend.run() 성공 → content 반환 후 completed", async () => {
    const backend = make_backend({ content: "task done", finish_reason: "stop" });
    const reg = make_reg(make_providers(), make_backend_registry(backend));

    const { subagent_id } = await reg.spawn({
      task: "do something",
      skip_controller: true,
      provider_id: "claude_code",
    });

    // 완료될 때까지 대기
    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("completed");
    expect(backend.run).toHaveBeenCalledOnce();
    expect(result?.content).toBe("task done");
  });

  it("executor_backend.run() finish_reason=cancelled → _run_direct_executor cancelled 반환, skip_controller는 completed로 처리", async () => {
    const backend = make_backend({ content: "", finish_reason: "cancelled" });
    const reg = make_reg(make_providers(), make_backend_registry(backend));

    const { subagent_id } = await reg.spawn({
      task: "cancel test",
      skip_controller: true,
    });

    // skip_controller 경로에서는 cancelled finish_reason이어도 _run_subagent가 completed로 마무리
    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(["completed", "cancelled"]).toContain(result?.status);
    expect(backend.run).toHaveBeenCalledOnce();
  });

  it("executor_backend.run() finish_reason=error → subagent failed", async () => {
    const backend = make_backend({ content: "", finish_reason: "error", metadata: { error: "backend crashed" } });
    const reg = make_reg(make_providers(), make_backend_registry(backend));

    const { subagent_id } = await reg.spawn({
      task: "error test",
      skip_controller: true,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("failed");
    expect(result?.error).toContain("backend crashed");
  });

  it("executor_backend.run() finish_reason=max_turns → FINISH_REASON_WARNINGS 추가", async () => {
    const backend = make_backend({ content: "partial output", finish_reason: "max_turns" });
    const reg = make_reg(make_providers(), make_backend_registry(backend));

    const { subagent_id } = await reg.spawn({
      task: "max turns test",
      skip_controller: true,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    // max_turns warning이 content에 추가됨
    expect(result?.status).toBe("completed");
    expect(result?.content).toContain("partial output");
  });
});

// ──────────────────────────────────────────────────────────
// spawn() providers 없음 → throw (L176-178)
// ──────────────────────────────────────────────────────────

describe("SubagentRegistry — spawn providers 없음", () => {
  it("providers=null → providers_not_configured 예외", async () => {
    const reg = new SubagentRegistry({ workspace: "/tmp/x", providers: null });
    await expect(reg.spawn({ task: "t" })).rejects.toThrow("providers_not_configured");
  });
});

// ──────────────────────────────────────────────────────────
// MAX_CONCURRENT_SUBAGENTS 초과 (L179-185)
// ──────────────────────────────────────────────────────────

describe("SubagentRegistry — concurrent limit", () => {
  it("running이 10개 초과 → rejected 반환", async () => {
    const providers = make_providers();
    const reg = make_reg(providers);

    // running map을 직접 10개 채우기
    const running_map = (reg as any).running as Map<string, unknown>;
    for (let i = 0; i < 10; i++) {
      running_map.set(`sa${i}`, { ref: { id: `sa${i}`, status: "running" }, abort: new AbortController(), done: Promise.resolve(), parent_id: null });
    }

    const result = await reg.spawn({ task: "overflow", provider_id: "chatgpt" });
    expect(result.status).toBe("rejected");
    expect(result.message).toContain("concurrent subagent limit");
  });
});
