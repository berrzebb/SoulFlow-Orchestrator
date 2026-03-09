/**
 * SubagentRegistry — 추가 미커버 private 메서드 (cov6).
 * - _announce_result(): bus + channel + chat_id, is_error=true
 * - _announce_handoff(): bus + channel + chat_id
 * - _flush_stream_buffer(): non-empty buffer → _announce_progress 호출
 * - _assistant_tool_call_message()
 * - _build_subagent_prompt(): soul/heart/contextual 조합
 * - _build_controller_prompt() / _build_executor_prompt(): contextual_system 있음
 * - _fire(): hooks.on_event 있음 / 없음 / throw 시 catch
 */
import { describe, it, expect, vi } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.js";

function make_bus() {
  return {
    publish_outbound: vi.fn().mockResolvedValue(undefined),
    publish_inbound: vi.fn().mockResolvedValue(undefined),
    get_size: vi.fn().mockReturnValue(0),
  } as any;
}

function make_reg(overrides: any = {}) {
  return new SubagentRegistry({
    workspace: "/tmp/test-cov6",
    providers: null,
    bus: overrides.bus || null,
    ...overrides,
  });
}

// ── _announce_result ──────────────────────────────────────

describe("SubagentRegistry — _announce_result", () => {
  it("bus=null → 즉시 반환 (publish_outbound 미호출)", async () => {
    const reg = make_reg();
    await (reg as any)._announce_result({
      subagent_id: "sa1",
      task: "task",
      label: "라벨",
      content: "결과 내용",
      origin_channel: "slack",
      origin_chat_id: "C123",
    });
    // no error
    expect(true).toBe(true);
  });

  it("bus 있지만 origin_channel 없음 → 미발행", async () => {
    const bus = make_bus();
    const reg = make_reg({ bus });
    await (reg as any)._announce_result({
      subagent_id: "sa1",
      task: "task",
      label: "라벨",
      content: "결과",
    });
    expect(bus.publish_outbound).not.toHaveBeenCalled();
  });

  it("bus + channel + chat_id → publish_outbound 호출 (성공)", async () => {
    const bus = make_bus();
    const reg = make_reg({ bus });
    await (reg as any)._announce_result({
      subagent_id: "sa1",
      task: "task",
      label: "라벨",
      content: "결과 내용",
      origin_channel: "slack",
      origin_chat_id: "C123",
    });
    expect(bus.publish_outbound).toHaveBeenCalled();
    const call = bus.publish_outbound.mock.calls[0][0];
    expect(call.content).toContain("✅");
  });

  it("is_error=true → ❌ 아이콘", async () => {
    const bus = make_bus();
    const reg = make_reg({ bus });
    await (reg as any)._announce_result({
      subagent_id: "sa1",
      task: "task",
      label: "라벨",
      content: "에러 내용",
      origin_channel: "telegram",
      origin_chat_id: "12345",
      is_error: true,
    });
    const call = bus.publish_outbound.mock.calls[0][0];
    expect(call.content).toContain("❌");
  });
});

// ── _announce_handoff ─────────────────────────────────────

describe("SubagentRegistry — _announce_handoff", () => {
  it("bus=null → 미발행", async () => {
    const reg = make_reg();
    await (reg as any)._announce_handoff({
      subagent_id: "sa1",
      alias: "worker",
      instruction: "작업 수행",
      origin_channel: "slack",
      origin_chat_id: "C123",
    });
    expect(true).toBe(true);
  });

  it("bus + channel + chat_id → publish_outbound 호출", async () => {
    const bus = make_bus();
    const reg = make_reg({ bus });
    await (reg as any)._announce_handoff({
      subagent_id: "sa1",
      alias: "worker",
      instruction: "작업 수행",
      origin_channel: "slack",
      origin_chat_id: "C123",
    });
    expect(bus.publish_outbound).toHaveBeenCalled();
    const call = bus.publish_outbound.mock.calls[0][0];
    expect(call.content).toContain("@worker");
    expect(call.metadata?.kind).toBe("subagent_handoff");
  });

  it("origin_channel 없음 → 미발행", async () => {
    const bus = make_bus();
    const reg = make_reg({ bus });
    await (reg as any)._announce_handoff({
      subagent_id: "sa1",
      alias: "worker",
      instruction: "작업",
    });
    expect(bus.publish_outbound).not.toHaveBeenCalled();
  });
});

