/**
 * command-intent — 미커버 분기 (cov3):
 * - L163: parse_decision_set_pair → RE_KEY_VALUE 매치 후 value.trim() = "" → return null
 *
 * RE_KEY_VALUE = /^([^=:=]{1,120})\s*[:=]\s*(.+)$/
 * "key: " (콜론 뒤 공백만) → eq[2]=" ", trim()="" → !value → L163 null 반환.
 */
import { describe, it, expect } from "vitest";
import { parse_decision_set_pair } from "@src/channels/command-intent.js";

// ── L163: key=value 매치 후 value 공백만 → null ───────────────────────────────

describe("parse_decision_set_pair — L163: value 공백 → null", () => {
  it("'key: ' (콜론 뒤 공백) → eq[2]=' ', trim()='' → !value → null (L163)", () => {
    // RE_KEY_VALUE가 eq[2]=" "로 매치, trim 후 빈 값 → L163 null 반환
    const result = parse_decision_set_pair("key: ");
    expect(result).toBeNull();
  });

  it("'mykey= ' (등호 뒤 공백) → value 공백 → null (L163)", () => {
    const result = parse_decision_set_pair("mykey= ");
    expect(result).toBeNull();
  });

  it("'key: value' 정상 입력 → null 아님 (대조)", () => {
    const result = parse_decision_set_pair("key: value");
    expect(result).not.toBeNull();
    expect(result?.key).toBe("key");
    expect(result?.value).toBe("value");
  });
});
