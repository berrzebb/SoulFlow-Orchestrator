/**
 * tool-call-parser — 미커버 분기 보충.
 * as_tool_arguments 비문자열/비객체, normalize_tool_call 대체 필드명,
 * extract_last_between_markers ORCH_TOOL_CALLS 마커,
 * dedupe_tool_calls 중복 제거, extract_balanced_candidates 키워드 탐색.
 */
import { describe, it, expect } from "vitest";
import { parse_tool_calls_from_text, parse_tool_calls_from_unknown, dedupe_tool_calls } from "@src/agent/tool-call-parser.ts";

// ══════════════════════════════════════════
// parse_tool_calls_from_unknown — 대체 필드명
// ══════════════════════════════════════════

describe("parse_tool_calls_from_unknown — 대체 name 필드", () => {
  it("tool_name 필드 사용", () => {
    const raw = { tool_name: "my_tool", id: "c1", arguments: {} };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "my_tool")).toBe(true);
  });

  it("toolName 필드 사용", () => {
    const raw = { toolName: "tool_b", id: "c2", arguments: {} };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "tool_b")).toBe(true);
  });

  it("function_name 필드 사용", () => {
    const raw = { function_name: "fn_c", id: "c3", arguments: {} };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "fn_c")).toBe(true);
  });

  it("functionName 필드 사용", () => {
    const raw = { functionName: "fn_d", id: "c4", arguments: {} };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "fn_d")).toBe(true);
  });

  it("function.name 필드 사용", () => {
    const raw = { function: { name: "fn_nested", arguments: {} } };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "fn_nested")).toBe(true);
  });
});

describe("parse_tool_calls_from_unknown — 대체 id 필드", () => {
  it("call_id 필드 사용", () => {
    const raw = { name: "t1", call_id: "myid1", arguments: {} };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.id).toBe("myid1");
  });

  it("callId 필드 사용", () => {
    const raw = { name: "t2", callId: "myid2", arguments: {} };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.id).toBe("myid2");
  });

  it("tool_call_id 필드 사용", () => {
    const raw = { name: "t3", tool_call_id: "tcid3", arguments: {} };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.id).toBe("tcid3");
  });

  it("toolCallId 필드 사용", () => {
    const raw = { name: "t4", toolCallId: "tcid4", arguments: {} };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.id).toBe("tcid4");
  });

  it("id 없으면 자동 생성 (call_N)", () => {
    const raw = { name: "t5", arguments: {} };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.id).toMatch(/^call_/);
  });
});

describe("parse_tool_calls_from_unknown — 대체 arguments 필드", () => {
  it("args 필드 사용", () => {
    const raw = { name: "t", id: "c", args: { key: "val" } };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.arguments?.key).toBe("val");
  });

  it("input 필드 사용", () => {
    const raw = { name: "t", id: "c", input: { x: 1 } };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.arguments?.x).toBe(1);
  });

  it("params 필드 사용", () => {
    const raw = { name: "t", id: "c", params: { p: "yes" } };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.arguments?.p).toBe("yes");
  });

  it("arguments가 JSON 문자열 → 파싱됨", () => {
    const raw = { name: "t", id: "c", arguments: '{"q": 42}' };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.arguments?.q).toBe(42);
  });

  it("arguments가 배열 → {} 반환", () => {
    const raw = { name: "t", id: "c", arguments: [1, 2, 3] };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.arguments).toEqual({});
  });

  it("arguments가 숫자 → {} 반환", () => {
    const raw = { name: "t", id: "c", arguments: 42 };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls[0]?.arguments).toEqual({});
  });
});

// ══════════════════════════════════════════
// parse_tool_calls_from_unknown — 대체 리스트 필드
// ══════════════════════════════════════════

describe("parse_tool_calls_from_unknown — 대체 리스트 필드", () => {
  it("toolCalls 필드에서 추출", () => {
    const raw = {
      toolCalls: [{ name: "t_toolCalls", id: "x1", arguments: {} }],
    };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "t_toolCalls")).toBe(true);
  });

  it("calls 필드에서 추출", () => {
    const raw = {
      calls: [{ name: "t_calls", id: "x2", arguments: {} }],
    };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "t_calls")).toBe(true);
  });

  it("output 필드에서 추출", () => {
    const raw = {
      output: [{ name: "t_output", id: "x3", arguments: {} }],
    };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "t_output")).toBe(true);
  });

  it("items 필드에서 추출", () => {
    const raw = {
      items: [{ name: "t_items", id: "x4", arguments: {} }],
    };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "t_items")).toBe(true);
  });

  it("messages 필드에서 추출", () => {
    const raw = {
      messages: [{ name: "t_messages", id: "x5", arguments: {} }],
    };
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls.some((c) => c.name === "t_messages")).toBe(true);
  });
});

