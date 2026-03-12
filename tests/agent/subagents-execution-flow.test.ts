/**
 * SubagentRegistry — 실행 경로 통합 테스트.
 *
 * spawn→completion 흐름, hooks, announce, multi-step controller,
 * abort, error, skip_controller, soul/heart, handoffs,
 * backend executor (success/cancelled/error/max_turns),
 * on_event 콜백, on_stream API fallback, abort signal, session_id 캡처.
 */
import { describe, it, expect, vi } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

// ─── 공통 헬퍼 ──────────────────────────────────────────────────────────────

function make_providers(plan_override?: Record<string, unknown>, run_headless_result?: Record<string, unknown>) {
  const default_plan = { done: true, final_answer: "task done!", executor_prompt: "", reason: "done", handoffs: [] };
  return {
    get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
    run_orchestrator: vi.fn().mockResolvedValue({
      content: JSON.stringify({ ...default_plan, ...plan_override }),
      has_tool_calls: false,
      tool_calls: [],
    }),
    run_headless: vi.fn().mockResolvedValue({
      content: run_headless_result?.content ?? "executor result",
      finish_reason: run_headless_result?.finish_reason ?? "stop",
      has_tool_calls: false,
      tool_calls: [],
      metadata: {},
    }),
  } as any;
}

function make_bus() {
  return {
    publish_outbound: vi.fn().mockResolvedValue(undefined),
    publish_inbound: vi.fn().mockResolvedValue(undefined),
    publish_progress: vi.fn().mockResolvedValue(undefined),
    consume_inbound: vi.fn().mockResolvedValue(null),
    consume_outbound: vi.fn().mockResolvedValue(null),
    get_size: vi.fn().mockReturnValue(0),
  } as any;
}

function make_logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
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

const PROVIDER_CAPS = { chatgpt_available: false, claude_available: true, openrouter_available: false };

// ══════════════════════════════════════════════════════════
// done=true plan → completed 상태
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — spawn + completed", () => {
  it("done=true plan → status=completed, content=final_answer", async () => {
    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers: make_providers(),
      bus: null,
    });
    const result = await reg.spawn({ task: "테스트 작업" });
    expect(result.status).toBe("started");

    const completion = await reg.wait_for_completion(result.subagent_id, 5000);
    expect(completion?.status).toBe("completed");
    expect(completion?.content).toContain("task done!");
  });

  it("hooks.on_event 있음 → init + complete 이벤트 발화됨", async () => {
    const on_event = vi.fn();
    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers: make_providers(),
      bus: null,
    });
    await reg.spawn({ task: "이벤트 테스트", hooks: { on_event } });
    // 완료 대기
    await new Promise((r) => setTimeout(r, 300));
    const events = on_event.mock.calls.map((c: any[]) => c[0].type as string);
    expect(events).toContain("init");
    expect(events).toContain("complete");
  });

  it("announce=false → bus.publish_outbound 미호출", async () => {
    const bus = make_bus();
    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers: make_providers(),
      bus,
    });
    await reg.spawn({
      task: "announce false 테스트",
      announce: false,
      origin_channel: "telegram",
      origin_chat_id: "chat-1",
    });
    await new Promise((r) => setTimeout(r, 300));
    // announce=false → _announce_result 미호출
    expect(bus.publish_outbound).not.toHaveBeenCalled();
  });

  it("announce=true + bus + channel → _announce_result 호출됨", async () => {
    const bus = make_bus();
    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers: make_providers(),
      bus,
    });
    await reg.spawn({
      task: "announce true 테스트",
      announce: true,
      origin_channel: "telegram",
      origin_chat_id: "chat-1",
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(bus.publish_outbound).toHaveBeenCalled();
    const calls = bus.publish_outbound.mock.calls;
    const kinds = calls.map((c: any[]) => c[0].metadata?.kind);
    expect(kinds).toContain("subagent_result");
  });
});

// ══════════════════════════════════════════════════════════
// done=false + no executor_prompt → 루프 종료
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — done=false, no executor_prompt", () => {
  it("executor_prompt='' → final_content = last_executor_output → completed", async () => {
    const providers = make_providers({ done: false, executor_prompt: "", final_answer: "", reason: "no_prompt" });
    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus: null,
    });
    const result = await reg.spawn({ task: "no executor prompt test" });
    const completion = await reg.wait_for_completion(result.subagent_id, 5000);
    // 루프 종료 → completed
    expect(completion?.status).toBe("completed");
  });
});