// ── _flush_stream_buffer ──────────────────────────────────

describe("SubagentRegistry — _flush_stream_buffer", () => {
  it("빈 buffer → _announce_progress 미호출", async () => {
    const bus = make_bus();
    const reg = make_reg({ bus });
    await (reg as any)._flush_stream_buffer({
      subagent_id: "sa1",
      label: "라벨",
      origin_channel: "slack",
      origin_chat_id: "C123",
      stream_buffer_ref: () => "",
      clear_stream_buffer: vi.fn(),
    });
    expect(bus.publish_outbound).not.toHaveBeenCalled();
  });

  it("non-empty buffer + bus → publish_outbound 호출 후 clear", async () => {
    const bus = make_bus();
    const reg = make_reg({ bus });
    let buf = "스트리밍 내용";
    const clear = vi.fn(() => { buf = ""; });
    await (reg as any)._flush_stream_buffer({
      subagent_id: "sa1",
      label: "라벨",
      origin_channel: "slack",
      origin_chat_id: "C123",
      stream_buffer_ref: () => buf,
      clear_stream_buffer: clear,
    });
    expect(clear).toHaveBeenCalled();
    expect(bus.publish_outbound).toHaveBeenCalled();
  });
});

// ── _assistant_tool_call_message ──────────────────────────

describe("SubagentRegistry — _assistant_tool_call_message", () => {
  it("tool_calls가 있는 ChatMessage 반환", () => {
    const reg = make_reg();
    const tc = [{ id: "tc1", name: "echo", arguments: { text: "hello" } }];
    const msg = (reg as any)._assistant_tool_call_message("assistant 응답", tc) as any;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("assistant 응답");
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls[0].id).toBe("tc1");
    expect(JSON.parse(msg.tool_calls[0].function.arguments)).toEqual({ text: "hello" });
  });

  it("content=null → 빈 문자열로 변환", () => {
    const reg = make_reg();
    const msg = (reg as any)._assistant_tool_call_message(null, []) as any;
    expect(msg.content).toBe("");
  });
});

// ── _build_subagent_prompt ────────────────────────────────

describe("SubagentRegistry — _build_subagent_prompt", () => {
  it("기본 옵션 → 기본 soul/heart 포함", () => {
    const reg = make_reg();
    const opts = { task: "테스트 태스크", role: "worker" };
    const prompt = (reg as any)._build_subagent_prompt(opts, "sa1");
    expect(prompt).toContain("sa1");
    expect(prompt).toContain("Calm, pragmatic");
    expect(prompt).toContain("Prioritize correctness");
  });

  it("soul/heart 제공 → 커스텀 soul/heart 사용", () => {
    const reg = make_reg();
    const opts = { task: "태스크", soul: "용감한 탐험가", heart: "진실을 추구한다" };
    const prompt = (reg as any)._build_subagent_prompt(opts, "sa1");
    expect(prompt).toContain("용감한 탐험가");
    expect(prompt).toContain("진실을 추구한다");
  });

  it("has_contextual_system=true → soul/heart 기본값 미포함", () => {
    const reg = make_reg();
    const opts = { task: "태스크" };
    const prompt = (reg as any)._build_subagent_prompt(opts, "sa1", true);
    expect(prompt).not.toContain("Calm, pragmatic");
  });

  it("origin_channel / origin_chat_id 없으면 기본값", () => {
    const reg = make_reg();
    const opts = { task: "태스크" };
    const prompt = (reg as any)._build_subagent_prompt(opts, "sa1");
    expect(prompt).toContain("system");
    expect(prompt).toContain("direct");
  });
});

// ── _build_controller_prompt / _build_executor_prompt ─────

