import { describe, it, expect } from "vitest";
import { NdjsonParser } from "@src/agent/pty/ndjson-parser.ts";
import { ClaudeCliAdapter } from "@src/agent/pty/cli-adapter.ts";

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
