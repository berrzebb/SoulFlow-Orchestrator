/**
 * PasswordTool — 비밀번호 강도/정책/해싱/생성/엔트로피 테스트.
 */
import { describe, it, expect } from "vitest";
import { PasswordTool } from "../../../src/agent/tools/password.js";

const tool = new PasswordTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("PasswordTool — strength", () => {
  it("강력한 비밀번호 분석", async () => {
    const r = await exec({ action: "strength", password: "MyP@ssw0rd!XYZ" }) as Record<string, unknown>;
    expect(r.has_upper).toBe(true);
    expect(r.has_lower).toBe(true);
    expect(r.has_digit).toBe(true);
    expect(r.has_special).toBe(true);
    expect(["fair", "strong", "very_strong"]).toContain(r.score);
  });

  it("약한 비밀번호 → very_weak 또는 weak", async () => {
    const r = await exec({ action: "strength", password: "abc" }) as Record<string, unknown>;
    expect(["very_weak", "weak"]).toContain(r.score);
  });

  it("공통 패스워드 → warnings 포함", async () => {
    const r = await exec({ action: "strength", password: "password123" }) as Record<string, unknown>;
    const warns = r.warnings as string[];
    expect(warns.some((w) => w.includes("common"))).toBe(true);
  });

  it("반복 문자 → warnings 포함", async () => {
    const r = await exec({ action: "strength", password: "aaabbbccc" }) as Record<string, unknown>;
    const warns = r.warnings as string[];
    expect(warns.some((w) => w.includes("repeated"))).toBe(true);
  });
});

describe("PasswordTool — check_policy", () => {
  it("강한 비밀번호 → valid: true", async () => {
    const r = await exec({
      action: "check_policy",
      password: "StrongPw1",
      min_length: 8,
      require_upper: true,
      require_lower: true,
      require_digit: true,
    }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("짧은 비밀번호 → 오류 포함", async () => {
    const r = await exec({ action: "check_policy", password: "ab1", min_length: 8 }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    const errors = r.errors as string[];
    expect(errors.some((e) => e.includes("too short"))).toBe(true);
  });

  it("대문자 없음 → 오류 포함", async () => {
    const r = await exec({
      action: "check_policy",
      password: "lowercase1",
      require_upper: true,
    }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("특수문자 필요 + 없음 → 오류", async () => {
    const r = await exec({
      action: "check_policy",
      password: "Password1",
      require_special: true,
    }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    const errors = r.errors as string[];
    expect(errors.some((e) => e.includes("special"))).toBe(true);
  });
});

describe("PasswordTool — generate", () => {
  it("기본 길이 16자리 생성", async () => {
    const r = await exec({ action: "generate" }) as Record<string, unknown>;
    expect(String(r.password).length).toBe(16);
  });

  it("길이 지정 생성", async () => {
    const r = await exec({ action: "generate", length: 24 }) as Record<string, unknown>;
    expect(String(r.password).length).toBe(24);
  });

  it("alpha charset → 알파벳만", async () => {
    const r = await exec({ action: "generate", length: 20, charset: "alpha" }) as Record<string, unknown>;
    expect(/^[a-zA-Z]+$/.test(String(r.password))).toBe(true);
  });

  it("alnum charset → 알파벳+숫자", async () => {
    const r = await exec({ action: "generate", length: 20, charset: "alnum" }) as Record<string, unknown>;
    expect(/^[a-zA-Z0-9]+$/.test(String(r.password))).toBe(true);
  });
});

describe("PasswordTool — hash & verify", () => {
  it("해싱 후 검증 성공", async () => {
    const pw = "TestPassword123!";
    const hashed_r = await exec({ action: "hash", password: pw }) as Record<string, unknown>;
    const hash = String(hashed_r.hash);
    expect(hash.startsWith("scrypt:")).toBe(true);

    const verify_r = await exec({ action: "verify", password: pw, hashed: hash }) as Record<string, unknown>;
    expect(verify_r.match).toBe(true);
  });

  it("잘못된 비밀번호로 검증 실패", async () => {
    const hashed_r = await exec({ action: "hash", password: "correct" }) as Record<string, unknown>;
    const hash = String(hashed_r.hash);
    const verify_r = await exec({ action: "verify", password: "wrong", hashed: hash }) as Record<string, unknown>;
    expect(verify_r.match).toBe(false);
  });

  it("잘못된 해시 형식 → error", async () => {
    const r = await exec({ action: "verify", password: "pw", hashed: "invalid:hash" }) as Record<string, unknown>;
    expect(r.match).toBe(false);
    expect(r.error).toBeDefined();
  });
});

describe("PasswordTool — entropy", () => {
  it("엔트로피 계산", async () => {
    const r = await exec({ action: "entropy", password: "MyP@ssword1" }) as Record<string, unknown>;
    expect(Number(r.entropy_bits)).toBeGreaterThan(0);
    expect(Number(r.pool_size)).toBeGreaterThan(0);
  });

  it("숫자만 → pool_size: 10", async () => {
    const r = await exec({ action: "entropy", password: "12345678" }) as Record<string, unknown>;
    expect(r.pool_size).toBe(10);
  });
});

// L104: unknown action (default branch)
describe("PasswordTool — unknown action + strong score (L104, L125)", () => {
  it("알 수 없는 action → error 반환 (L104)", async () => {
    const r = await exec({ action: "unknown_action" }) as Record<string, unknown>;
    expect(r.error).toContain("unknown action");
  });

  it("10자 혼합 비밀번호 → score=strong (entropy 60-80 범위) (L125)", async () => {
    // pool=95 (upper+lower+digit+special), length=10 → entropy≈65.7 → strong
    const r = await exec({ action: "strength", password: "Abc1!Xyz2@" }) as Record<string, unknown>;
    expect(r.score).toBe("strong");
  });
});

describe("PasswordTool — check_policy 미커버 분기", () => {
  it("소문자 없음 → L48 missing lowercase 에러", async () => {
    const r = await tool.execute({
      action: "check_policy",
      password: "UPPERCASE1",
      require_lower: true,
    });
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.some((e: string) => e.includes("lowercase"))).toBe(true);
  });

  it("반복 문자 → L50 repeated characters 에러", async () => {
    const r = await tool.execute({
      action: "check_policy",
      password: "aaabbbCCC1",
    });
    const parsed = JSON.parse(r);
    expect(parsed.errors.some((e: string) => e.includes("repeated"))).toBe(true);
  });

  it("순차 패턴 → L51 sequential pattern 에러", async () => {
    const r = await tool.execute({
      action: "check_policy",
      password: "123abcABC!",
    });
    const parsed = JSON.parse(r);
    expect(parsed.errors.some((e: string) => e.includes("sequential"))).toBe(true);
  });
});