// ══════════════════════════════════════════
// parse_tool_calls_from_unknown — 특수 케이스
// ══════════════════════════════════════════

describe("parse_tool_calls_from_unknown — 특수 케이스", () => {
  it("null/undefined → 빈 배열", () => {
    expect(parse_tool_calls_from_unknown(null)).toEqual([]);
    expect(parse_tool_calls_from_unknown(undefined)).toEqual([]);
  });

  it("숫자 → 빈 배열", () => {
    expect(parse_tool_calls_from_unknown(42)).toEqual([]);
  });

  it("이름 없는 객체 → 무시됨", () => {
    const raw = { id: "c1", arguments: {} }; // name 없음
    const calls = parse_tool_calls_from_unknown(raw);
    expect(calls).toEqual([]);
  });

  it("깊은 중첩 (depth > 8) → 탐색 중단", () => {
    // depth > 8을 유발하는 깊은 중첩 → 에러 없이 처리
    let nested: Record<string, unknown> = { name: "deep", arguments: {} };
    for (let i = 0; i < 10; i++) nested = { sub: nested };
    const calls = parse_tool_calls_from_unknown(nested);
    // 에러 없이 실행됨
    expect(Array.isArray(calls)).toBe(true);
  });
});

// ══════════════════════════════════════════
// dedupe_tool_calls
// ══════════════════════════════════════════

describe("dedupe_tool_calls — 중복 제거", () => {
  it("동일 name+arguments → 1개로 중복 제거", () => {
    const calls = [
      { id: "c1", name: "tool", arguments: { x: 1 } },
      { id: "c2", name: "tool", arguments: { x: 1 } }, // 중복
    ];
    const result = dedupe_tool_calls(calls);
    expect(result).toHaveLength(1);
  });

  it("다른 arguments → 모두 유지", () => {
    const calls = [
      { id: "c1", name: "tool", arguments: { x: 1 } },
      { id: "c2", name: "tool", arguments: { x: 2 } },
    ];
    const result = dedupe_tool_calls(calls);
    expect(result).toHaveLength(2);
  });

  it("빈 배열 → 빈 배열", () => {
    expect(dedupe_tool_calls([])).toEqual([]);
  });
});

// ══════════════════════════════════════════
// parse_tool_calls_from_text — ORCH_TOOL_CALLS 마커
// ══════════════════════════════════════════

describe("parse_tool_calls_from_text — ORCH_TOOL_CALLS 마커", () => {
  it("마커 블록에서 추출", () => {
    const json = JSON.stringify([{ id: "c1", name: "marked_tool", arguments: { v: 1 } }]);
    const raw = `작업 중...\n<<ORCH_TOOL_CALLS>>${json}<<ORCH_TOOL_CALLS_END>>\n계속.`;
    const calls = parse_tool_calls_from_text(raw);
    expect(calls.some((c) => c.name === "marked_tool")).toBe(true);
  });
});

// ══════════════════════════════════════════
// parse_tool_calls_from_text — fenced JSON block
// ══════════════════════════════════════════

describe("parse_tool_calls_from_text — ```json 펜스 블록", () => {
  it("```json 펜스에서 추출", () => {
    const json = JSON.stringify({
      tool_calls: [{ id: "c1", name: "fenced_tool", arguments: {} }],
    });
    const raw = "설명\n```json\n" + json + "\n```";
    const calls = parse_tool_calls_from_text(raw);
    expect(calls.some((c) => c.name === "fenced_tool")).toBe(true);
  });
});

// ══════════════════════════════════════════
// parse_tool_calls_from_text — 특수 케이스
// ══════════════════════════════════════════

describe("parse_tool_calls_from_text — 특수 케이스", () => {
  it("null/undefined → 빈 배열", () => {
    expect(parse_tool_calls_from_text(null)).toEqual([]);
    expect(parse_tool_calls_from_text(undefined)).toEqual([]);
  });

  it("빈 문자열 → 빈 배열", () => {
    expect(parse_tool_calls_from_text("")).toEqual([]);
  });

  it("[로 시작하는 JSON 배열 직접 파싱", () => {
    const raw = JSON.stringify([{ id: "c1", name: "direct_arr_tool", arguments: {} }]);
    const calls = parse_tool_calls_from_text(raw);
    expect(calls.some((c) => c.name === "direct_arr_tool")).toBe(true);
  });

  it('"id":"call_ 키워드로 탐색', () => {
    const payload = { "id": "call_abc", name: "kw_tool", arguments: { z: 9 } };
    const raw = "prefix text " + JSON.stringify(payload) + " suffix";
    const calls = parse_tool_calls_from_text(raw);
    // 키워드 탐색으로 추출됨
    expect(calls.some((c) => c.name === "kw_tool")).toBe(true);
  });
});
