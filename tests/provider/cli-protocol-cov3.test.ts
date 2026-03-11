/**
 * cli-protocol.ts — 미커버 분기 (cov3):
 * - L174: collect_text_deep → depth > 4 → ""
 * - L175: collect_text_deep → typeof value === "string" → value
 * - L209: parse_json_line → JSON.parse throws → catch → null
 */
import { describe, it, expect } from "vitest";
import { extract_json_event_text, parse_json_line } from "@src/providers/cli-protocol.js";

// ── L174: depth > 4 → "" ─────────────────────────────────────────────────────

describe("collect_text_deep — L174: depth > 4 → empty string", () => {
  it("5단계 중첩 content → depth=5에서 L174: if (depth > 4) return ''", () => {
    // type.includes("delta") → collect_text_deep(event, 0) 호출
    // content 5단계 중첩 → depth=5에서 L174 실행
    const event = {
      type: "content_block_delta",
      content: {
        content: {
          content: {
            content: {
              content: "deep text", // depth=5에 도달하면 L174로 ""  반환
            },
          },
        },
      },
    };
    const result = extract_json_event_text(event as Record<string, unknown>, { last_full_text: "" });
    // depth > 4 → 깊이 제한으로 "" 반환 → delta 비어있음 → {}
    expect(result).toEqual({});
  });
});

// ── L175: typeof value === "string" → value ──────────────────────────────────

describe("collect_text_deep — L175: string value in array → return value", () => {
  it("content 배열 내 문자열 → 재귀 depth=2에서 L175: typeof string → return value", () => {
    // content = ["hello world"] → 배열 → 배열요소 recurse → 문자열 → L175 실행
    const event = {
      type: "content_block_delta",
      content: ["hello world"],
    };
    const result = extract_json_event_text(event as Record<string, unknown>, { last_full_text: "" });
    // depth=2에서 L175로 "hello world" 반환 → delta = "hello world"
    expect(result.delta).toBe("hello world");
  });
});

// ── L209: parse_json_line catch → null ───────────────────────────────────────

describe("parse_json_line — L209: JSON.parse throws → null", () => {
  it("'{invalid}' → {로 시작 }로 끝나지만 JSON 파싱 실패 → catch → null (L209)", () => {
    // "{invalid}" starts with { and ends with } → passes first guard
    // JSON.parse("{invalid}") throws SyntaxError → catch → null
    const result = parse_json_line("{invalid json here}");
    expect(result).toBeNull();
  });

  it("'{\"valid\": true}' → 유효한 JSON → parse 성공 → null 아님", () => {
    const result = parse_json_line('{"valid": true}');
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).valid).toBe(true);
  });
});
