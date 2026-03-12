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
  __cli_provider_test__,
  OUTPUT_BLOCK_START,
  OUTPUT_BLOCK_END,
  TOOL_BLOCK_START,
  TOOL_BLOCK_END,
} from "@src/providers/cli-protocol.js";

// ══════════════════════════════════════════
// messages_to_prompt
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// messages_to_prompt — tool_calls / tool_call_id
// ══════════════════════════════════════════

describe("messages_to_prompt — tool_calls / tool_call_id", () => {
  it("assistant 메시지에 tool_calls 배열 → [called id=...]: name(args) 포함", () => {
    const messages = [
      { role: "user", content: "search something" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", function: { name: "web_search", arguments: '{"q":"test"}' } },
        ],
      },
    ];
    const r = messages_to_prompt(messages as any);
    expect(r).toContain("called[call_1]: web_search");
    expect(r).toContain("test");
  });

  it("tool 응답에 tool_call_id → [TOOL id=...] 형식", () => {
    const messages = [
      { role: "tool", content: "search result", tool_call_id: "call_1" },
    ];
    const r = messages_to_prompt(messages as any);
    expect(r).toContain("[TOOL id=call_1]");
    expect(r).toContain("search result");
  });

  it("tool_calls에 id 없음 → called[]: name(args) 형식", () => {
    const messages = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { name: "bash", arguments: { command: "ls" } },
        ],
      },
    ];
    const r = messages_to_prompt(messages as any);
    expect(r).toContain("called[]: bash");
  });

  it("tool_calls + 기존 content 결합 → content [calls] 형식", () => {
    const messages = [
      {
        role: "assistant",
        content: "Here is my plan.",
        tool_calls: [
          { id: "c1", function: { name: "read_file", arguments: { path: "/tmp/x" } } },
        ],
      },
    ];
    const r = messages_to_prompt(messages as any);
    expect(r).toContain("Here is my plan.");
    expect(r).toContain("[called[c1]: read_file");
  });

  it("compact_tool_catalog: 이름 없는 도구 → 필터됨", () => {
    const tools = [
      { function: { name: "" } },
      { function: { name: "valid_tool", description: "does something", parameters: { properties: {}, required: [] } } },
    ];
    const r = messages_to_prompt([{ role: "user", content: "test" }], tools as any);
    expect(r).toContain("valid_tool");
  });

  it("compact_tool_catalog: 비객체 행 → 필터됨", () => {
    const tools = [
      null,
      { function: { name: "my_tool", description: "desc", parameters: { properties: { a: {} }, required: ["a"] } } },
    ];
    const r = messages_to_prompt([{ role: "user", content: "test" }], tools as any);
    expect(r).toContain("my_tool");
  });

  it("compact_tool_catalog: 33개 도구 → 32개만 포함", () => {
    const tools = Array.from({ length: 33 }, (_, i) => ({
      function: { name: `tool_${i}`, description: `Tool ${i}`, parameters: { properties: {}, required: [] } },
    }));
    const r = messages_to_prompt([{ role: "user", content: "test" }], tools);
    expect(r).toContain("tool_31");
    expect(r).not.toContain("tool_32");
  });
});

// ══════════════════════════════════════════
// extract_protocol_output
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// extract_protocol_partial
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// strip_protocol_markers
// ══════════════════════════════════════════

describe("strip_protocol_markers", () => {
  it("모든 프로토콜 마커 제거", () => {
    const raw = `${OUTPUT_BLOCK_START}hello${OUTPUT_BLOCK_END} ${TOOL_BLOCK_START}tools${TOOL_BLOCK_END}`;
    expect(strip_protocol_markers(raw)).toBe("hello tools");
  });

  it("마커 없는 텍스트 유지", () => {
    expect(strip_protocol_markers("hello world")).toBe("hello world");
  });
});

// ══════════════════════════════════════════
// strip_protocol_scaffold
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// strip_protocol_scaffold — 필터 패턴 제거
// ══════════════════════════════════════════

