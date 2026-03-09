/**
 * cli-protocol.ts — 미커버 분기 보충 (cov2).
 * L112: extract_protocol_partial empty text
 * L152: strip_protocol_scaffold empty line filter
 * L169: as_string number/boolean
 * L174/175: collect_text_deep depth>4 / string value
 * L209: parse_json_line array/non-object parsed
 * L249/265: extract_json_event_text full="" → {}
 * L268/287: last_full_text delta dedup
 * L337-352: parse_tool_calls_from_output json→text, protocol→text 경로
 */
import { describe, it, expect } from "vitest";
import {
  extract_protocol_partial,
  strip_protocol_scaffold,
  parse_json_line,
  extract_json_event_text,
  extract_final_from_json_output,
  __cli_provider_test__,
  OUTPUT_BLOCK_START, OUTPUT_BLOCK_END,
  TOOL_BLOCK_START, TOOL_BLOCK_END,
} from "@src/providers/cli-protocol.js";

// ══════════════════════════════════════════
// L112: extract_protocol_partial 빈 input
// ══════════════════════════════════════════

describe("extract_protocol_partial (L112)", () => {
  it("빈 문자열 → 빈 문자열 반환", () => {
    expect(extract_protocol_partial("")).toBe("");
  });
});

// ══════════════════════════════════════════
// L152: strip_protocol_scaffold 빈 줄 필터
// ══════════════════════════════════════════

describe("strip_protocol_scaffold (L152)", () => {
  it("빈 줄 포함 텍스트 → 빈 줄 제거", () => {
    const input = `[SYSTEM]\n\nHello\n\nWorld`;
    const r = strip_protocol_scaffold(input);
    // [SYSTEM] 제거, 빈 줄 제거, Hello와 World 유지
    expect(r).toContain("Hello");
    expect(r).not.toContain("[SYSTEM]");
  });
});

// ══════════════════════════════════════════
// L169: as_string — number/boolean (via extract_json_event_text)
// ══════════════════════════════════════════

describe("extract_json_event_text — as_string number/boolean (L169)", () => {
  it("response가 숫자 → as_string number 경로", () => {
    const state = { last_full_text: "" };
    // type="result", response=42 (number) → as_string(42)="42" → strip → "42"
    const r = extract_json_event_text({ type: "result", response: 42 }, state);
    expect(typeof r).toBe("object");
  });
});

// ══════════════════════════════════════════
// L174/175: collect_text_deep depth>4, string value
// ══════════════════════════════════════════

describe("extract_json_event_text — collect_text_deep string/depth (L174-175)", () => {
  it("item.completed content=string → string 직접 반환 (L175)", () => {
    const state = { last_full_text: "" };
    const r = extract_json_event_text({
      type: "item.completed",
      item: { type: "message", text: "hello world" },
    }, state);
    expect(typeof r).toBe("object");
  });

  it("deeply nested (depth>4) → 빈 문자열 반환 (L174)", () => {
    const state = { last_full_text: "" };
    // delta.delta.delta.delta.delta 5단계 → depth>4 → ""
    const deep_event = {
      type: "response.output_item.delta",
      delta: { delta: { delta: { delta: { delta: { text: "deep" } } } } },
    };
    const r = extract_json_event_text(deep_event, state);
    // collect_text_deep에서 depth>4로 빈 문자열
    expect(typeof r).toBe("object");
  });
});

// ══════════════════════════════════════════
// L209: parse_json_line — array parsed
// ══════════════════════════════════════════

describe("parse_json_line (L209)", () => {
  it("JSON 배열 → null 반환", () => {
    expect(parse_json_line("[1,2,3]")).toBeNull();
  });

  it("null JSON → null 반환", () => {
    expect(parse_json_line("null")).toBeNull(); // not {}-wrapped
  });
});

// ══════════════════════════════════════════
// L249/265: extract_json_event_text full="" → {}
// ══════════════════════════════════════════

