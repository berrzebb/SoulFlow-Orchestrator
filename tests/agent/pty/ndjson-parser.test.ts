import { describe, it, expect, vi } from "vitest";
import { NdjsonParser } from "@src/agent/pty/ndjson-parser.ts";
import { ClaudeCliAdapter } from "@src/agent/pty/cli-adapter.ts";

function make_adapter(return_val: unknown = { type: "text", content: "ok" }) {
  return { parse_output: vi.fn().mockReturnValue(return_val) } as any;
}

describe("NdjsonParser", () => {
  function create() {
    return new NdjsonParser(new ClaudeCliAdapter());
  }

  it("완전한 줄을 파싱한다", () => {
    const parser = create();
    const msgs = parser.feed('{"type":"result","result":"hello"}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("complete");
    if (msgs[0].type === "complete") expect(msgs[0].result).toBe("hello");
  });

  it("불완전한 청크를 버퍼링한다", () => {
    const parser = create();
    expect(parser.feed('{"type":"resu')).toHaveLength(0);
    expect(parser.feed('lt","result":"hi"}\n')).toHaveLength(1);
  });

  it("여러 줄을 한 청크에서 파싱한다", () => {
    const parser = create();
    const chunk =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"a"}]}}\n' +
      '{"type":"result","result":"done"}\n';
    const msgs = parser.feed(chunk);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe("assistant_chunk");
    expect(msgs[1].type).toBe("complete");
  });

  it("빈 줄을 무시한다", () => {
    const parser = create();
    const msgs = parser.feed('\n\n{"type":"result","result":"x"}\n\n');
    expect(msgs).toHaveLength(1);
  });

  it("잘못된 JSON을 무시한다", () => {
    const parser = create();
    const msgs = parser.feed('not json at all\n{"type":"result","result":"ok"}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("complete");
  });

  it("flush로 남은 버퍼를 처리한다", () => {
    const parser = create();
    parser.feed('{"type":"result","result":"tail"}');
    const flushed = parser.flush();
    expect(flushed).toHaveLength(1);
    if (flushed[0].type === "complete") expect(flushed[0].result).toBe("tail");
  });

  it("reset 후 버퍼가 비어있다", () => {
    const parser = create();
    parser.feed('{"type":"resu');
    parser.reset();
    expect(parser.flush()).toHaveLength(0);
  });
});

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
