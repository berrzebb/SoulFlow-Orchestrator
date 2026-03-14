/**
 * E2: PtyOutputReducer 테스트.
 *
 * - assistant_chunk: 크기 가드 (MAX_CHUNK_CHARS=10,000)
 * - tool_result: prompt_text 압축 적용
 * - complete: 매우 큰 경우에만 soft compaction (5× max_chars)
 * - 그 외 타입 (tool_use, error, assistant_message): pass-through
 * - 경계값: max_chars 이하, 정확히 max_chars, max_chars+1
 */

import { describe, it, expect } from "vitest";
import { create_pty_output_reducer } from "@src/agent/pty/pty-output-reducer.js";
import type { AgentOutputMessage } from "@src/agent/pty/types.js";

const MAX_CHUNK = 10_000;

// ── assistant_chunk ───────────────────────────────────────────────

describe("PtyOutputReducer — assistant_chunk", () => {
  const reducer = create_pty_output_reducer(5_000);

  it("MAX_CHUNK 이하 → 원본 그대로", () => {
    const msg: AgentOutputMessage = { type: "assistant_chunk", content: "hello", delta: true };
    expect(reducer.reduce(msg)).toBe(msg);
  });

  it("MAX_CHUNK 초과 → 크기 가드, '[chunk size-guarded]' 포함", () => {
    const big = "x".repeat(MAX_CHUNK + 1);
    const msg: AgentOutputMessage = { type: "assistant_chunk", content: big, delta: true };
    const result = reducer.reduce(msg);
    if (result.type !== "assistant_chunk") throw new Error("wrong type");
    expect(result.content.length).toBeLessThanOrEqual(MAX_CHUNK + 30); // 가드 접미사 포함 허용
    expect(result.content).toContain("[chunk size-guarded]");
  });

  it("정확히 MAX_CHUNK → 원본 그대로", () => {
    const msg: AgentOutputMessage = { type: "assistant_chunk", content: "y".repeat(MAX_CHUNK), delta: true };
    expect(reducer.reduce(msg)).toBe(msg);
  });
});

// ── tool_result ───────────────────────────────────────────────────

describe("PtyOutputReducer — tool_result", () => {
  const reducer = create_pty_output_reducer(100);

  it("짧은 출력 → 원본 그대로", () => {
    const msg: AgentOutputMessage = { type: "tool_result", tool: "read_file", output: "short output" };
    expect(reducer.reduce(msg)).toBe(msg);
  });

  it("긴 출력 → prompt_text로 압축, tool/type 보존", () => {
    const long_output = "line content ".repeat(50);
    const msg: AgentOutputMessage = { type: "tool_result", tool: "bash", output: long_output };
    const result = reducer.reduce(msg);
    if (result.type !== "tool_result") throw new Error("wrong type");
    expect(result.type).toBe("tool_result");
    expect(result.tool).toBe("bash");
    expect(result.output.length).toBeLessThan(long_output.length);
  });

  it("긴 JSON 출력 → json kind 감지 후 압축", () => {
    const json_output = JSON.stringify({ key: "value", nested: { a: 1, b: 2, c: 3 } });
    const msg: AgentOutputMessage = { type: "tool_result", tool: "api_call", output: json_output };
    const result = reducer.reduce(msg);
    if (result.type !== "tool_result") throw new Error("wrong type");
    // json이면 {N keys} 형태 summary — 짧으면 원본 유지
    expect(result.tool).toBe("api_call");
  });
});

// ── complete ──────────────────────────────────────────────────────

describe("PtyOutputReducer — complete", () => {
  const reducer = create_pty_output_reducer(100); // SOFT_MAX = 500

  it("5× max 이하 → 원본 그대로", () => {
    const msg: AgentOutputMessage = {
      type: "complete",
      result: "short result",
      usage: { input: 10, output: 5 },
    };
    expect(reducer.reduce(msg)).toBe(msg);
  });

  it("5× max 초과 → soft compaction, usage 보존", () => {
    const big_result = "r".repeat(600); // 500 < 600 → 압축
    const msg: AgentOutputMessage = {
      type: "complete",
      result: big_result,
      usage: { input: 100, output: 200 },
    };
    const result = reducer.reduce(msg);
    if (result.type !== "complete") throw new Error("wrong type");
    expect(result.result.length).toBeLessThan(big_result.length);
    expect(result.usage).toEqual({ input: 100, output: 200 }); // usage 보존
  });

  it("정확히 5× max → 원본 그대로", () => {
    const msg: AgentOutputMessage = {
      type: "complete",
      result: "z".repeat(500), // = 5 * 100
      usage: undefined,
    };
    expect(reducer.reduce(msg)).toBe(msg);
  });
});

// ── pass-through types ────────────────────────────────────────────

describe("PtyOutputReducer — pass-through", () => {
  const reducer = create_pty_output_reducer(100);

  it("tool_use → 원본 그대로", () => {
    const msg: AgentOutputMessage = { type: "tool_use", tool: "bash", input: { cmd: "ls" } };
    expect(reducer.reduce(msg)).toBe(msg);
  });

  it("error → 원본 그대로 (에러 내용 손실 없음)", () => {
    const msg: AgentOutputMessage = { type: "error", code: "timeout", message: "process timed out after 30s" };
    expect(reducer.reduce(msg)).toBe(msg);
  });

  it("assistant_message → 원본 그대로", () => {
    const msg: AgentOutputMessage = { type: "assistant_message", content: "Here is the answer" };
    expect(reducer.reduce(msg)).toBe(msg);
  });
});

// ── 경계값 ──────────────────────────────────────────────────────

describe("PtyOutputReducer — 경계값", () => {
  it("max_chars=0 → 방어적으로 동작 (크래시 없음)", () => {
    const reducer = create_pty_output_reducer(0);
    const msg: AgentOutputMessage = { type: "tool_result", tool: "t", output: "some output" };
    expect(() => reducer.reduce(msg)).not.toThrow();
  });

  it("빈 tool_result.output → 원본 그대로", () => {
    const reducer = create_pty_output_reducer(100);
    const msg: AgentOutputMessage = { type: "tool_result", tool: "t", output: "" };
    expect(reducer.reduce(msg)).toBe(msg);
  });
});
