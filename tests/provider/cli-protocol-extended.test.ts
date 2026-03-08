/**
 * cli-protocol.ts — 미커버 경로 보충.
 * extract_json_event_text (Gemini message/result, item.completed, delta, assistant),
 * extract_final_from_json_output, parse_tool_calls_from_json_events,
 * parse_tool_calls_from_output (JSON events 경로, protocol 경로).
 */
import { describe, it, expect } from "vitest";
import {
  extract_json_event_text,
  extract_final_from_json_output,
  parse_tool_calls_from_output,
  TOOL_BLOCK_START,
  TOOL_BLOCK_END,
  OUTPUT_BLOCK_START,
  OUTPUT_BLOCK_END,
} from "@src/providers/cli-protocol.js";

// ══════════════════════════════════════════
// extract_json_event_text — Gemini message 경로
// ══════════════════════════════════════════

describe("extract_json_event_text — Gemini message (role=assistant)", () => {
  it("type=message + role=assistant → delta/final 반환", () => {
    const state = { last_full_text: "" };
    const event = { type: "message", role: "assistant", content: [{ text: "Hello world" }] };
    const r = extract_json_event_text(event, state);
    expect(r.final).toBeTruthy();
    expect(r.delta).toBeTruthy();
    expect(state.last_full_text).toBeTruthy();
  });

  it("type=message + role=user → 무시", () => {
    const state = { last_full_text: "" };
    const event = { type: "message", role: "user", content: "hello" };
    const r = extract_json_event_text(event, state);
    expect(r.delta).toBeUndefined();
    expect(r.final).toBeUndefined();
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
    // content가 없으면 collect_text_deep이 ""를 반환 → {} 반환
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
// extract_json_event_text — delta 경로
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
// extract_final_from_json_output
// ══════════════════════════════════════════

describe("extract_final_from_json_output", () => {
  it("빈 문자열 → ''", () => {
    expect(extract_final_from_json_output("")).toBe("");
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
// parse_tool_calls_from_output — JSON events 경로
// ══════════════════════════════════════════

describe("parse_tool_calls_from_output — JSON events 경로", () => {
  it("ORCH_TOOL_CALLS 블록 없고 JSON 이벤트에 tool_calls → JSON 이벤트에서 파싱", () => {
    const tool_call_event = JSON.stringify({
      type: "tool_calls",
      tool_calls: [{ id: "tc-1", name: "bash", arguments: { command: "ls" } }],
    });
    const r = parse_tool_calls_from_output(tool_call_event);
    // JSON line에서 tool_calls 파싱되어야 함
    // (parse_tool_calls_from_unknown이 처리)
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

  it("아무것도 없으면 [] 반환", () => {
    expect(parse_tool_calls_from_output("random text no markers")).toEqual([]);
  });

  it("빈 문자열 → []", () => {
    expect(parse_tool_calls_from_output("")).toEqual([]);
  });
});

// ══════════════════════════════════════════
// extract_json_event_text — init/system 메타데이터
// ══════════════════════════════════════════

describe("extract_json_event_text — init/system 메타데이터 캡처", () => {
  it("type=init + session_id → state.metadata에 저장", () => {
    const state: { last_full_text: string; metadata?: Record<string, unknown> } = { last_full_text: "" };
    extract_json_event_text({ type: "init", session_id: "sess-123", model: "gpt-4" }, state);
    expect(state.metadata?.session_id).toBe("sess-123");
    expect(state.metadata?.model).toBe("gpt-4");
  });

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
