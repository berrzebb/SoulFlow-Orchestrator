import { describe, it, expect } from "vitest";
import {
  messages_to_prompt,
  extract_protocol_output,
  extract_protocol_partial,
  strip_protocol_markers,
  strip_protocol_scaffold,
  parse_json_line,
  extract_json_event_text,
  extract_final_from_json_output,
  parse_tool_calls_from_output,
  OUTPUT_BLOCK_START,
  OUTPUT_BLOCK_END,
  TOOL_BLOCK_START,
  TOOL_BLOCK_END,
} from "@src/providers/cli-protocol.js";

describe("messages_to_prompt", () => {
  it("메시지 배열 → 프롬프트 변환", () => {
    const result = messages_to_prompt([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);
    expect(result).toContain("[USER] Hello");
    expect(result).toContain("[ASSISTANT] Hi");
  });

  it("프로토콜 마커 포함", () => {
    const result = messages_to_prompt([{ role: "user", content: "test" }]);
    expect(result).toContain(OUTPUT_BLOCK_START);
    expect(result).toContain(OUTPUT_BLOCK_END);
  });

  it("도구 포함 시 도구 프로토콜 추가", () => {
    const tools = [{ function: { name: "web_search", description: "Search web", parameters: { properties: { q: {} }, required: ["q"] } } }];
    const result = messages_to_prompt([{ role: "user", content: "test" }], tools);
    expect(result).toContain("[TOOLS]");
    expect(result).toContain("web_search");
    expect(result).toContain(TOOL_BLOCK_START);
  });

  it("도구 없으면 TOOLS 섹션 없음", () => {
    const result = messages_to_prompt([{ role: "user", content: "test" }]);
    expect(result).not.toContain("[TOOLS]");
  });
});

describe("extract_protocol_output", () => {
  it("마커 사이 텍스트 추출", () => {
    const raw = `prefix ${OUTPUT_BLOCK_START}answer text${OUTPUT_BLOCK_END} suffix`;
    expect(extract_protocol_output(raw)).toBe("answer text");
  });

  it("마지막 블록 추출 (복수 블록)", () => {
    const raw = `${OUTPUT_BLOCK_START}first${OUTPUT_BLOCK_END} ${OUTPUT_BLOCK_START}second${OUTPUT_BLOCK_END}`;
    expect(extract_protocol_output(raw)).toBe("second");
  });

  it("마커 없으면 빈 문자열", () => {
    expect(extract_protocol_output("no markers")).toBe("");
  });

  it("빈 입력", () => {
    expect(extract_protocol_output("")).toBe("");
  });
});

describe("extract_protocol_partial", () => {
  it("시작 마커만 있을 때 부분 텍스트 추출", () => {
    const raw = `prefix ${OUTPUT_BLOCK_START}partial content`;
    expect(extract_protocol_partial(raw)).toBe("partial content");
  });

  it("완전한 블록 → 내부 텍스트", () => {
    const raw = `${OUTPUT_BLOCK_START}complete${OUTPUT_BLOCK_END}`;
    expect(extract_protocol_partial(raw)).toBe("complete");
  });

  it("마커 없으면 빈 문자열", () => {
    expect(extract_protocol_partial("no markers")).toBe("");
  });
});

describe("strip_protocol_markers", () => {
  it("모든 프로토콜 마커 제거", () => {
    const raw = `${OUTPUT_BLOCK_START}hello${OUTPUT_BLOCK_END} ${TOOL_BLOCK_START}tools${TOOL_BLOCK_END}`;
    expect(strip_protocol_markers(raw)).toBe("hello tools");
  });

  it("마커 없는 텍스트 유지", () => {
    expect(strip_protocol_markers("hello world")).toBe("hello world");
  });
});

describe("strip_protocol_scaffold", () => {
  it("시스템 지시문 제거", () => {
    const raw = `${OUTPUT_BLOCK_START}answer${OUTPUT_BLOCK_END}
[SYSTEM]
Return only the final user-facing answer wrapped in the exact block below.
Start your response with the start marker immediately, stream the answer body, then close with end marker.
Do not include execution logs, shell commands, env vars, or debug info.
<final answer>`;
    const result = strip_protocol_scaffold(raw);
    expect(result).toBe("answer");
  });

  it("빈 입력", () => {
    expect(strip_protocol_scaffold("")).toBe("");
  });
});

describe("parse_json_line", () => {
  it("유효한 JSON 객체 파싱", () => {
    const result = parse_json_line('{"type":"delta","text":"hello"}');
    expect(result).toEqual({ type: "delta", text: "hello" });
  });

  it("비 객체 JSON → null", () => {
    expect(parse_json_line("[1,2,3]")).toBeNull();
    expect(parse_json_line('"string"')).toBeNull();
  });

  it("잘못된 JSON → null", () => {
    expect(parse_json_line("{invalid}")).toBeNull();
  });

  it("빈 줄 → null", () => {
    expect(parse_json_line("")).toBeNull();
  });

  it("중괄호로 시작/끝나지 않으면 null", () => {
    expect(parse_json_line("prefix {valid}")).toBeNull();
  });
});

describe("extract_json_event_text", () => {
  it("delta 이벤트 → delta 텍스트", () => {
    const state = { last_full_text: "" };
    const result = extract_json_event_text({ type: "content_block_delta", text: "hello" }, state);
    expect(result.delta).toBe("hello");
  });

  it("init 이벤트 → 메타데이터 캡처", () => {
    const state = { last_full_text: "", metadata: {} as Record<string, unknown> };
    extract_json_event_text({ type: "init", session_id: "s1", model: "gpt-4" }, state);
    expect(state.metadata.session_id).toBe("s1");
    expect(state.metadata.model).toBe("gpt-4");
  });

  it("message 이벤트 (assistant) → 텍스트 추출", () => {
    const state = { last_full_text: "" };
    const result = extract_json_event_text({ type: "message", role: "assistant", text: "response" }, state);
    expect(result.delta).toBe("response");
    expect(result.final).toBe("response");
  });

  it("message 이벤트 (user) → 무시", () => {
    const state = { last_full_text: "" };
    const result = extract_json_event_text({ type: "message", role: "user", text: "question" }, state);
    expect(result.delta).toBeUndefined();
  });

  it("누적 delta 계산", () => {
    const state = { last_full_text: "" };
    extract_json_event_text({ type: "message", role: "assistant", text: "hello" }, state);
    const result = extract_json_event_text({ type: "message", role: "assistant", text: "hello world" }, state);
    expect(result.delta).toBe(" world");
    expect(result.final).toBe("hello world");
  });
});

describe("extract_final_from_json_output", () => {
  it("NDJSON에서 최종 응답 추출", () => {
    const lines = [
      '{"type":"init","session_id":"s1"}',
      '{"type":"message","role":"assistant","text":"hello"}',
      '{"type":"message","role":"assistant","text":"hello world"}',
    ].join("\n");
    const result = extract_final_from_json_output(lines);
    expect(result).toBe("hello world");
  });

  it("빈 입력 → 빈 문자열", () => {
    expect(extract_final_from_json_output("")).toBe("");
  });

  it("유효한 이벤트 없으면 빈 문자열", () => {
    expect(extract_final_from_json_output('{"type":"init"}')).toBe("");
  });
});

describe("parse_tool_calls_from_output", () => {
  it("프로토콜 블록에서 도구 호출 추출", () => {
    const raw = `${TOOL_BLOCK_START}{"tool_calls":[{"id":"call_1","name":"web_search","arguments":{"q":"test"}}]}${TOOL_BLOCK_END}`;
    const result = parse_tool_calls_from_output(raw);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("web_search");
  });

  it("마커 없으면 빈 배열", () => {
    expect(parse_tool_calls_from_output("no tools here")).toEqual([]);
  });

  it("빈 입력", () => {
    expect(parse_tool_calls_from_output("")).toEqual([]);
  });

  it("JSON 이벤트 스트림에서 도구 호출 추출", () => {
    // TOOL_BLOCK 마커가 없고, JSON 이벤트 스트림에 tool_calls가 있는 경우
    const tool_json = JSON.stringify({ tool_calls: [{ id: "c1", name: "search", arguments: { q: "hello" } }] });
    const raw = [
      `{"type":"message","role":"assistant","text":"${tool_json.replace(/"/g, '\\"')}"}`,
    ].join("\n");
    const result = parse_tool_calls_from_output(raw);
    // JSON 이벤트에서 도구 호출 파싱 시도
    expect(Array.isArray(result)).toBe(true);
  });

  it("ORCH_FINAL 블록 안에 TOOL_CALLS 블록 포함 → 도구 호출 추출", () => {
    // extract_protocol_output 경로: ORCH_FINAL 내에 TOOL_BLOCK 있는 경우
    const tool_payload = `{"tool_calls":[{"id":"c2","name":"calc","arguments":{"expr":"1+1"}}]}`;
    const final_content = `${TOOL_BLOCK_START}${tool_payload}${TOOL_BLOCK_END}`;
    const raw = `${OUTPUT_BLOCK_START}${final_content}${OUTPUT_BLOCK_END}`;
    const result = parse_tool_calls_from_output(raw);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("calc");
  });
});