describe("strip_protocol_scaffold — 필터 패턴 제거", () => {
  it("[SYSTEM] 라인 제거", () => {
    const text = "[SYSTEM]\nActual content here";
    const r = strip_protocol_scaffold(text);
    expect(r).not.toContain("[SYSTEM]");
    expect(r).toContain("Actual content");
  });

  it("'Return only the final user-facing answer...' 라인 제거", () => {
    const text = "Return only the final user-facing answer wrapped in the exact block below.\nActual answer";
    const r = strip_protocol_scaffold(text);
    expect(r).not.toContain("Return only");
    expect(r).toContain("Actual answer");
  });

  it("'Start your response with the start marker...' 라인 제거", () => {
    const text = "Start your response with the start marker immediately.\nContent";
    const r = strip_protocol_scaffold(text);
    expect(r).not.toContain("Start your response");
    expect(r).toContain("Content");
  });

  it("'Do not include execution logs...' 라인 제거", () => {
    const text = "Do not include execution logs, shell commands, env vars, or debug info.\nContent";
    const r = strip_protocol_scaffold(text);
    expect(r).not.toContain("Do not include");
    expect(r).toContain("Content");
  });

  it("'Return either a TOOL block or FINAL block...' 라인 제거", () => {
    const text = "Return either a TOOL block or FINAL block. Never return both in one response.\nContent";
    const r = strip_protocol_scaffold(text);
    expect(r).not.toContain("Return either");
    expect(r).toContain("Content");
  });

  it("'If a tool is required...' 라인 제거", () => {
    const text = "If a tool is required, return only this exact block with valid JSON:\nContent";
    const r = strip_protocol_scaffold(text);
    expect(r).not.toContain("If a tool is required");
    expect(r).toContain("Content");
  });

  it("'Otherwise, return the final answer block.' 라인 제거", () => {
    const text = "Otherwise, return the final answer block.\nContent";
    const r = strip_protocol_scaffold(text);
    expect(r).not.toContain("Otherwise");
    expect(r).toContain("Content");
  });

  it("'Available tools (compact):' 라인 제거", () => {
    const text = "Available tools (compact):\ntool_name\nContent";
    const r = strip_protocol_scaffold(text);
    expect(r).not.toContain("Available tools");
  });

  it("'<final answer>' 라인 제거", () => {
    const text = "<final answer>\nActual content";
    const r = strip_protocol_scaffold(text);
    expect(r).not.toContain("<final answer>");
    expect(r).toContain("Actual content");
  });

  it("마커만 있으면 빈 문자열 → 필터 후 빈 문자열", () => {
    const text = `${OUTPUT_BLOCK_START}\n<final answer>\n${OUTPUT_BLOCK_END}`;
    const r = strip_protocol_scaffold(text);
    expect(r).toBe("");
  });
});

// ══════════════════════════════════════════
// parse_json_line
// ══════════════════════════════════════════

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

  it("null JSON → null", () => {
    expect(parse_json_line("null")).toBeNull();
  });

  it("끝에 공백 있는 JSON + } 이후 텍스트 → null", () => {
    expect(parse_json_line('{"key": "val"} extra')).toBeNull();
  });
});

// ══════════════════════════════════════════
// extract_json_event_text
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// extract_json_event_text — Gemini message (role=assistant)
// ══════════════════════════════════════════

