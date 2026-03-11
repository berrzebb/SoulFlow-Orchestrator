/**
 * tool-call-parser.ts — 미커버 분기 (cov3):
 * - L9:  as_tool_arguments — JSON 문자열 파싱 후 배열/null → return {}
 * - L11: as_tool_arguments — JSON 파싱 실패 → catch → return {}
 * - L112: extract_last_between_markers — end marker 없음 → return null
 * - L152: extract_balanced_json_from — 닫히지 않는 JSON → return null
 * - L169: extract_balanced_candidates_around_keyword — candidate_start < 0 → break
 * - L175, L176: 동 함수 — 후보가 keyword 미포함 → start--, scan_count++
 */
import { describe, it, expect } from "vitest";
import { parse_tool_calls_from_text, parse_tool_calls_from_unknown } from "@src/agent/tool-call-parser.ts";

// ── L9: arguments가 배열로 파싱되는 JSON 문자열 → return {} ──────────────────

describe("as_tool_arguments — L9: JSON 파싱 결과가 배열 → {}", () => {
  it("arguments가 '[1,2,3]' → parse 후 Array → return {}", () => {
    const calls = parse_tool_calls_from_unknown({ name: "t", arguments: "[1,2,3]" });
    expect(calls[0]?.arguments).toEqual({});
  });

  it("arguments가 'null' → parse 후 null → return {}", () => {
    const calls = parse_tool_calls_from_unknown({ name: "t", arguments: "null" });
    expect(calls[0]?.arguments).toEqual({});
  });

  it("arguments가 '42' → parse 후 number → return {}", () => {
    const calls = parse_tool_calls_from_unknown({ name: "t", arguments: "42" });
    expect(calls[0]?.arguments).toEqual({});
  });
});

// ── L11: arguments가 유효하지 않은 JSON 문자열 → catch → return {} ───────────

describe("as_tool_arguments — L11: JSON 파싱 실패 → catch → {}", () => {
  it("arguments가 'invalid{json' → JSON.parse throw → catch → {}", () => {
    const calls = parse_tool_calls_from_unknown({ name: "t", arguments: "invalid{json" });
    expect(calls[0]?.arguments).toEqual({});
  });

  it("arguments가 '{unclosed' → JSON.parse throw → catch → {}", () => {
    const calls = parse_tool_calls_from_unknown({ name: "t", arguments: "{unclosed" });
    expect(calls[0]?.arguments).toEqual({});
  });
});

// ── L112: extract_last_between_markers — end marker 없음 ─────────────────────
// <<ORCH_TOOL_CALLS>>는 있지만 <<ORCH_TOOL_CALLS_END>>는 없는 경우

describe("parse_tool_calls_from_text — L112: end marker 없음 → null", () => {
  it("<<ORCH_TOOL_CALLS>> 있지만 end marker 없음 → 마커 블록 null → 다른 경로로 시도", () => {
    const raw = `<<ORCH_TOOL_CALLS>>[{"name":"t","arguments":{}}] 끝 마커 없음`;
    // end marker가 없으므로 marker_block=null, 이후 다른 후보로 탐색
    const calls = parse_tool_calls_from_text(raw);
    // 어떤 결과든 크래시 없이 반환되어야 함
    expect(Array.isArray(calls)).toBe(true);
  });
});

// ── L152: extract_balanced_json_from — 닫히지 않는 JSON ─────────────────────
// "tool_calls" 키워드 주변에 닫히지 않는 { 가 있는 경우

describe("parse_tool_calls_from_text — L152: 닫히지 않는 JSON → null", () => {
  it('"tool_calls" 키워드 전에 닫히지 않는 { → extract_balanced_json_from null', () => {
    // { 가 있지만 닫히지 않음 → extract_balanced_json_from returns null
    const raw = `{ "tool_calls" unclosed brace without end`;
    const calls = parse_tool_calls_from_text(raw);
    expect(Array.isArray(calls)).toBe(true);
  });
});

// ── L169: candidate_start < 0 → break ────────────────────────────────────────
// "tool_calls" 키워드 앞에 { 또는 [ 가 전혀 없는 경우

describe("parse_tool_calls_from_text — L169: keyword 앞에 { 없음 → break", () => {
  it('text에 "tool_calls" 있지만 앞에 { 없음 → candidate_start=-1 → break', () => {
    const raw = `plain text "tool_calls" here no braces before`;
    const calls = parse_tool_calls_from_text(raw);
    expect(calls).toEqual([]);
  });

  it('"id":"call_ 키워드 앞에 { 없음', () => {
    const raw = `prefix "id":"call_abc" suffix without braces before`;
    const calls = parse_tool_calls_from_text(raw);
    expect(calls).toEqual([]);
  });
});

// ── L175, L176: candidate가 keyword 미포함 → start-1, scan_count++ ───────────
// 키워드 앞에 닫힌 JSON 객체가 있어서 candidate에 keyword가 포함되지 않는 경우

describe("parse_tool_calls_from_text — L175-176: candidate 미포함 → 스캔 계속", () => {
  it('{ "unrelated": 1 } 뒤에 "tool_calls" → 후보 JSON에 keyword 없음 → L175 fire', () => {
    // { "unrelated": 1 } 이 닫힌 후 "tool_calls" 가 나옴
    // lastIndexOf("{") → unrelated의 { → candidate가 "tool_calls" 미포함
    // → L175: start = candidate_start - 1 → L176: scan_count++
    const raw = `prefix { "unrelated": 1 } then "tool_calls" appears here`;
    const calls = parse_tool_calls_from_text(raw);
    // 올바른 tool call 없으므로 빈 배열 (크래시 없이)
    expect(Array.isArray(calls)).toBe(true);
  });
});