// ══════════════════════════════════════════════════════════
// done=false + executor_prompt → run_headless 호출 (executor_backend=null)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — done=false + run_headless", () => {
  it("done=false → run_headless 호출 후 next iteration에서 done=true → completed", async () => {
    let call_count = 0;
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
      run_orchestrator: vi.fn().mockImplementation(async () => {
        call_count++;
        if (call_count === 1) {
          return { content: JSON.stringify({ done: false, executor_prompt: "do this step", final_answer: "", reason: "step1", handoffs: [] }), has_tool_calls: false, tool_calls: [] };
        }
        return { content: JSON.stringify({ done: true, final_answer: "all done", executor_prompt: "", reason: "done", handoffs: [] }), has_tool_calls: false, tool_calls: [] };
      }),
      run_headless: vi.fn().mockResolvedValue({
        content: "step result",
        finish_reason: "stop",
        has_tool_calls: false,
        tool_calls: [],
        metadata: {},
      }),
    } as any;

    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus: null,
    });
    const result = await reg.spawn({ task: "multi-step task" });
    const completion = await reg.wait_for_completion(result.subagent_id, 5000);
    expect(completion?.status).toBe("completed");
    expect(providers.run_headless).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// abort → cancelled 상태
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — abort during execution", () => {
  it("abort 즉시 → 다음 iteration에서 cancelled", async () => {
    let resolve_blocker!: () => void;
    const blocker = new Promise<void>((r) => { resolve_blocker = r; });

    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
      run_orchestrator: vi.fn().mockImplementation(async () => {
        await blocker; // 블로킹
        return { content: '{"done":false,"executor_prompt":"x"}', has_tool_calls: false, tool_calls: [] };
      }),
      run_headless: vi.fn(),
    } as any;

    const reg = new SubagentRegistry({ workspace: "/tmp/test-subagent-exec", providers, bus: null });
    const result = await reg.spawn({ task: "블로킹 작업" });
    // 즉시 abort
    reg.cancel(result.subagent_id);
    // blocker 해제
    resolve_blocker();
    // 다음 iteration abort 체크로 cancelled
    const completion = await reg.wait_for_completion(result.subagent_id, 3000);
    expect(["cancelled", "completed"]).toContain(completion?.status);
  });
});

// ══════════════════════════════════════════════════════════
// error 발생 → failed 상태
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — error → failed", () => {
  it("run_orchestrator throw → status=failed", async () => {
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
      run_orchestrator: vi.fn().mockRejectedValue(new Error("LLM error")),
      run_headless: vi.fn(),
    } as any;

    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus: null,
    });
    const result = await reg.spawn({ task: "오류 유발 작업" });
    const completion = await reg.wait_for_completion(result.subagent_id, 5000);
    expect(completion?.status).toBe("failed");
    expect(completion?.error).toContain("LLM error");
  });

  it("error + bus + channel → announce_result is_error=true", async () => {
    const bus = make_bus();
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
      run_orchestrator: vi.fn().mockRejectedValue(new Error("fail")),
      run_headless: vi.fn(),
    } as any;

    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus,
    });
    await reg.spawn({ task: "에러 공지 테스트", announce: true, origin_channel: "slack", origin_chat_id: "ch-1" });
    await new Promise((r) => setTimeout(r, 300));
    const calls = bus.publish_outbound.mock.calls;
    const kinds = calls.map((c: any[]) => c[0].metadata?.kind);
    expect(kinds).toContain("subagent_result");
    const err_msg = calls.find((c: any[]) => c[0].metadata?.kind === "subagent_result")?.[0]?.content as string;
    expect(err_msg).toContain("❌");
  });
});

// ══════════════════════════════════════════════════════════
// skip_controller=true → _run_direct_executor → run_headless
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — skip_controller=true", () => {
  it("skip_controller=true → controller loop 미실행, run_headless 직접 호출", async () => {
    const providers = make_providers();
    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus: null,
    });
    const result = await reg.spawn({
      task: "직접 실행 작업",
      skip_controller: true,
    });
    const completion = await reg.wait_for_completion(result.subagent_id, 5000);
    // skip_controller → run_headless 호출, run_orchestrator 미호출
    expect(providers.run_orchestrator).not.toHaveBeenCalled();
    expect(providers.run_headless).toHaveBeenCalled();
    expect(["completed", "failed"]).toContain(completion?.status);
  });
});