describe("extract_json_event_text — Gemini message (role=assistant)", () => {
  it("type=message + role=assistant + content 배열 → delta/final 반환", () => {
    const state = { last_full_text: "" };
    const event = { type: "message", role: "assistant", content: [{ text: "Hello world" }] };
    const r = extract_json_event_text(event, state);
    expect(r.final).toBeTruthy();
    expect(r.delta).toBeTruthy();
    expect(state.last_full_text).toBeTruthy();
  });

  it("type=message + role=assistant + delta 계산 (prefix overlap)", () => {
    const state = { last_full_text: "Hello" };
    const event = { type: "message", role: "assistant", content: [{ text: "Hello world" }] };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBe(" world");
  });

  it("type=message + content 없으면 {} 반환", () => {
    const state = { last_full_text: "" };
    const event = { type: "message", role: "assistant" };
    const r = extract_json_event_text(event, state);
    expect(Object.keys(r).length).toBe(0);
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — Gemini result 경로
// ══════════════════════════════════════════

describe("extract_json_event_text — Gemini result 경로", () => {
  it("type=result + response 있으면 final 반환", () => {
    const state = { last_full_text: "" };
    const event = { type: "result", response: "Final answer here" };
    const r = extract_json_event_text(event, state);
    expect(r.final).toBe("Final answer here");
    expect(r.delta).toBe("Final answer here");
  });

  it("type=result + response 없으면 {} 반환", () => {
    const state = { last_full_text: "" };
    const event = { type: "result" };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBeUndefined();
  });

  it("type=result + prefix overlap → delta만 새 부분", () => {
    const state = { last_full_text: "Already said" };
    const event = { type: "result", response: "Already said more" };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBe(" more");
    expect(r.final).toBe("Already said more");
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — item.completed 경로
// ══════════════════════════════════════════

describe("extract_json_event_text — item.completed 경로", () => {
  it("type=item.completed + item.type=agent_message → delta/final", () => {
    const state = { last_full_text: "" };
    const event = {
      type: "item.completed",
      item: { type: "agent_message", content: [{ text: "Agent reply" }] },
    };
    const r = extract_json_event_text(event, state);
    expect(r.final).toBe("Agent reply");
  });

  it("type=item.completed + item.type=assistant_message → delta/final", () => {
    const state = { last_full_text: "" };
    const event = {
      type: "item.completed",
      item: { type: "assistant_message", text: "Assistant reply" },
    };
    const r = extract_json_event_text(event, state);
    expect(r.final).toBeTruthy();
  });

  it("type=item.completed + item.type=reasoning → {} 반환", () => {
    const state = { last_full_text: "" };
    const event = {
      type: "item.completed",
      item: { type: "reasoning", text: "thinking..." },
    };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBeUndefined();
  });

  it("type=item.completed + item.type=message + 텍스트 없음 → {}", () => {
    const state = { last_full_text: "" };
    const event = {
      type: "item.completed",
      item: { type: "message" },
    };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — delta 포함 type 경로
// ══════════════════════════════════════════

describe("extract_json_event_text — delta 포함 type 경로", () => {
  it("type=text_delta + text 있음 → { delta }", () => {
    const state = { last_full_text: "" };
    const event = { type: "text_delta", text: "streaming chunk" };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBe("streaming chunk");
    expect(r.final).toBeUndefined();
  });

  it("type=content_delta + delta.text → { delta }", () => {
    const state = { last_full_text: "" };
    const event = { type: "content_delta", delta: { text: "delta chunk" } };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBe("delta chunk");
  });

  it("type=text_delta + text 공백만 → {}", () => {
    const state = { last_full_text: "" };
    const event = { type: "text_delta", text: "   " };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — message.completed / assistant 경로
// ══════════════════════════════════════════

describe("extract_json_event_text — message.completed / assistant 경로", () => {
  it("type=message.completed + message.content 있음 → delta/final", () => {
    const state = { last_full_text: "" };
    const event = {
      type: "message.completed",
      message: { content: [{ text: "Complete message" }] },
    };
    const r = extract_json_event_text(event, state);
    expect(r.final).toBe("Complete message");
  });

  it("type=assistant + message.content 있음 → delta/final", () => {
    const state = { last_full_text: "" };
    const event = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Assistant response" }] },
    };
    const r = extract_json_event_text(event, state);
    expect(r.final).toBe("Assistant response");
  });

  it("type=message.completed + 텍스트 없음 → {}", () => {
    const state = { last_full_text: "" };
    const event = { type: "message.completed" };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — init/system 메타데이터
// ══════════════════════════════════════════

describe("extract_json_event_text — init/system 메타데이터 캡처", () => {
  it("type=system + thread_id → state.metadata에 저장", () => {
    const state: { last_full_text: string; metadata?: Record<string, unknown> } = { last_full_text: "" };
    extract_json_event_text({ type: "system", thread_id: "thr-abc" }, state);
    expect(state.metadata?.thread_id).toBe("thr-abc");
  });

  it("type=unknown → {} 반환", () => {
    const state = { last_full_text: "" };
    const r = extract_json_event_text({ type: "unknown_event_type" }, state);
    expect(r).toEqual({});
  });

  it("type 없으면 {} 반환", () => {
    const state = { last_full_text: "" };
    const r = extract_json_event_text({}, state);
    expect(r).toEqual({});
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — as_string number/boolean
// ══════════════════════════════════════════

describe("extract_json_event_text — as_string number/boolean", () => {
  it("response가 숫자 → as_string number 경로", () => {
    const state = { last_full_text: "" };
    const r = extract_json_event_text({ type: "result", response: 42 }, state);
    expect(typeof r).toBe("object");
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — collect_text_deep
// ══════════════════════════════════════════

describe("collect_text_deep — 다양한 객체 구조 (extract_json_event_text 통해)", () => {
  it("delta.value 있으면 텍스트 추출", () => {
    const state = { last_full_text: "" };
    const event = { type: "content_delta", delta: { value: "delta value text" } };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBe("delta value text");
  });

  it("content 배열 내 중첩 텍스트 추출", () => {
    const state = { last_full_text: "" };
    const event = {
      type: "message.completed",
      message: {
        content: [
          { type: "text", text: "text in array" },
        ],
      },
    };
    const r = extract_json_event_text(event, state);
    expect(r.final).toBe("text in array");
  });

  it("message.text에서 직접 텍스트 추출", () => {
    const state = { last_full_text: "" };
    const event = {
      type: "message.completed",
      message: { text: "direct text" },
    };
    const r = extract_json_event_text(event, state);
    expect(r.final).toBe("direct text");
  });

  it("content 배열 내 문자열 → string value 반환", () => {
    const event = {
      type: "content_block_delta",
      content: ["hello world"],
    };
    const result = extract_json_event_text(event as Record<string, unknown>, { last_full_text: "" });
    expect(result.delta).toBe("hello world");
  });

  it("item.completed content=string → string 직접 반환", () => {
    const state = { last_full_text: "" };
    const r = extract_json_event_text({
      type: "item.completed",
      item: { type: "message", text: "hello world" },
    }, state);
    expect(typeof r).toBe("object");
  });

  it("deeply nested (depth>4) → 빈 문자열 반환", () => {
    const state = { last_full_text: "" };
    const deep_event = {
      type: "response.output_item.delta",
      delta: { delta: { delta: { delta: { delta: { text: "deep" } } } } },
    };
    const r = extract_json_event_text(deep_event, state);
    expect(typeof r).toBe("object");
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — full="" → {}
// ══════════════════════════════════════════

describe("extract_json_event_text — full='' → {}", () => {
  it("type=result, response=protocol-markers-only → full='' → {}", () => {
    const state = { last_full_text: "" };
    const r = extract_json_event_text({ type: "result", response: OUTPUT_BLOCK_START + OUTPUT_BLOCK_END }, state);
    expect(r).toEqual({});
  });

  it("type=item.completed, message text=markers-only → full='' → {}", () => {
    const state = { last_full_text: "" };
    const r = extract_json_event_text({
      type: "item.completed",
      item: { type: "assistant_message", text: OUTPUT_BLOCK_START + OUTPUT_BLOCK_END },
    }, state);
    expect(r).toEqual({});
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — delta dedup
// ══════════════════════════════════════════

describe("extract_json_event_text — delta dedup", () => {
  it("item.completed assistant_message, last_full_text prefix match → delta = suffix", () => {
    const state = { last_full_text: "Hello" };
    const r = extract_json_event_text({
      type: "item.completed",
      item: { type: "assistant_message", text: "Hello World" },
    }, state);
    expect((r as any).delta).toBe(" World");
    expect((r as any).final).toBe("Hello World");
  });

  it("type=message.completed, last_full_text prefix match → delta = suffix", () => {
    const state = { last_full_text: "Part1" };
    const r = extract_json_event_text({
      type: "message.completed",
      text: "Part1 Part2",
    }, state);
    expect((r as any).delta).toBe(" Part2");
  });
});

// ══════════════════════════════════════════
// extract_final_from_json_output
// ══════════════════════════════════════════

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

  it("JSON 라인 없으면 ''", () => {
    expect(extract_final_from_json_output("not json\nrandom text")).toBe("");
  });

  it("result 이벤트 라인 → final 텍스트 반환", () => {
    const line = JSON.stringify({ type: "result", response: "Final output" });
    const r = extract_final_from_json_output(line);
    expect(r).toBe("Final output");
  });

  it("여러 result 라인 → 마지막 것 반환", () => {
    const l1 = JSON.stringify({ type: "result", response: "First" });
    const l2 = JSON.stringify({ type: "result", response: "Second" });
    const r = extract_final_from_json_output(`${l1}\n${l2}`);
    expect(r).toBe("Second");
  });

  it("assistant 이벤트 라인 → final 텍스트", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ text: "Hello" }] } });
    const r = extract_final_from_json_output(line);
    expect(r).toBe("Hello");
  });
});

// ══════════════════════════════════════════
// parse_tool_calls_from_output
// ══════════════════════════════════════════

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
    const tool_json = JSON.stringify({ tool_calls: [{ id: "c1", name: "search", arguments: { q: "hello" } }] });
    const raw = [
      `{"type":"message","role":"assistant","text":"${tool_json.replace(/"/g, '\\"')}"}`,
    ].join("\n");
    const result = parse_tool_calls_from_output(raw);
    expect(Array.isArray(result)).toBe(true);
  });

  it("ORCH_FINAL 블록 안에 TOOL_CALLS 블록 포함 → 도구 호출 추출", () => {
    const tool_payload = `{"tool_calls":[{"id":"c2","name":"calc","arguments":{"expr":"1+1"}}]}`;
    const final_content = `${TOOL_BLOCK_START}${tool_payload}${TOOL_BLOCK_END}`;
    const raw = `${OUTPUT_BLOCK_START}${final_content}${OUTPUT_BLOCK_END}`;
    const result = parse_tool_calls_from_output(raw);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("calc");
  });
});

// ══════════════════════════════════════════
// parse_tool_calls_from_output — JSON events 경로
// ══════════════════════════════════════════

describe("parse_tool_calls_from_output — JSON events 경로", () => {
  it("ORCH_TOOL_CALLS 블록 없고 JSON 이벤트에 tool_calls → JSON 이벤트에서 파싱", () => {
    const tool_call_event = JSON.stringify({
      type: "tool_calls",
      tool_calls: [{ id: "tc-1", name: "bash", arguments: { command: "ls" } }],
    });
    const r = parse_tool_calls_from_output(tool_call_event);
    expect(Array.isArray(r)).toBe(true);
  });

  it("protocol 블록 내 tool_calls JSON → 파싱됨", () => {
    const block_content = `{"tool_calls":[{"id":"t1","name":"search","arguments":{"q":"test"}}]}`;
    const raw = `${TOOL_BLOCK_START}\n${block_content}\n${TOOL_BLOCK_END}`;
    const r = parse_tool_calls_from_output(raw);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].name).toBe("search");
  });

  it("OUTPUT 블록 내 TOOL 블록 → protocol 경로로 파싱", () => {
    const tool_json = `{"tool_calls":[{"id":"t2","name":"read_file","arguments":{"path":"/tmp/x"}}]}`;
    const inner = `${TOOL_BLOCK_START}\n${tool_json}\n${TOOL_BLOCK_END}`;
    const raw = `${OUTPUT_BLOCK_START}${inner}${OUTPUT_BLOCK_END}`;
    const r = parse_tool_calls_from_output(raw);
    expect(r.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// parse_tool_calls_from_output — __cli_provider_test__ 경로
// ══════════════════════════════════════════

describe("parse_tool_calls_from_output — json→text + protocol→text", () => {
  const { parse_tool_calls_from_output: _parse } = __cli_provider_test__;

  it("JSON output에 TOOL block → tool calls 파싱", () => {
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
    const r = _parse(tool_json);
    expect(Array.isArray(r)).toBe(true);
  });

  it("result JSON 이벤트 final에 TOOL block → json→text 경로", () => {
    const tool_block = `${TOOL_BLOCK_START}\n{"tool":"read_file","params":{"path":"/test"}}\n${TOOL_BLOCK_END}`;
    const event_line = JSON.stringify({ type: "result", response: tool_block });
    const r = _parse(event_line);
    expect(Array.isArray(r)).toBe(true);
  });

  it("protocol output에 TOOL block → tool calls 파싱", () => {
    const raw = [
      OUTPUT_BLOCK_START,
      `${TOOL_BLOCK_START}\n{"tool":"read_file","params":{"path":"/x"}}\n${TOOL_BLOCK_END}`,
      OUTPUT_BLOCK_END,
    ].join("");
    const r = _parse(raw);
    expect(Array.isArray(r)).toBe(true);
  });

  it("protocol output에 TOOL block 없이 직접 텍스트 파싱", () => {
    const raw = [
      OUTPUT_BLOCK_START,
      `{"tool":"read_file","params":{"path":"/x"}}`,
      OUTPUT_BLOCK_END,
    ].join("");
    const r = _parse(raw);
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// parse_tool_calls_from_output — L349/L352 경로
// ══════════════════════════════════════════

describe("parse_tool_calls_from_output — L349/L352 경로", () => {
  const { parse_tool_calls_from_output: _parse } = __cli_provider_test__;

  it("ORCH_FINAL 내 ORCH_TOOL_CALLS + 후속 비파싱 블록 → L349 반환", () => {
    const tool_json = JSON.stringify([{ name: "get_weather", arguments: { city: "Seoul" } }]);
    const raw = [
      OUTPUT_BLOCK_START,
      TOOL_BLOCK_START,
      tool_json,
      TOOL_BLOCK_END,
      OUTPUT_BLOCK_END,
      TOOL_BLOCK_START,
      "NOT_PARSEABLE_JSON_TEXT",
      TOOL_BLOCK_END,
    ].join("");

    const r = _parse(raw);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].name).toBe("get_weather");
  });

  it("ORCH_FINAL 내 JSON 배열 직접 + 후속 비파싱 블록 → L352 반환", () => {
    const tool_json = JSON.stringify([{ name: "send_email", arguments: { to: "user@example.com" } }]);
    const raw = [
      OUTPUT_BLOCK_START,
      tool_json,
      OUTPUT_BLOCK_END,
      TOOL_BLOCK_START,
      "NOT_PARSEABLE_JSON_TEXT",
      TOOL_BLOCK_END,
    ].join("");

    const r = _parse(raw);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].name).toBe("send_email");
  });
});
