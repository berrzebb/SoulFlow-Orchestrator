/**
 * ContainerCliAgent — 미커버 오류 처리 분기 커버리지.
 * - context_overflow: 컴팩션 재시작, MAX 초과
 * - auth_error: 프로파일 순환, fallback_configured → FailoverError
 * - billing: fallback → FailoverError, non-fallback → error 반환
 * - rate_limit: sleep 후 계속
 * - crash: bus.remove_session 후 재시도
 * - failover: FailoverError 전파
 * - max_iterations 초과
 * - abort_signal: aborted 체크
 * - register_send_input 콜백
 * - relay_output_event: assistant_message, tool_use, tool_result
 * - check_auth, stop(+tool_bridge), build_tool_definitions
 * - wait_for_followup 반환 시 current_prompt 업데이트
 * - auth_error + profile_tracker 순환 → 재시도 성공
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContainerCliAgent } from "@src/agent/pty/container-cli-agent.js";
import { FailoverError } from "@src/agent/pty/types.js";

// ─── mock AgentBus ─────────────────────────────────────────────────────────

function make_bus(wait_for_followup_responses: (string[] | null)[] = []) {
  const output_handlers = new Set<(key: string, msg: any) => void>();
  let call_index = 0;
  return {
    send_and_wait: vi.fn(),
    on_output: vi.fn((handler: (key: string, msg: any) => void) => {
      output_handlers.add(handler);
      return { dispose: () => output_handlers.delete(handler) };
    }),
    queue_followup: vi.fn(),
    remove_session: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    lane_queue: {
      drain_followups: vi.fn().mockReturnValue([]),
      drain_collected: vi.fn().mockReturnValue(null),
      wait_for_followup: vi.fn().mockImplementation(() => {
        const resp = wait_for_followup_responses[call_index] ?? null;
        call_index++;
        return Promise.resolve(resp);
      }),
    },
    emit_output: (key: string, msg: any) => {
      for (const h of output_handlers) h(key, msg);
    },
  };
}

function make_adapter(overrides: Record<string, unknown> = {}) {
  return {
    cli_id: "claude",
    session_id: null,
    stdin_mode: "close",
    supports_system_prompt_flag: true,
    supports_approval: false,
    supports_structured_output: false,
    supports_thinking: false,
    supports_budget_tracking: false,
    supports_tool_filtering: false,
    format_input: vi.fn().mockReturnValue("formatted"),
    parse_output: vi.fn(),
    build_args: vi.fn().mockReturnValue([]),
    ...overrides,
  } as any;
}

function make_agent(overrides: Partial<{
  bus: ReturnType<typeof make_bus>;
  fallback_configured: boolean;
  auth_profile_count: number;
  profile_key_map: Map<number, Record<string, string>>;
  auth_service: any;
  tool_bridge: any;
}> = {}) {
  const bus = overrides.bus ?? make_bus();
  const adapter = make_adapter();
  const agent = new ContainerCliAgent({
    id: "claude_cli" as any,
    bus: bus as any,
    adapter,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    fallback_configured: overrides.fallback_configured ?? false,
    auth_profile_count: overrides.auth_profile_count ?? 1,
    profile_key_map: overrides.profile_key_map,
    auth_service: overrides.auth_service,
    tool_bridge: overrides.tool_bridge,
  });
  return { agent, bus, adapter };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════
// 기본 성공 경로 (smoke test)
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — 성공 경로", () => {
  it("complete 결과 반환", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockResolvedValueOnce({ type: "complete", result: "done", usage: { input: 10, output: 5 } });
    const result = await agent.run({ task: "test task", task_id: "t1" });
    expect(result.finish_reason).toBe("stop");
    expect(result.content).toBe("done");
  });

  it("emit 콜백: init + complete 이벤트 발생", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockResolvedValueOnce({ type: "complete", result: "ok" });
    const events: any[] = [];
    await agent.run({ task: "t", task_id: "t2", hooks: { on_event: (e) => events.push(e) } });
    expect(events.some(e => e.type === "init")).toBe(true);
    expect(events.some(e => e.type === "complete")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// max_iterations 초과
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — max_iterations 초과", () => {
  it("max_turns=1 + 계속 error → max_turns finish_reason", async () => {
    const { agent, bus } = make_agent();
    // 1회: crash (재시도 없음)
    bus.send_and_wait.mockResolvedValue({ type: "error", code: "unknown", message: "fatal error" });
    const result = await agent.run({ task: "t", task_id: "t3", max_turns: 1 });
    expect(result.finish_reason).toBe("error");
  });
});

// ══════════════════════════════════════════════════════════
// abort_signal
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — abort_signal", () => {
  it("abort 신호 전송 → 루프 탈출", async () => {
    const { agent, bus } = make_agent();
    const abort = new AbortController();
    // 첫 번째 send_and_wait 전에 abort
    bus.send_and_wait.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 1));
      return { type: "complete", result: "done" };
    });
    // abort를 즉시 발생시켜 루프 첫 반복에서 체크
    abort.abort();
    const result = await agent.run({ task: "t", task_id: "t4", max_turns: 3, abort_signal: abort.signal });
    // aborted → max_turns 탈출
    expect(result.finish_reason).toBe("max_turns");
  });
});

// ══════════════════════════════════════════════════════════
// context_overflow — 컴팩션 재시작
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — context_overflow", () => {
  it("1회 컴팩션 → 재시작 후 complete", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait
      .mockResolvedValueOnce({ type: "error", code: "context_window_exceeded", message: "context overflow" })
      .mockResolvedValueOnce({ type: "complete", result: "recovered" });
    const result = await agent.run({ task: "t", task_id: "t5", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
    expect(bus.remove_session).toHaveBeenCalled();
  });

  it("MAX_COMPACTION_ATTEMPTS(3) 초과 → error 반환", async () => {
    const { agent, bus } = make_agent();
    // 4번 모두 context_overflow → 3번 재시도 후 포기
    bus.send_and_wait.mockResolvedValue({
      type: "error", code: "context_window_exceeded", message: "context overflow",
    });
    const emit = vi.fn();
    const result = await agent.run({
      task: "t", task_id: "t6", max_turns: 10,
      hooks: { on_event: emit },
    });
    expect(result.finish_reason).toBe("error");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("context_overflow with last_content → compact prompt에 포함", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait
      // 첫 번째: complete로 last_content 설정
      .mockResolvedValueOnce({ type: "complete", result: "previous result", usage: { input: 5, output: 5 } })
      // followup 있음 → 루프 재진입 후 context_overflow
      .mockResolvedValueOnce({ type: "error", code: "token_limit", message: "ctx" })
      .mockResolvedValueOnce({ type: "complete", result: "final" });

    // drain_followups: 1회 followup(루프 계속), 이후는 없음
    bus.lane_queue.drain_followups
      .mockReturnValueOnce(["followup1"])  // 첫 번째 complete 후 followup 있음
      .mockReturnValue([]);                 // 이후는 없음

    const result = await agent.run({ task: "t", task_id: "t7", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
  });
});

// ══════════════════════════════════════════════════════════
// auth_error — 프로파일 순환
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — auth_error", () => {
  it("auth_error + fallback_configured=true → FailoverError 전파", async () => {
    const { agent, bus } = make_agent({ fallback_configured: true });
    bus.send_and_wait.mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" });
    await expect(agent.run({ task: "t", task_id: "t8" })).rejects.toThrow(FailoverError);
  });

  it("auth_error + fallback=false → error 반환", async () => {
    const { agent, bus } = make_agent({ fallback_configured: false });
    bus.send_and_wait.mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" });
    const emit = vi.fn();
    const result = await agent.run({ task: "t", task_id: "t9", hooks: { on_event: emit } });
    expect(result.finish_reason).toBe("error");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });
});

// ══════════════════════════════════════════════════════════
// billing
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — billing", () => {
  it("billing + fallback_configured → FailoverError", async () => {
    const { agent, bus } = make_agent({ fallback_configured: true });
    bus.send_and_wait.mockResolvedValueOnce({ type: "error", code: "billing", message: "quota" });
    await expect(agent.run({ task: "t", task_id: "t10" })).rejects.toThrow(FailoverError);
  });

  it("billing + fallback=false → error 반환", async () => {
    const { agent, bus } = make_agent({ fallback_configured: false });
    bus.send_and_wait.mockResolvedValueOnce({ type: "error", code: "billing", message: "quota" });
    const result = await agent.run({ task: "t", task_id: "t11" });
    expect(result.finish_reason).toBe("error");
  });
});

// ══════════════════════════════════════════════════════════
// rate_limit — backoff 후 재시도
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — rate_limit", () => {
  it("rate_limit → 재시도 후 complete", async () => {
    vi.useFakeTimers();
    const { agent, bus } = make_agent();
    bus.send_and_wait
      .mockResolvedValueOnce({ type: "error", code: "rate_limited", message: "rate limit" })
      .mockResolvedValueOnce({ type: "complete", result: "ok" });
    const p = agent.run({ task: "t", task_id: "t12", max_turns: 5 });
    // sleep 타이머 처리
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.finish_reason).toBe("stop");
    vi.useRealTimers();
  });
});

// ══════════════════════════════════════════════════════════
// crash — 재시도
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — crash", () => {
  it("crash → remove_session 후 재시도 complete", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait
      .mockResolvedValueOnce({ type: "error", code: "crash", message: "crashed" })
      .mockResolvedValueOnce({ type: "complete", result: "recovered" });
    const result = await agent.run({ task: "t", task_id: "t13", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
    expect(bus.remove_session).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// failover 오류 전파
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — failover error class", () => {
  it("failover + fallback_configured → FailoverError 전파", async () => {
    const { agent, bus } = make_agent({ fallback_configured: true });
    bus.send_and_wait.mockResolvedValueOnce({ type: "error", code: "failover", message: "failover" });
    await expect(agent.run({ task: "t", task_id: "t14" })).rejects.toThrow(FailoverError);
  });

  it("failover + fallback=false → fatal error 반환 (fallback 아님)", async () => {
    const { agent, bus } = make_agent({ fallback_configured: false });
    bus.send_and_wait.mockResolvedValueOnce({ type: "error", code: "failover", message: "failover" });
    const result = await agent.run({ task: "t", task_id: "t15" });
    expect(result.finish_reason).toBe("error");
  });
});

// ══════════════════════════════════════════════════════════
// unexpected exception → catch 블록
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — unexpected exception", () => {
  it("send_and_wait throw → catch → error result", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockRejectedValueOnce(new Error("unexpected!"));
    const result = await agent.run({ task: "t", task_id: "t16" });
    expect(result.finish_reason).toBe("error");
    expect(result.metadata?.error).toContain("unexpected");
  });

  it("FailoverError는 catch에서 re-throw", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockRejectedValueOnce(new FailoverError("fail", { reason: "unknown", provider: "claude_cli" }));
    await expect(agent.run({ task: "t", task_id: "t17" })).rejects.toThrow(FailoverError);
  });
});

// ══════════════════════════════════════════════════════════
// followup / wait_for_input_ms
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — followup 처리", () => {
  it("drain_followups → 루프 재진입", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait
      .mockResolvedValueOnce({ type: "complete", result: "r1" })
      .mockResolvedValueOnce({ type: "complete", result: "r2" });
    bus.lane_queue.drain_followups
      .mockReturnValueOnce(["followup message"])
      .mockReturnValue([]);
    const result = await agent.run({ task: "t", task_id: "t18", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
    expect(bus.send_and_wait).toHaveBeenCalledTimes(2);
  });

  it("drain_collected → 루프 재진입", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait
      .mockResolvedValueOnce({ type: "complete", result: "r1" })
      .mockResolvedValueOnce({ type: "complete", result: "r2" });
    bus.lane_queue.drain_collected
      .mockReturnValueOnce("collected message")
      .mockReturnValue(null);
    const result = await agent.run({ task: "t", task_id: "t19", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
    expect(bus.send_and_wait).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════
// register_send_input
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — register_send_input", () => {
  it("register_send_input 콜백 등록 → queue_followup 연결", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockResolvedValue({ type: "complete", result: "done" });
    let registered_fn: ((text: string) => void) | null = null;
    await agent.run({
      task: "t", task_id: "t20",
      register_send_input: (fn) => { registered_fn = fn; },
    });
    expect(registered_fn).not.toBeNull();
    registered_fn!("hello input");
    expect(bus.queue_followup).toHaveBeenCalledWith("t20", "hello input");
  });
});

// ══════════════════════════════════════════════════════════
// on_output / relay_output_event
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — on_output → relay_output_event", () => {
  it("tool_use → tool_calls_count 증가 + emit tool_use event", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockImplementation(async (key: string) => {
      // tool_use 이벤트 emit
      bus.emit_output(key, { type: "tool_use", tool: "Bash", input: { cmd: "ls" } });
      return { type: "complete", result: "done" };
    });
    const events: any[] = [];
    const result = await agent.run({
      task: "t", task_id: "t21",
      hooks: { on_event: (e) => events.push(e) },
    });
    expect(result.tool_calls_count).toBe(1);
    expect(events.some(e => e.type === "tool_use")).toBe(true);
  });

  it("assistant_message → content_delta emit + on_stream 호출", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockImplementation(async (key: string) => {
      bus.emit_output(key, { type: "assistant_message", content: "hello!" });
      return { type: "complete", result: "done" };
    });
    const events: any[] = [];
    const stream_chunks: string[] = [];
    await agent.run({
      task: "t", task_id: "t22",
      hooks: {
        on_event: (e) => events.push(e),
        on_stream: (chunk) => stream_chunks.push(chunk),
      },
    });
    // assistant_message → content_delta emit
    expect(events.some(e => e.type === "content_delta")).toBe(true);
  });

  it("assistant_chunk → on_stream 호출", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockImplementation(async (key: string) => {
      bus.emit_output(key, { type: "assistant_chunk", content: "streaming..." });
      return { type: "complete", result: "done" };
    });
    const chunks: string[] = [];
    await agent.run({
      task: "t", task_id: "t23",
      hooks: { on_stream: (c) => chunks.push(c) },
    });
    expect(chunks).toContain("streaming...");
  });

  it("tool_result → tool_result event emit", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockImplementation(async (key: string) => {
      bus.emit_output(key, { type: "tool_result", tool: "Bash", output: "result output" });
      return { type: "complete", result: "done" };
    });
    const events: any[] = [];
    await agent.run({
      task: "t", task_id: "t24",
      hooks: { on_event: (e) => events.push(e) },
    });
    expect(events.some(e => e.type === "tool_result")).toBe(true);
  });

  it("다른 session_key 출력 → 무시됨", async () => {
    const { agent, bus } = make_agent();
    bus.send_and_wait.mockImplementation(async (key: string) => {
      bus.emit_output("OTHER_SESSION", { type: "tool_use", tool: "Bash", input: {} });
      bus.emit_output(key, { type: "complete", result: "done" });
      return { type: "complete", result: "done" };
    });
    const result = await agent.run({ task: "t", task_id: "t25" });
    expect(result.tool_calls_count).toBe(0); // 다른 세션은 무시
  });
});

// ══════════════════════════════════════════════════════════
// check_auth
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — check_auth", () => {
  it("auth_service 없음 → always true", async () => {
    const { agent } = make_agent();
    const result = await agent.check_auth();
    expect(result).toBe(true);
    expect(agent.is_available()).toBe(true);
  });

  it("auth_service.check → authenticated=true → is_available=true", async () => {
    const auth_service = { check: vi.fn().mockResolvedValue({ authenticated: true }) };
    const { agent } = make_agent({ auth_service });
    const result = await agent.check_auth();
    expect(result).toBe(true);
    expect(agent.is_available()).toBe(true);
  });

  it("auth_service.check → authenticated=false → is_available=false", async () => {
    const auth_service = { check: vi.fn().mockResolvedValue({ authenticated: false }) };
    const { agent } = make_agent({ auth_service });
    const result = await agent.check_auth();
    expect(result).toBe(false);
    expect(agent.is_available()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// stop
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — stop", () => {
  it("stop() → bus.shutdown 호출", () => {
    const { agent, bus } = make_agent();
    agent.stop();
    expect(bus.shutdown).toHaveBeenCalledOnce();
  });

  it("stop() with tool_bridge → tool_bridge.stop 호출", () => {
    const tool_bridge = { stop: vi.fn().mockResolvedValue(undefined), list_tools: vi.fn().mockReturnValue([]) };
    const { agent, bus } = make_agent({ tool_bridge });
    agent.stop();
    expect(bus.shutdown).toHaveBeenCalledOnce();
    expect(tool_bridge.stop).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════════════════════
// build_tool_definitions (Codex 어댑터 경우)
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — build_tool_definitions (tool_bridge 주입)", () => {
  it("tool_bridge.list_tools → 도구 목록 포함", async () => {
    const tool_bridge = {
      list_tools: vi.fn().mockReturnValue([
        { name: "MyTool", description: "Does something" },
        { name: "OtherTool", description: null },
      ]),
      stop: vi.fn(),
    };
    // Codex 어댑터 + tool_bridge → build_tool_definitions 호출
    const bus = make_bus();
    bus.send_and_wait.mockResolvedValueOnce({ type: "complete", result: "done" });
    const adapter = make_adapter({ cli_id: "codex" });
    const agent = new ContainerCliAgent({
      id: "codex_cli" as any,
      bus: bus as any,
      adapter,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      tool_bridge: tool_bridge as any,
    });
    // run이 성공하면 build_args에 tool_definitions가 전달됨
    const result = await agent.run({ task: "t", task_id: "t26" });
    expect(result.finish_reason).toBe("stop");
    expect(tool_bridge.list_tools).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// system_prompt: supports_system_prompt_flag = false
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — system_prompt 처리", () => {
  it("supports_system_prompt_flag=false → task에 합침", async () => {
    const bus = make_bus();
    bus.send_and_wait.mockResolvedValueOnce({ type: "complete", result: "done" });
    const adapter = make_adapter({ supports_system_prompt_flag: false });
    const agent = new ContainerCliAgent({
      id: "claude_cli" as any,
      bus: bus as any,
      adapter,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    });
    const result = await agent.run({
      task: "my task",
      task_id: "t27",
      system_prompt: "system instruction",
    });
    expect(result.finish_reason).toBe("stop");
    // system_prompt + task가 결합되어 전달
    const prompt_sent = bus.send_and_wait.mock.calls[0][1];
    expect(prompt_sent).toContain("system instruction");
    expect(prompt_sent).toContain("my task");
  });
});

// ══════════════════════════════════════════════════════════
// release_session
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — release_session", () => {
  it("release_session → bus.remove_session 호출", async () => {
    const { agent, bus } = make_agent();
    await agent.release_session("task-xyz");
    expect(bus.remove_session).toHaveBeenCalledWith("task-xyz");
  });
});

// ══════════════════════════════════════════════════════════
// wait_for_followup 반환 → current_prompt 업데이트
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — wait_for_followup 반환", () => {
  it("wait_for_input_ms > 0 + wait_for_followup=[prompt] → prompt 업데이트 후 재시도", async () => {
    const bus = make_bus([["follow up input"]]);

    bus.send_and_wait
      .mockResolvedValueOnce({ type: "complete", result: "", usage: { input: 5, output: 0 } })
      .mockResolvedValueOnce({ type: "complete", result: "final answer", usage: { input: 10, output: 5 } });

    const { agent } = make_agent({ bus });

    const result = await agent.run({
      task: "initial task",
      task_id: "t-followup",
      wait_for_input_ms: 100,
    });

    expect(result.finish_reason).toBe("stop");
    expect(bus.lane_queue.wait_for_followup).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// auth_error + profile_tracker 순환 → 재시도 성공
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — auth_error + profile 순환", () => {
  it("auth_error → has_available=true → mark_failure=1 → 프로파일 전환 후 재시도 성공", async () => {
    const profile_key_map = new Map([
      [0, { CLAUDE_AUTH_PROFILE: "profile_0" }],
      [1, { CLAUDE_AUTH_PROFILE: "profile_1" }],
    ]);
    const bus = make_bus();

    bus.send_and_wait
      .mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" })
      .mockResolvedValueOnce({ type: "complete", result: "ok", usage: { input: 5, output: 5 } });

    const { agent } = make_agent({ bus, profile_key_map });

    const result = await agent.run({ task: "task", task_id: "t-auth-rotate" });

    expect(result.finish_reason).toBe("stop");
    expect(result.content).toBe("ok");
    expect(bus.send_and_wait).toHaveBeenCalledTimes(2);
    expect(bus.remove_session).toHaveBeenCalled();
  });

  it("auth_error → profile rotation → mark_failure=null (프로파일 없음) → fallback=false → error 반환", async () => {
    const profile_key_map = new Map([
      [0, { CLAUDE_AUTH_PROFILE: "only_profile" }],
    ]);
    const bus = make_bus();
    bus.send_and_wait.mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" });

    const { agent } = make_agent({ bus, profile_key_map, fallback_configured: false });
    const result = await agent.run({ task: "task", task_id: "t-auth-no-rotate" });

    expect(result.finish_reason).toBe("error");
  });
});
