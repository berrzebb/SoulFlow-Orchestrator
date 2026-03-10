/**
 * NdjsonParser — 미커버 분기 (cov2):
 * - L17-18: buffer overflow (>10MB) → buffer_overflow 에러 반환
 * - L43: flush() + parse_output returns null → []
 * - L56: push_result — msg가 배열인 경우 spread
 */
import { describe, it, expect, vi } from "vitest";
import { NdjsonParser } from "@src/agent/pty/ndjson-parser.js";

function make_adapter(return_val: unknown = { type: "text", content: "ok" }) {
  return { parse_output: vi.fn().mockReturnValue(return_val) } as any;
}

describe("NdjsonParser — buffer overflow (L17-18)", () => {
  it("10MB 초과 데이터 주입 → buffer_overflow 에러 반환 + 버퍼 초기화", () => {
    const adapter = make_adapter();
    const parser = new NdjsonParser(adapter);
    // 10MB + 1바이트 넘는 문자열 (newline 없는 데이터)
    const big_chunk = "x".repeat(10 * 1024 * 1024 + 1);
    const result = parser.feed(big_chunk);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("error");
    expect((result[0] as any).code).toBe("buffer_overflow");
  });
});

describe("NdjsonParser — flush() parse_output null (L43)", () => {
  it("버퍼에 내용 있지만 parse_output이 null → []", () => {
    const adapter = make_adapter(null);
    const parser = new NdjsonParser(adapter);
    // 개행 없는 잔여 데이터를 버퍼에 쌓기
    parser.feed("incomplete line without newline");
    const result = parser.flush();
    expect(result).toEqual([]);
  });
});

describe("NdjsonParser — push_result 배열 반환 (L56)", () => {
  it("parse_output이 배열 반환 → spread되어 모두 추가", () => {
    const msgs = [
      { type: "text" as const, content: "msg1" },
      { type: "text" as const, content: "msg2" },
    ];
    const adapter = make_adapter(msgs);
    const parser = new NdjsonParser(adapter);
    const result = parser.feed("line1\n");
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
  });

  it("flush() + parse_output 배열 반환 → spread", () => {
    const msgs = [{ type: "text" as const, content: "x" }];
    const adapter = make_adapter(msgs);
    const parser = new NdjsonParser(adapter);
    parser.feed("data without newline");
    const result = parser.flush();
    expect(result).toHaveLength(1);
  });
});