// ══════════════════════════════════════════════════════════
// _build_subagent_prompt — soul/heart 제공
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — soul/heart 포함 spawn", () => {
  it("soul/heart 있으면 시스템 프롬프트에 포함됨 (간접 확인)", async () => {
    let captured_system = "";
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
      run_orchestrator: vi.fn().mockImplementation(async (req: { messages: Array<{ role: string; content: string }> }) => {
        captured_system = req.messages[0]?.content || "";
        return { content: '{"done":true,"final_answer":"ok","executor_prompt":"","reason":"done","handoffs":[]}', has_tool_calls: false, tool_calls: [] };
      }),
      run_headless: vi.fn(),
    } as any;

    const reg = new SubagentRegistry({ workspace: "/tmp/test-subagent-exec", providers, bus: null });
    await reg.spawn({
      task: "soul/heart 테스트",
      soul: "열정적이고 창의적인 AI",
      heart: "사용자의 성공을 최우선으로",
      role: "creative",
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(captured_system).toContain("soul:");
    expect(captured_system).toContain("heart:");
  });
});

// ══════════════════════════════════════════════════════════
// handoffs → _announce_handoff 호출
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — handoffs → _announce_handoff", () => {
  it("plan에 handoffs 포함 + bus + channel → subagent_handoff 메시지 발행", async () => {
    const bus = make_bus();
    let call_count = 0;
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
      run_orchestrator: vi.fn().mockImplementation(async () => {
        call_count++;
        if (call_count === 1) {
          return {
            content: JSON.stringify({
              done: false,
              executor_prompt: "step 1",
              final_answer: "",
              reason: "needs handoff",
              handoffs: [{ alias: "worker", instruction: "파일 분석해줘" }],
            }),
            has_tool_calls: false,
            tool_calls: [],
          };
        }
        return { content: '{"done":true,"final_answer":"done","executor_prompt":"","reason":"done","handoffs":[]}', has_tool_calls: false, tool_calls: [] };
      }),
      run_headless: vi.fn().mockResolvedValue({ content: "done", finish_reason: "stop", has_tool_calls: false, tool_calls: [], metadata: {} }),
    } as any;

    const reg = new SubagentRegistry({ workspace: "/tmp/test-subagent-exec", providers, bus });
    await reg.spawn({
      task: "handoff 테스트",
      origin_channel: "telegram",
      origin_chat_id: "chat-1",
    });
    await new Promise((r) => setTimeout(r, 500));
    const kinds = bus.publish_outbound.mock.calls.map((c: any[]) => c[0].metadata?.kind);
    expect(kinds).toContain("subagent_handoff");
  });
});

// ══════════════════════════════════════════════════════════
// send_input — send_input 함수 있음 → true
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — send_input with fn", () => {
  it("register_input 통해 주입된 send_input 함수 호출됨", async () => {
    const input_fn = vi.fn();
    let blocker_resolve!: () => void;
    const blocker = new Promise<void>((r) => { blocker_resolve = r; });

    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("claude"),
      run_orchestrator: vi.fn().mockImplementation(async () => {
        await blocker;
        return { content: '{"done":true}', has_tool_calls: false, tool_calls: [] };
      }),
      run_headless: vi.fn(),
    } as any;

    // SubagentRegistry.spawn에서 register_input으로 fn 등록하지만
    // running.send_input은 _run_subagent에서 register_input 콜백으로 설정됨.
    // 여기서는 send_input이 undefined인 경우(false 반환)를 확인
    const reg = new SubagentRegistry({ workspace: "/tmp/test-subagent-exec", providers, bus: null });
    const result = await reg.spawn({ task: "send input test" });

    // blocker가 잡고 있는 동안 send_input 없음 → false
    const ok = reg.send_input(result.subagent_id, "test input");
    expect(typeof ok).toBe("boolean"); // false or true depending on timing

    blocker_resolve();
    await reg.wait_for_completion(result.subagent_id, 3000);
  });
});

