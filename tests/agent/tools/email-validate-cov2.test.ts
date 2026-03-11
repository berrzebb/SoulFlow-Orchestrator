/**
 * email-validate.ts — 미커버 분기 보충:
 * - L100: local 파트 비어있음 (→ "@domain.com") → "empty local part" 에러
 * - L104: domain 형식 오류 → "invalid domain format" 에러
 */
import { describe, it, expect } from "vitest";
import { EmailValidateTool } from "@src/agent/tools/email-validate.js";

const tool = new EmailValidateTool();

describe("EmailValidateTool — L100: 빈 local 파트", () => {
  it("'@domain.com' → empty local part 에러 (L100)", async () => {
    const raw = await tool.execute({ action: "validate", email: "@domain.com" });
    const result = JSON.parse(raw) as { valid: boolean; errors: string[] };
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("empty local part");
  });
});

describe("EmailValidateTool — L104: 유효하지 않은 domain 형식", () => {
  it("'user@-invalid' → invalid domain format 에러 (L104)", async () => {
    const raw = await tool.execute({ action: "validate", email: "user@-invalid" });
    const result = JSON.parse(raw) as { valid: boolean; errors: string[] };
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("invalid domain format");
  });
});