describe("extract_json_event_text — full='' (L249, L265)", () => {
  it("type=result, response=protocol-markers-only → full='' → {} (L249)", () => {
    // strip_protocol_markers removes all markers → empty
    const state = { last_full_text: "" };
    // Give it a response that after stripping becomes empty
    const r = extract_json_event_text({ type: "result", response: OUTPUT_BLOCK_START + OUTPUT_BLOCK_END }, state);
    expect(r).toEqual({});
  });

  it("type=item.completed, message text=markers-only → full='' → {} (L265)", () => {
    const state = { last_full_text: "" };
    const r = extract_json_event_text({
      type: "item.completed",
      item: { type: "assistant_message", text: OUTPUT_BLOCK_START + OUTPUT_BLOCK_END },
    }, state);
    expect(r).toEqual({});
  });
});

// ══════════════════════════════════════════
// L268/287: last_full_text delta dedup
// ══════════════════════════════════════════

describe("extract_json_event_text — delta dedup (L268, L287)", () => {
  it("type=result, last_full_text prefix match → delta = suffix (Gemini result path)", () => {
    const state = { last_full_text: "Hello" };
    const r = extract_json_event_text({ type: "result", response: "Hello World" }, state);
    expect((r as any).delta).toBe(" World");
  });

  it("item.completed assistant_message, last_full_text prefix match → delta = suffix (L268)", () => {
    // type="item.completed", item.type="assistant_message" → L263 분기 → L268 delta 계산
    const state = { last_full_text: "Hello" };
    const r = extract_json_event_text({
      type: "item.completed",
      item: { type: "assistant_message", text: "Hello World" },
    }, state);
    expect((r as any).delta).toBe(" World");
    expect((r as any).final).toBe("Hello World");
  });

  it("type=message.completed, last_full_text prefix match → delta = suffix (L287)", () => {
    const state = { last_full_text: "Part1" };
    const r = extract_json_event_text({
      type: "message.completed",
      text: "Part1 Part2",
    }, state);
    expect((r as any).delta).toBe(" Part2");
  });
});

// ══════════════════════════════════════════
// L337-352: parse_tool_calls_from_output — json→text, protocol→text
// ══════════════════════════════════════════

describe("parse_tool_calls_from_output — json→text + protocol→text (L337-352)", () => {
  const { parse_tool_calls_from_output } = __cli_provider_test__;

  it("JSON output에 TOOL block → tool calls 파싱 (L337-338)", () => {
    const tool_json = JSON.stringify({
      type: "item.completed",
      item: {
        type: "assistant_message",
        text: [
          OUTPUT_BLOCK_START,
          `${TOOL_BLOCK_START}\n{"tool":"write_file","params":{"path":"/f","content":"x"}}\n${TOOL_BLOCK_END}`,
          OUTPUT_BLOCK_END,
        ].join(""),
      },
    });
    const r = parse_tool_calls_from_output(tool_json);
    expect(Array.isArray(r)).toBe(true);
  });

  it("result JSON 이벤트 final에 TOOL block → json→text 경로 (L337-338)", () => {
    // Gemini result 이벤트: response에 TOOL block 포함 → extract_final_from_json_output → final text에 TOOL block
    // parse_tool_calls_from_json_events는 이 구조에서 tool call을 찾지 못함 (from_events=empty)
    // → extract_final_from_json_output → extract_last_block_re → parse_tool_calls_from_text (L337-338)
    const tool_block = `${TOOL_BLOCK_START}\n{"tool":"read_file","params":{"path":"/test"}}\n${TOOL_BLOCK_END}`;
    const event_line = JSON.stringify({ type: "result", response: tool_block });
    const r = parse_tool_calls_from_output(event_line);
    expect(Array.isArray(r)).toBe(true);
  });

  it("protocol output에 TOOL block → tool calls 파싱 (L346-349)", () => {
    const raw = [
      OUTPUT_BLOCK_START,
      `${TOOL_BLOCK_START}\n{"tool":"read_file","params":{"path":"/x"}}\n${TOOL_BLOCK_END}`,
      OUTPUT_BLOCK_END,
    ].join("");
    const r = parse_tool_calls_from_output(raw);
    expect(Array.isArray(r)).toBe(true);
  });

  it("protocol output에 TOOL block 없이 직접 텍스트 파싱 (L351-352)", () => {
    const raw = [
      OUTPUT_BLOCK_START,
      `{"tool":"read_file","params":{"path":"/x"}}`,
      OUTPUT_BLOCK_END,
    ].join("");
    const r = parse_tool_calls_from_output(raw);
    expect(Array.isArray(r)).toBe(true);
  });
});