describe("SubagentRegistry — _build_controller_prompt / _build_executor_prompt", () => {
  it("_build_controller_prompt: contextual_system 있으면 포함", () => {
    const reg = make_reg();
    const opts = { task: "컨트롤러 태스크" };
    const result = (reg as any)._build_controller_prompt(opts, "sa1", "# 컨텍스트 시스템");
    expect(result).toContain("ContextBuilder System");
    expect(result).toContain("# 컨텍스트 시스템");
    expect(result).toContain("Controller mode");
  });

  it("_build_controller_prompt: contextual_system 없으면 Controller mode만", () => {
    const reg = make_reg();
    const opts = { task: "태스크" };
    const result = (reg as any)._build_controller_prompt(opts, "sa1", "");
    expect(result).toContain("Controller mode");
    expect(result).not.toContain("ContextBuilder System");
  });

  it("_build_executor_prompt: contextual_system 있으면 포함", () => {
    const reg = make_reg();
    const opts = { task: "실행기 태스크" };
    const result = (reg as any)._build_executor_prompt(opts, "sa1", "# 실행기 컨텍스트");
    expect(result).toContain("ContextBuilder System");
    expect(result).toContain("Executor mode");
  });

  it("_build_executor_prompt: contextual_system 없으면 Executor mode만", () => {
    const reg = make_reg();
    const opts = { task: "태스크" };
    const result = (reg as any)._build_executor_prompt(opts, "sa1");
    expect(result).toContain("Executor mode");
    expect(result).not.toContain("ContextBuilder System");
  });
});

// ── _fire ─────────────────────────────────────────────────

describe("SubagentRegistry — _fire", () => {
  it("hooks.on_event 없으면 즉시 반환", () => {
    const reg = make_reg();
    const opts = { task: "태스크" };
    // hooks 없음 → 에러 없이 처리
    (reg as any)._fire(opts, "sa1", "라벨", (s: any) => ({ type: "init", source: s, at: "now" }));
    expect(true).toBe(true);
  });

  it("hooks.on_event 있으면 호출됨", () => {
    const reg = make_reg();
    const on_event = vi.fn();
    const opts = { task: "태스크", hooks: { on_event } };
    (reg as any)._fire(opts, "sa1", "라벨", (s: any) => ({ type: "init", source: s, at: "now" }));
    expect(on_event).toHaveBeenCalled();
  });

  it("hooks.on_event throw → catch로 삼킴 (에러 전파 없음)", () => {
    const reg = make_reg();
    const on_event = vi.fn(() => { throw new Error("hook error"); });
    const opts = { task: "태스크", hooks: { on_event } };
    expect(() => {
      (reg as any)._fire(opts, "sa1", "라벨", (s: any) => ({ type: "init", source: s, at: "now" }));
    }).not.toThrow();
  });
});

// ── _parse_controller_plan 추가 분기 ─────────────────────

describe("SubagentRegistry — _parse_controller_plan 추가", () => {
  it("handoffs에 alias/instruction 없는 항목 → null 필터됨", () => {
    const reg = make_reg();
    const raw = JSON.stringify({
      done: false,
      executor_prompt: "작업",
      handoffs: [
        { alias: "worker", instruction: "수행" },
        { alias: "", instruction: "수행2" }, // alias 없음 → 필터
        { alias: "worker2" }, // instruction 없음 → 필터
      ],
    });
    const plan = (reg as any)._parse_controller_plan(raw);
    expect(plan.handoffs).toHaveLength(1);
    expect(plan.handoffs[0].alias).toBe("worker");
  });

  it("handoffs가 배열이 아니면 빈 배열", () => {
    const reg = make_reg();
    const raw = JSON.stringify({
      done: true,
      final_answer: "완료",
      handoffs: null,
    });
    const plan = (reg as any)._parse_controller_plan(raw);
    expect(plan.handoffs).toEqual([]);
    expect(plan.done).toBe(true);
  });

  it("handoff row가 null/비객체 → 필터됨", () => {
    const reg = make_reg();
    const raw = JSON.stringify({
      done: false,
      executor_prompt: "p",
      handoffs: [null, "string", 42],
    });
    const plan = (reg as any)._parse_controller_plan(raw);
    expect(plan.handoffs).toHaveLength(0);
  });
});