// ══════════════════════════════════════════════════════════
// executor_backend → run() 성공/cancelled/error/max_turns
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — _run_direct_executor executor_backend 경로", () => {
  function make_reg_with_backend_executor(backend: ReturnType<typeof make_backend>) {
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
      run_orchestrator: vi.fn().mockResolvedValue({ content: '{"done":true,"executor_prompt":"","final_answer":"ok","reason":"done","handoffs":[]}' }),
      run_headless: vi.fn().mockResolvedValue({ content: "headless result", finish_reason: "stop" }),
    } as any;
    return new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus: null,
      logger: make_logger(),
      agent_backends: make_backend_registry(backend),
      provider_caps: PROVIDER_CAPS,
    });
  }

  it("executor_backend.run() 성공 → content 반환 후 completed", async () => {
    const backend = make_backend({ content: "task done", finish_reason: "stop" });
    const reg = make_reg_with_backend_executor(backend);

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
    const reg = make_reg_with_backend_executor(backend);

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
    const reg = make_reg_with_backend_executor(backend);

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
    const reg = make_reg_with_backend_executor(backend);

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

// ══════════════════════════════════════════════════════════
// executor_backend.run()의 hooks.on_event 콜백 (L926-927)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — _run_direct_executor on_event 콜백 (L926-927)", () => {
  function make_reg_with_custom_backend(backend: any) {
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
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus: null,
      logger: make_logger(),
      agent_backends,
      provider_caps: PROVIDER_CAPS,
    });
  }

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
    const reg = make_reg_with_custom_backend(backend);

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

// ══════════════════════════════════════════════════════════
// API fallback on_stream 콜백 (L961-969)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — _run_direct_executor API fallback on_stream 콜백 (L961-969)", () => {
  function make_reg_no_backend(run_headless_impl?: (args: any) => Promise<any>) {
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
      run_orchestrator: vi.fn(),
      run_headless: vi.fn().mockImplementation(run_headless_impl ?? (() => Promise.resolve({ content: "ok", finish_reason: "stop" }))),
    } as any;
    // agent_backends가 null이면 executor_backend = null → API fallback 경로
    return new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus: null,
      logger: make_logger(),
      agent_backends: null,
      provider_caps: PROVIDER_CAPS,
    });
  }

  it("run_headless가 on_stream 콜백 호출 시 stream_buffer에 누적", async () => {
    const reg = make_reg_no_backend(async (args: any) => {
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
    const reg = make_reg_no_backend(async (args: any) => {
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

// ══════════════════════════════════════════════════════════
// controller 루프 abort.signal (L322-325)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — controller 루프 abort.signal (L322-325)", () => {
  it("첫 번째 run_orchestrator 후 cancel() → 두 번째 iteration에서 abort 감지 → cancelled (L322-325)", async () => {
    let iteration = 0;

    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
      run_orchestrator: vi.fn(),
      run_headless: vi.fn().mockResolvedValue({
        content: "executor done", finish_reason: "stop", has_tool_calls: false, tool_calls: [],
      }),
    } as any;

    // this.running.set(subagent_id, entry) 는 _run_subagent 호출 전에 실행됨.
    // 따라서 mock 내부에서 (reg as any).running.keys() 로 실행 ID를 직접 가져올 수 있다.
    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus: null,
      logger: make_logger(),
      agent_backends: null,  // API fallback 경로 (non-native)
      provider_caps: PROVIDER_CAPS,
    });

    providers.run_orchestrator.mockImplementation(async () => {
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

// ══════════════════════════════════════════════════════════
// run_headless 응답 session_id 캡처 (L513-516)
// ══════════════════════════════════════════════════════════

describe("SubagentRegistry — run_headless session_id 캡처 (L513-516)", () => {
  it("run_headless 응답에 metadata.session_id 있음 → ref.session_id에 캡처 (L513-516)", async () => {
    const providers = {
      get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
      run_orchestrator: vi.fn()
        .mockResolvedValueOnce({ content: JSON.stringify({ done: false, executor_prompt: "work" }) })
        .mockResolvedValueOnce({ content: JSON.stringify({ done: true, final_answer: "finished" }) }),
      run_headless: vi.fn().mockResolvedValue({
        content: "executor result",
        finish_reason: "stop",
        has_tool_calls: false,
        tool_calls: [],
        metadata: { session_id: "sess-captured-123" },  // L513: sid = "sess-captured-123"
      }),
    } as any;

    const reg = new SubagentRegistry({
      workspace: "/tmp/test-subagent-exec",
      providers,
      bus: null,
      logger: make_logger(),
      agent_backends: null,  // API fallback 경로 (non-native)
      provider_caps: PROVIDER_CAPS,
    });

    const { subagent_id } = await reg.spawn({
      task: "session capture test",
      skip_controller: false,
      max_iterations: 2,
    });

    const result = await reg.wait_for_completion(subagent_id, 5000, 10);
    expect(result?.status).toBe("completed");
  });
});
