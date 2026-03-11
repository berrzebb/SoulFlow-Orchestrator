/**
 * cli-protocol.ts — 미커버 분기 (cov4):
 * - L349: ORCH_FINAL 내부 ORCH_TOOL_CALLS 블록 파싱 성공 → return
 * - L352: ORCH_FINAL 내부 직접 텍스트 파싱 성공 → return
 *
 * 핵심: L322 ORCH_TOOL_CALLS 검색에서 마지막 블록 = NOT_PARSEABLE_JSON이
 * 되도록 후속 비파싱 블록을 추가. L328이 skip되어 L344 경로 진입.
 */
import { describe, it, expect } from "vitest";
import {
  OUTPUT_BLOCK_START,
  OUTPUT_BLOCK_END,
  TOOL_BLOCK_START,
  TOOL_BLOCK_END,
  __cli_provider_test__,
} from "@src/providers/cli-protocol.js";

const { parse_tool_calls_from_output } = __cli_provider_test__;

// ── L349: protocol_block 파싱 성공 ──────────────────────────────────────────

describe("parse_tool_calls_from_output — L349", () => {
  it("ORCH_FINAL 내 ORCH_TOOL_CALLS [{name}] + 후속 비파싱 블록 → L349 반환", () => {
    // L322: last ORCH_TOOL_CALLS = "NOT_PARSEABLE" → out=[] → L328 skip
    // L344: final_from_protocol 에서 ORCH_TOOL_CALLS 발견 → L349 반환
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

    const r = parse_tool_calls_from_output(raw);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].name).toBe("get_weather");
  });
});

// ── L352: protocol 직접 텍스트 파싱 ─────────────────────────────────────────

describe("parse_tool_calls_from_output — L352", () => {
  it("ORCH_FINAL 내 JSON 배열 직접 (TOOL_BLOCK 없음) + 후속 비파싱 블록 → L352 반환", () => {
    // L346: protocol_block="" (ORCH_FINAL 내에 TOOL_BLOCK 없음) → L347 skip
    // L351: parse_tool_calls_from_text(final_from_protocol) 파싱 성공 → L352 반환
    const tool_json = JSON.stringify([{ name: "send_email", arguments: { to: "user@example.com" } }]);
    const raw = [
      OUTPUT_BLOCK_START,
      tool_json,
      OUTPUT_BLOCK_END,
      TOOL_BLOCK_START,
      "NOT_PARSEABLE_JSON_TEXT",
      TOOL_BLOCK_END,
    ].join("");

    const r = parse_tool_calls_from_output(raw);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].name).toBe("send_email");
  });
});
