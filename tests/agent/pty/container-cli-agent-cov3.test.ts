/**
 * ContainerCliAgent — 미커버 분기 추가 커버리지.
 * - wait_for_followup 반환 시 current_prompt 업데이트 (L212-213)
 * - auth_error + profile_tracker.has_available() → 프로파일 순환 (L250-256)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContainerCliAgent } from "@src/agent/pty/container-cli-agent.js";

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

function make_adapter() {
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
  } as any;
}

function make_agent_with_bus(bus: ReturnType<typeof make_bus>, extra: {
  profile_key_map?: Map<number, Record<string, string>>;
  fallback_configured?: boolean;
} = {}) {
  const adapter = make_adapter();
  const agent = new ContainerCliAgent({
    id: "claude_cli" as any,
    bus: bus as any,
    adapter,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    fallback_configured: extra.fallback_configured ?? false,
    auth_profile_count: extra.profile_key_map?.size ?? 1,
    profile_key_map: extra.profile_key_map,
  });
  return { agent, bus, adapter };
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════════════════════
// wait_for_followup 반환 → current_prompt 업데이트 (L212-213)
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — wait_for_followup 반환 (L212-213)", () => {
  it("wait_for_input_ms > 0 + wait_for_followup=[prompt] → prompt 업데이트 후 재시도", async () => {
    // 1. 첫 번째 send_and_wait: content='' (빈 결과 → wait_for_followup 분기 진입)
    // 2. wait_for_followup: ["follow up input"] 반환 (current_prompt 업데이트 + continue)
    // 3. 두 번째 send_and_wait: complete (성공)
    const bus = make_bus([["follow up input"]]);

    bus.send_and_wait
      .mockResolvedValueOnce({ type: "complete", result: "", usage: { input: 5, output: 0 } }) // content="" → wait_for_followup 분기
      .mockResolvedValueOnce({ type: "complete", result: "final answer", usage: { input: 10, output: 5 } }); // 재시도 성공

    const { agent } = make_agent_with_bus(bus);

    const result = await agent.run({
      task: "initial task",
      task_id: "t-followup",
      wait_for_input_ms: 100, // wait_for_followup 분기 활성화
    });

    // wait_for_followup가 반환되고 재시도로 최종 성공
    expect(result.finish_reason).toBe("stop");
    // wait_for_followup가 호출됨
    expect(bus.lane_queue.wait_for_followup).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// auth_error + profile_tracker 순환 → 재시도 성공 (L250-256)
// ══════════════════════════════════════════════════════════

describe("ContainerCliAgent — auth_error + profile 순환 (L250-256)", () => {
  it("auth_error → has_available=true → mark_failure=1 → 프로파일 전환 후 재시도 성공", async () => {
    // profile_key_map에 2개 프로파일: 0번 → 1번으로 전환
    const profile_key_map = new Map([
      [0, { CLAUDE_AUTH_PROFILE: "profile_0" }],
      [1, { CLAUDE_AUTH_PROFILE: "profile_1" }],
    ]);
    const bus = make_bus();

    bus.send_and_wait
      .mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" }) // 프로파일 0 실패
      .mockResolvedValueOnce({ type: "complete", result: "ok", usage: { input: 5, output: 5 } }); // 프로파일 1 성공

    const { agent } = make_agent_with_bus(bus, { profile_key_map });

    const result = await agent.run({ task: "task", task_id: "t-auth-rotate" });

    // 프로파일 전환 후 두 번째 시도 성공
    expect(result.finish_reason).toBe("stop");
    expect(result.content).toBe("ok");
    // send_and_wait가 2번 호출됨 (첫 실패 + 재시도)
    expect(bus.send_and_wait).toHaveBeenCalledTimes(2);
    // remove_session이 호출됨 (세션 교체)
    expect(bus.remove_session).toHaveBeenCalled();
  });

  it("auth_error → profile rotation → mark_failure=null (프로파일 없음) → fallback=false → error 반환", async () => {
    // profile_key_map 크기 = 1 → profile_tracker = null → has_available 미호출
    const profile_key_map = new Map([
      [0, { CLAUDE_AUTH_PROFILE: "only_profile" }],
    ]);
    const bus = make_bus();
    bus.send_and_wait.mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" });

    const { agent } = make_agent_with_bus(bus, { profile_key_map, fallback_configured: false });
    const result = await agent.run({ task: "task", task_id: "t-auth-no-rotate" });

    // profile_tracker=null → fallback=false → error 반환
    expect(result.finish_reason).toBe("error");
  });
});
