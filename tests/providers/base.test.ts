/**
 * C-21: parse_openai_sse_stream — on_stream_event만 제공 시 full_content 누락 버그.
 *
 * 버그: on_stream 없이 on_stream_event만 있을 때 두 분기 모두 건너뛰어
 *       full_content가 전혀 누적되지 않아 LlmResponse.content가 null이 됨.
 * 수정: ev.type === "delta"면 항상 full_content += ev.content 먼저 실행.
 */
import { describe, it, expect, vi } from "vitest";
import { parse_openai_sse_stream } from "@src/providers/base.js";

function make_sse_stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
}

/** OpenAI SSE delta 라인 생성 */
function sse_delta(text: string): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content: text }, finish_reason: null }],
  })}\n`;
}

// ── C-21: on_stream_event만 제공 시 full_content 누적 ─────────────────────────

describe("parse_openai_sse_stream — C-21: on_stream_event only", () => {
  it("on_stream_event만 있을 때도 LlmResponse.content가 올바르게 반환됨", async () => {
    const stream = make_sse_stream([
      sse_delta("hello "),
      sse_delta("world"),
      "data: [DONE]\n",
    ]);

    const events: unknown[] = [];
    const result = await parse_openai_sse_stream(stream, {
      on_stream_event: (ev) => { events.push(ev); },
    });

    expect(result.content).toBe("hello world");
    expect(events.length).toBeGreaterThan(0);
  });

  it("on_stream과 on_stream_event 모두 있을 때 full_content 동일하게 누적됨", async () => {
    const stream = make_sse_stream([
      sse_delta("foo"),
      sse_delta("bar"),
      "data: [DONE]\n",
    ]);

    const chunks: string[] = [];
    const result = await parse_openai_sse_stream(stream, {
      on_stream: (c) => { chunks.push(c); },
      on_stream_event: vi.fn(),
    });

    expect(result.content).toBe("foobar");
    expect(chunks).toEqual(["foo", "bar"]);
  });

  it("on_stream만 있을 때도 정상 동작", async () => {
    const stream = make_sse_stream([
      sse_delta("abc"),
      "data: [DONE]\n",
    ]);

    const result = await parse_openai_sse_stream(stream, {
      on_stream: vi.fn(),
    });

    expect(result.content).toBe("abc");
  });

  it("콜백 없이 호출 시도 시 full_content 반환", async () => {
    const stream = make_sse_stream([
      sse_delta("plain"),
      "data: [DONE]\n",
    ]);

    const result = await parse_openai_sse_stream(stream, {});
    expect(result.content).toBe("plain");
  });
});
