/** Phase 4.5+: tool-call-handler 모듈 테스트
 *
 * 목표: providers legacy 경로에서 tool_calls 배열 처리 검증
 *       - create_tool_call_handler 반환 함수의 실행
 *       - 도구 실행 및 결과 포맷팅
 *       - 상태 변경 (file_requested, done_sent, tool_count)
 *       - 이벤트 스트리밍 (on_stream, on_tool_block, on_tool_event)
 *       - 결과 잘림 및 에러 처리
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { create_tool_call_handler } from "@src/orchestration/tool-call-handler.js";
import type { ToolCallHandlerDeps, ToolCallState } from "@src/orchestration/tool-call-handler.js";
import { create_tool_output_reducer } from "@src/orchestration/tool-output-reducer.js";
import { StreamBuffer } from "@src/channels/stream-buffer.js";
import type { ToolExecutionContext } from "@src/agent/tools/types.js";
import type { AgentEvent } from "@src/agent/agent.types.js";
import type { Logger } from "@src/logger.js";

/* ── Mock Data ── */

const mockLogger: Partial<Logger> = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockToolContext: ToolExecutionContext = {
  task_id: "task-1",
  signal: undefined as any,
  channel: "slack",
  chat_id: "chat-1",
  sender_id: "user-1",
  reply_to: "msg-1",
};

const createMockDeps = (executionResult = "success"): ToolCallHandlerDeps => ({
  max_tool_result_chars: 500,
  logger: mockLogger as Logger,
  execute_tool: vi.fn(async () => executionResult),
  log_event: vi.fn(),
});

const createMockState = (): ToolCallState => ({
  suppress: false,
  tool_count: 0,
});

/* ── Tests ── */

