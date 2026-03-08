/**
 * cli-protocol.ts — 미커버 분기 보충.
 * messages_to_prompt (tool_calls in msg, tool_call_id),
 * compact_tool_catalog (비객체 행, 이름 없는 도구),
 * collect_text_deep (depth>4, number/boolean, delta.value, message 경로),
 * strip_protocol_scaffold (각종 필터 패턴),
 * parse_json_line 엣지케이스.
 */
import { describe, it, expect } from "vitest";
import {
  messages_to_prompt,
  extract_json_event_text,
  strip_protocol_scaffold,
  parse_json_line,
  OUTPUT_BLOCK_START,
  OUTPUT_BLOCK_END,
} from "@src/providers/cli-protocol.js";

// ══════════════════════════════════════════
// messages_to_prompt — tool_calls + tool_call_id
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
      { function: { name: "" } }, // no name → filtered
      { function: { name: "valid_tool", description: "does something", parameters: { properties: {}, required: [] } } },
    ];
    const r = messages_to_prompt([{ role: "user", content: "test" }], tools as any);
    expect(r).toContain("valid_tool");
  });

  it("compact_tool_catalog: 비객체 행 → 필터됨", () => {
    const tools = [
      null, // non-object → filtered
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
    // tool_32 (index 32)는 잘려야 함
    expect(r).toContain("tool_31");
    expect(r).not.toContain("tool_32");
  });
});

// ══════════════════════════════════════════
// collect_text_deep — 간접 호출 (extract_json_event_text 통해)
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
});

// ══════════════════════════════════════════
// strip_protocol_scaffold — 필터 패턴들
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

  it("빈 문자열 → 빈 문자열", () => {
    expect(strip_protocol_scaffold("")).toBe("");
  });

  it("마커만 있으면 빈 문자열 → 필터 후 빈 문자열", () => {
    const text = `${OUTPUT_BLOCK_START}\n<final answer>\n${OUTPUT_BLOCK_END}`;
    const r = strip_protocol_scaffold(text);
    expect(r).toBe("");
  });
});

// ══════════════════════════════════════════
// parse_json_line 엣지케이스
// ══════════════════════════════════════════

describe("parse_json_line 엣지케이스", () => {
  it("배열 JSON → null (객체가 아님)", () => {
    expect(parse_json_line('["a","b"]')).toBeNull();
  });

  it("null JSON → null", () => {
    expect(parse_json_line("null")).toBeNull();
  });

  it("끝에 공백 있는 JSON + } 이후 텍스트 → null", () => {
    expect(parse_json_line('{"key": "val"} extra')).toBeNull();
  });

  it("유효한 JSON 객체 → 파싱됨", () => {
    const r = parse_json_line('{"type":"result","response":"ok"}');
    expect(r).toMatchObject({ type: "result", response: "ok" });
  });

  it("빈 문자열 → null", () => {
    expect(parse_json_line("")).toBeNull();
  });

  it("잘못된 JSON → null", () => {
    expect(parse_json_line("{broken json}")).toBeNull();
  });
});
