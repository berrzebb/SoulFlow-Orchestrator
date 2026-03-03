import { describe, it, expect } from "vitest";
import { create_cd_observer } from "../../src/agent/cd-scoring.js";
import type { AgentEvent, AgentEventSource } from "../../src/agent/agent.types.js";

const source: AgentEventSource = { backend: "claude_cli" };
const at = "2026-03-01T00:00:00Z";

describe("CD 옵저버", () => {
  it("ask_user 도구 호출을 clarify (+10)로 감지한다", () => {
    const cd = create_cd_observer();
    const event: AgentEvent = {
      type: "tool_use",
      source,
      at,
      tool_name: "ask_user",
      tool_id: "t1",
      params: { question: "어떤 방식을 원하시나요?" },
    };
    const result = cd.observe(event);
    expect(result).not.toBeNull();
    expect(result!.indicator).toBe("clarify");
    expect(result!.points).toBe(10);
    expect(cd.get_score().total).toBe(10);
  });

  it("동일 도구 3회 에러 후 다른 도구 사용 시 correct (+25)를 감지한다", () => {
    const cd = create_cd_observer();

    // 3회 에러
    for (let i = 0; i < 3; i++) {
      cd.observe({
        type: "tool_result", source, at, tool_name: "exec", tool_id: `t${i}`,
        result: "error", is_error: true,
      });
    }

    // 다른 도구로 전환
    const result = cd.observe({
      type: "tool_use", source, at, tool_name: "read_file", tool_id: "t4",
      params: {},
    });

    expect(result).not.toBeNull();
    expect(result!.indicator).toBe("correct");
    expect(result!.points).toBe(25);
  });

  it("동일 도구 3회 에러 후 성공 시에도 correct를 감지한다", () => {
    const cd = create_cd_observer();

    for (let i = 0; i < 3; i++) {
      cd.observe({
        type: "tool_result", source, at, tool_name: "exec", tool_id: `t${i}`,
        result: "error", is_error: true,
      });
    }

    const result = cd.observe({
      type: "tool_result", source, at, tool_name: "exec", tool_id: "t4",
      result: "ok",
    });

    expect(result).not.toBeNull();
    expect(result!.indicator).toBe("correct");
    expect(result!.points).toBe(25);
  });

  it("에러 2회는 correct를 발생시키지 않는다", () => {
    const cd = create_cd_observer();

    for (let i = 0; i < 2; i++) {
      cd.observe({
        type: "tool_result", source, at, tool_name: "exec", tool_id: `t${i}`,
        result: "error", is_error: true,
      });
    }

    const result = cd.observe({
      type: "tool_use", source, at, tool_name: "read_file", tool_id: "t3",
      params: {},
    });

    expect(result).toBeNull();
  });

  it("같은 도구에 대해 correct는 1회만 발생한다", () => {
    const cd = create_cd_observer();

    // 첫 번째 3연속 에러
    for (let i = 0; i < 3; i++) {
      cd.observe({
        type: "tool_result", source, at, tool_name: "exec", tool_id: `t${i}`,
        result: "error", is_error: true,
      });
    }
    cd.observe({ type: "tool_use", source, at, tool_name: "read_file", tool_id: "t4", params: {} });

    // 다시 3연속 에러
    for (let i = 5; i < 8; i++) {
      cd.observe({
        type: "tool_result", source, at, tool_name: "exec", tool_id: `t${i}`,
        result: "error", is_error: true,
      });
    }
    const result = cd.observe({ type: "tool_use", source, at, tool_name: "write_file", tool_id: "t9", params: {} });

    // 이미 correct가 발생했으므로 중복 없음
    expect(result).toBeNull();
  });

  it("reset 후 점수가 초기화된다", () => {
    const cd = create_cd_observer();
    cd.observe({ type: "tool_use", source, at, tool_name: "ask_user", tool_id: "t1", params: {} });
    expect(cd.get_score().total).toBe(10);

    cd.reset();
    expect(cd.get_score().total).toBe(0);
    expect(cd.get_score().events).toHaveLength(0);
  });

  it("관련 없는 이벤트는 무시한다", () => {
    const cd = create_cd_observer();
    const result = cd.observe({ type: "content_delta", source, at, text: "hello" });
    expect(result).toBeNull();
    expect(cd.get_score().total).toBe(0);
  });

  it("누적 점수가 올바르게 합산된다", () => {
    const cd = create_cd_observer();

    // clarify: +10
    cd.observe({ type: "tool_use", source, at, tool_name: "ask_user", tool_id: "t1", params: {} });
    // clarify: +10
    cd.observe({ type: "tool_use", source, at, tool_name: "ask_user", tool_id: "t2", params: {} });

    expect(cd.get_score().total).toBe(20);
    expect(cd.get_score().events).toHaveLength(2);
  });
});