describe("create_tool_call_handler — 도구 실행 핸들러", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("기본 도구 실행", () => {
    it("단일 도구 호출 → 결과 반환", async () => {
      const deps = createMockDeps("file content");
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      const result = await handler({
        tool_calls: [{ name: "read_file", arguments: { file_path: "/test.txt" } }],
      });

      expect(result).toContain("[tool:read_file]");
      expect(result).toContain("file content");
      expect(state.tool_count).toBe(1);
    });

    it("여러 도구 호출 → 모두 실행 후 결합", async () => {
      const deps = createMockDeps("result");
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      const result = await handler({
        tool_calls: [
          { name: "tool1", arguments: { x: 1 } },
          { name: "tool2", arguments: { y: 2 } },
          { name: "tool3", arguments: { z: 3 } },
        ],
      });

      expect(result).toContain("[tool:tool1]");
      expect(result).toContain("[tool:tool2]");
      expect(result).toContain("[tool:tool3]");
      expect(state.tool_count).toBe(3);
    });

    it("실행 순서 보존 → 결과 순서 일치", async () => {
      let call_count = 0;
      const deps = createMockDeps();
      (deps.execute_tool as any).mockImplementation(async () => {
        call_count += 1;
        return `result-${call_count}`;
      });
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      const result = await handler({
        tool_calls: [
          { name: "first" },
          { name: "second" },
          { name: "third" },
        ],
      });

      const lines = result.split("\n");
      expect(lines[0]).toContain("result-1");
      expect(lines[1]).toContain("result-2");
      expect(lines[2]).toContain("result-3");
    });
  });

  describe("상태 변경", () => {
    it("request_file 도구 호출 → file_requested=true", async () => {
      const deps = createMockDeps("file");
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      await handler({
        tool_calls: [{ name: "request_file", arguments: {} }],
      });

      expect(state.file_requested).toBe(true);
    });

    it("message(phase=done) 호출 → suppress=true, done_sent=true", async () => {
      const deps = createMockDeps("ok");
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      await handler({
        tool_calls: [{ name: "message", arguments: { phase: "done" } }],
      });

      expect(state.suppress).toBe(true);
      expect(state.done_sent).toBe(true);
    });

    it("message(phase≠done) 호출 → 상태 변경 없음", async () => {
      const deps = createMockDeps("ok");
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      await handler({
        tool_calls: [{ name: "message", arguments: { phase: "sending" } }],
      });

      expect(state.suppress).toBe(false);
      expect(state.done_sent).toBeUndefined();
    });

    it("tool_count는 성공/실패 모두 증가", async () => {
      const deps = createMockDeps();
      (deps.execute_tool as any).mockRejectedValueOnce(new Error("fail"));
      (deps.execute_tool as any).mockResolvedValueOnce("ok");

      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      await handler({
        tool_calls: [
          { name: "fail_tool" },
          { name: "ok_tool" },
        ],
      });

      expect(state.tool_count).toBe(2);
    });
  });

  describe("이벤트 스트리밍", () => {
    it("on_tool_event: tool_use 이벤트 발생", async () => {
      const deps = createMockDeps("result");
      const state = createMockState();
      const events: AgentEvent[] = [];

      const handler = create_tool_call_handler(
        deps,
        mockToolContext,
        state,
        {
          buffer: new StreamBuffer(),
          on_tool_event: (e) => events.push(e),
        },
      );

      await handler({
        tool_calls: [{ name: "test_tool", arguments: { arg: "value" } }],
      });

      const tool_use = events.find((e) => e.type === "tool_use");
      expect(tool_use).toBeDefined();
      expect(tool_use?.tool_name).toBe("test_tool");
      expect(tool_use?.params).toEqual({ arg: "value" });
    });

    it("on_tool_event: tool_result 이벤트 발생 (성공)", async () => {
      const deps = createMockDeps("success result");
      const state = createMockState();
      const events: AgentEvent[] = [];

      const handler = create_tool_call_handler(
        deps,
        mockToolContext,
        state,
        {
          buffer: new StreamBuffer(),
          on_tool_event: (e) => events.push(e),
        },
      );

      await handler({
        tool_calls: [{ name: "success_tool" }],
      });

      const result_event = events.find((e) => e.type === "tool_result");
      expect(result_event).toBeDefined();
      expect(result_event?.result).toBe("success result");
      expect(result_event?.is_error).toBe(false);
    });

    it("on_tool_event: tool_result 이벤트 발생 (실패)", async () => {
      const deps = createMockDeps();
      (deps.execute_tool as any).mockRejectedValue(new Error("Tool failed"));
      const state = createMockState();
      const events: AgentEvent[] = [];

      const handler = create_tool_call_handler(
        deps,
        mockToolContext,
        state,
        {
          buffer: new StreamBuffer(),
          on_tool_event: (e) => events.push(e),
        },
      );

      await handler({
        tool_calls: [{ name: "fail_tool" }],
      });

      const result_event = events.find((e) => e.type === "tool_result");
      expect(result_event).toBeDefined();
      expect(result_event?.result).toContain("Tool failed");
      expect(result_event?.is_error).toBe(true);
    });

    it("on_tool_block: 도구 블록 포맷 전달", async () => {
      const deps = createMockDeps("block content");
      const state = createMockState();
      const blocks: string[] = [];

      const handler = create_tool_call_handler(
        deps,
        mockToolContext,
        state,
        {
          buffer: new StreamBuffer(),
          on_tool_block: (block) => blocks.push(block),
        },
      );

      await handler({
        tool_calls: [{ name: "some_tool" }],
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toContain("`some_tool`");
    });

    it("on_stream: on_tool_block 없으면 버퍼에 추가 후 flush", async () => {
      const deps = createMockDeps("stream content");
      const state = createMockState();
      const streamed: string[] = [];

      const handler = create_tool_call_handler(
        deps,
        mockToolContext,
        state,
        {
          buffer: new StreamBuffer(),
          on_stream: (chunk) => streamed.push(chunk),
        },
      );

      await handler({
        tool_calls: [{ name: "stream_tool" }],
      });

      expect(streamed).toHaveLength(1);
      expect(streamed[0]).toContain("`stream_tool`");
    });

    it("on_stream 콜백 에러 격리 → 다른 처리에 영향 없음", async () => {
      const deps = createMockDeps("result");
      const state = createMockState();

      const handler = create_tool_call_handler(
        deps,
        mockToolContext,
        state,
        {
          buffer: new StreamBuffer(),
          on_stream: () => {
            throw new Error("stream callback failed");
          },
        },
      );

      // 에러가 발생하지 않고 정상 완료
      expect(async () => {
        await handler({
          tool_calls: [{ name: "tool1" }],
        });
      }).not.toThrow();
    });
  });

  describe("결과 잘림", () => {
    it("결과가 max_chars 이하 → 그대로 반환", async () => {
      const deps = createMockDeps("short result");
      deps.max_tool_result_chars = 1000;
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      const result = await handler({
        tool_calls: [{ name: "tool" }],
      });

      expect(result).toContain("short result");
      expect(result).not.toContain("...[truncated");
    });

    it("결과가 max_chars 초과 → 앞뒤 일부 + 생략 표시", async () => {
      const longResult = "a".repeat(1000);
      const deps = createMockDeps(longResult);
      deps.max_tool_result_chars = 100;
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      const result = await handler({
        tool_calls: [{ name: "tool" }],
      });

      expect(result).toContain("[truncated");
      expect(result).toContain("...");
    });

    it("error 결과는 잘리지 않음", async () => {
      const deps = createMockDeps();
      (deps.execute_tool as any).mockRejectedValue(new Error("Error message"));
      deps.max_tool_result_chars = 10;
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      const result = await handler({
        tool_calls: [{ name: "tool" }],
      });

      expect(result).toContain("Error message");
    });
  });

  describe("에러 처리", () => {
    it("도구 실행 실패 → error 메시지 포함", async () => {
      const deps = createMockDeps();
      (deps.execute_tool as any).mockRejectedValue(new Error("Connection failed"));
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      const result = await handler({
        tool_calls: [{ name: "network_tool" }],
      });

      expect(result).toContain("error:");
      expect(result).toContain("Connection failed");
    });

    it("도구 실행 실패 → log_event 호출", async () => {
      const deps = createMockDeps();
      (deps.execute_tool as any).mockRejectedValue(new Error("Failed"));
      const state = createMockState();

      const log_ctx = { run_id: "run-1", agent_id: "agent-1", provider: "slack", chat_id: "chat-1" };

      const handler = create_tool_call_handler(
        deps,
        mockToolContext,
        state,
        { buffer: new StreamBuffer(), log_ctx },
      );

      await handler({
        tool_calls: [{ name: "fail_tool" }],
      });

      expect(deps.log_event).toHaveBeenCalled();
      const call = (deps.log_event as any).mock.calls[0][0];
      expect(call.summary).toContain("fail_tool");
      expect(call.summary).toContain("(error)");
    });

    it("도구 실행 성공 → logger.debug 호출", async () => {
      const deps = createMockDeps("ok");
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      await handler({
        tool_calls: [{ name: "debug_tool", arguments: { x: 1 } }],
      });

      expect(deps.logger.debug).toHaveBeenCalledWith(
        "tool_call",
        expect.objectContaining({ name: "debug_tool" }),
      );
      expect(deps.logger.debug).toHaveBeenCalledWith(
        "tool_result",
        expect.objectContaining({ name: "debug_tool" }),
      );
    });
  });

  describe("로깅", () => {
    it("log_event: 도구 실행 성공 시 log_event 호출", async () => {
      const deps = createMockDeps("success");
      const state = createMockState();

      const log_ctx = { run_id: "run-1", agent_id: "agent-1", provider: "slack", chat_id: "chat-1" };

      const handler = create_tool_call_handler(
        deps,
        mockToolContext,
        state,
        { buffer: new StreamBuffer(), log_ctx },
      );

      await handler({
        tool_calls: [{ name: "logged_tool" }],
      });

      expect(deps.log_event).toHaveBeenCalled();
      const call = (deps.log_event as any).mock.calls[0][0];
      expect(call.run_id).toBe("run-1");
      expect(call.task_id).toBe("task-1");
      expect(call.summary).toContain("logged_tool");
    });

    it("log_event: 결과는 500자 이하로 제한", async () => {
      const longResult = "x".repeat(1000);
      const deps = createMockDeps(longResult);
      const state = createMockState();

      const log_ctx = { run_id: "run-1", agent_id: "agent-1", provider: "slack", chat_id: "chat-1" };

      const handler = create_tool_call_handler(
        deps,
        mockToolContext,
        state,
        { buffer: new StreamBuffer(), log_ctx },
      );

      await handler({
        tool_calls: [{ name: "tool" }],
      });

      expect(deps.log_event).toHaveBeenCalled();
      const call = (deps.log_event as any).mock.calls[0][0];
      expect(call.detail.length).toBeLessThanOrEqual(500);
    });
  });

  describe("다양한 도구 조합", () => {
    it("request_file + message(done) + 일반 도구 → 모두 정상 처리", async () => {
      const deps = createMockDeps("ok");
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      await handler({
        tool_calls: [
          { name: "request_file", arguments: { file_path: "/a.txt" } },
          { name: "message", arguments: { phase: "done" } },
          { name: "other_tool" },
        ],
      });

      expect(state.file_requested).toBe(true);
      expect(state.done_sent).toBe(true);
      expect(state.tool_count).toBe(3);
    });

    it("빈 도구 배열 → 빈 결과", async () => {
      const deps = createMockDeps("ok");
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      const result = await handler({
        tool_calls: [],
      });

      expect(result).toBe("");
      expect(state.tool_count).toBe(0);
    });

    it("arguments 없는 도구 호출 → 빈 객체 전달", async () => {
      const deps = createMockDeps("ok");
      const state = createMockState();

      const handler = create_tool_call_handler(deps, mockToolContext, state);
      await handler({
        tool_calls: [{ name: "no_args_tool" }],
      });

      expect(deps.execute_tool).toHaveBeenCalledWith("no_args_tool", {}, mockToolContext);
    });
  });
});

// ── E3: reducer 주입 경로 ─────────────────────────────────────────

describe("create_tool_call_handler — reducer 주입 3-projection", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /**
   * reducer 주입 시 emit_result 내부에서:
   *   on_tool_event.result  ← prompt_text
   *   on_tool_block         ← display_text 기반 블록
   *   log_event.detail      ← storage_text (≤ 500자)
   */
  it("on_tool_event.result = prompt_text (reducer 경로)", async () => {
    const long_text = "json line ".repeat(100); // 1,000자 → 기본 max(5000)보다 짧지만 reducer 경유
    const reducer = create_tool_output_reducer(50); // max 50 → 반드시 truncate 발생
    const deps = createMockDeps(long_text);
    deps.reducer = reducer;
    const state = createMockState();
    const events: AgentEvent[] = [];

    const handler = create_tool_call_handler(deps, mockToolContext, state, {
      buffer: new StreamBuffer(),
      on_tool_event: (e) => events.push(e),
    });
    await handler({ tool_calls: [{ name: "read_file", arguments: { path: "/a.txt" } }] });

    const result_event = events.find((e) => e.type === "tool_result");
    expect(result_event).toBeDefined();
    // prompt_text는 max=50으로 truncate → 원문보다 짧아야 함
    expect(result_event!.result!.length).toBeLessThan(long_text.length);
  });

  it("on_tool_block content = display_text 기반 (reducer 경로)", async () => {
    const long_text = "x".repeat(500);
    // max=50: prompt=50, display=100 → display는 prompt보다 길 수 있음
    const reducer = create_tool_output_reducer(50);
    const deps = createMockDeps(long_text);
    deps.reducer = reducer;
    const state = createMockState();
    const blocks: string[] = [];

    const handler = create_tool_call_handler(deps, mockToolContext, state, {
      buffer: new StreamBuffer(),
      on_tool_block: (b) => blocks.push(b),
    });
    await handler({ tool_calls: [{ name: "tool_x" }] });

    expect(blocks).toHaveLength(1);
    // display_text가 format_tool_block에 전달됨 — 블록에 도구명 포함 확인
    expect(blocks[0]).toContain("`tool_x`");
  });

  it("log_event.detail = storage_text (reducer 경로, ≤ 500자)", async () => {
    const long_text = "s".repeat(1000);
    const reducer = create_tool_output_reducer(200); // storage = 200*1.5=300자
    const deps = createMockDeps(long_text);
    deps.reducer = reducer;
    const state = createMockState();
    const log_ctx = { run_id: "r1", agent_id: "a1", provider: "slack", chat_id: "c1" };

    const handler = create_tool_call_handler(deps, mockToolContext, state, {
      buffer: new StreamBuffer(),
      log_ctx,
    });
    await handler({ tool_calls: [{ name: "store_tool" }] });

    expect(deps.log_event).toHaveBeenCalled();
    const call = (deps.log_event as any).mock.calls[0][0];
    // storage_text.slice(0,500) → 항상 ≤ 500
    expect(call.detail.length).toBeLessThanOrEqual(500);
    // storage_text는 원문보다 짧음 (300자로 reduce)
    expect(call.detail.length).toBeLessThan(long_text.length);
  });

  it("is_error=true → reducer 미사용, fallback 동작 (에러 전체 반환)", async () => {
    const reducer = create_tool_output_reducer(10); // max 10으로 설정해도 에러는 그대로
    const deps = createMockDeps();
    (deps.execute_tool as any).mockRejectedValue(new Error("critical failure details"));
    deps.reducer = reducer;
    const state = createMockState();
    const events: AgentEvent[] = [];

    const handler = create_tool_call_handler(deps, mockToolContext, state, {
      buffer: new StreamBuffer(),
      on_tool_event: (e) => events.push(e),
    });
    await handler({ tool_calls: [{ name: "err_tool" }] });

    const result_event = events.find((e) => e.type === "tool_result");
    expect(result_event?.is_error).toBe(true);
    // is_error 시 reducer 미적용 → 전체 에러 메시지 보존
    expect(result_event!.result).toContain("critical failure details");
  });
});
