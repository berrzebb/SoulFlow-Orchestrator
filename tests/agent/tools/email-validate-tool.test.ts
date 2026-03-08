/**
 * EmailValidateTool — 이메일 검증/파싱/정규화 테스트.
 */
import { describe, it, expect } from "vitest";
import { EmailValidateTool } from "../../../src/agent/tools/email-validate.js";

const tool = new EmailValidateTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("EmailValidateTool — validate", () => {
  it("유효한 이메일 → valid: true", async () => {
    const r = await exec({ action: "validate", email: "user@example.com" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect((r.errors as string[]).length).toBe(0);
  });

  it("@ 없음 → valid: false", async () => {
    const r = await exec({ action: "validate", email: "notanemail" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("빈 이메일 → valid: false", async () => {
    const r = await exec({ action: "validate", email: "" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("도메인 TLD 없음 → valid: false", async () => {
    const r = await exec({ action: "validate", email: "user@localhost" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("연속된 점 → valid: false", async () => {
    const r = await exec({ action: "validate", email: "user..name@example.com" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });
});

describe("EmailValidateTool — parse", () => {
  it("이메일 파싱", async () => {
    const r = await exec({ action: "parse", email: "user+tag@gmail.com" }) as Record<string, unknown>;
    expect(r.local).toBe("user+tag");
    expect(r.domain).toBe("gmail.com");
    expect(r.base_local).toBe("user");
    expect(r.tag).toBe("tag");
    expect(r.is_free).toBe(true);
  });

  it("plus tag 없음", async () => {
    const r = await exec({ action: "parse", email: "user@example.com" }) as Record<string, unknown>;
    expect(r.tag).toBeNull();
    expect(r.base_local).toBe("user");
  });

  it("@ 없음 → error", async () => {
    const r = await exec({ action: "parse", email: "invalid" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("EmailValidateTool — normalize", () => {
  it("대소문자 정규화", async () => {
    const r = await exec({ action: "normalize", email: "User@Example.COM" }) as Record<string, unknown>;
    expect(r.normalized).toBe("user@example.com");
  });

  it("Gmail — 점 제거 + 태그 제거", async () => {
    const r = await exec({ action: "normalize", email: "u.s.e.r+tag@gmail.com" }) as Record<string, unknown>;
    expect(r.normalized).toBe("user@gmail.com");
  });

  it("@ 없음 → error", async () => {
    const r = await exec({ action: "normalize", email: "invalid" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("EmailValidateTool — check_disposable", () => {
  it("일회용 이메일 감지", async () => {
    const r = await exec({ action: "check_disposable", email: "test@mailinator.com" }) as Record<string, unknown>;
    expect(r.is_disposable).toBe(true);
  });

  it("정상 이메일 → false", async () => {
    const r = await exec({ action: "check_disposable", email: "user@gmail.com" }) as Record<string, unknown>;
    expect(r.is_disposable).toBe(false);
  });
});

describe("EmailValidateTool — check_free", () => {
  it("무료 이메일 감지", async () => {
    const r = await exec({ action: "check_free", email: "user@gmail.com" }) as Record<string, unknown>;
    expect(r.is_free).toBe(true);
  });

  it("기업 이메일 → false", async () => {
    const r = await exec({ action: "check_free", email: "user@mycompany.com" }) as Record<string, unknown>;
    expect(r.is_free).toBe(false);
  });
});

describe("EmailValidateTool — bulk_validate", () => {
  it("복수 이메일 검증", async () => {
    const emails = JSON.stringify(["user@example.com", "invalid", "another@test.org"]);
    const r = await exec({ action: "bulk_validate", emails }) as Record<string, unknown>;
    expect(r.total).toBe(3);
    expect(r.valid).toBe(2);
    expect(r.invalid).toBe(1);
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "bulk_validate", emails: "not-json" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});
