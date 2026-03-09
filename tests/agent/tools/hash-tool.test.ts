/**
 * HashTool — hash/hmac/verify 테스트.
 */
import { describe, it, expect } from "vitest";
import { HashTool } from "../../../src/agent/tools/hash.js";

const tool = new HashTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("HashTool — hash", () => {
  it("SHA-256 해시 계산 (기본)", async () => {
    const r = await exec({ action: "hash", input: "hello" }) as Record<string, unknown>;
    expect(r.algorithm).toBe("sha256");
    expect(r.encoding).toBe("hex");
    expect(String(r.digest)).toHaveLength(64);
  });

  it("결정론적 해시 — 동일 입력 → 동일 출력", async () => {
    const r1 = await exec({ action: "hash", input: "hello" }) as Record<string, unknown>;
    const r2 = await exec({ action: "hash", input: "hello" }) as Record<string, unknown>;
    expect(r1.digest).toBe(r2.digest);
  });

  it("MD5 해시", async () => {
    const r = await exec({ action: "hash", input: "hello", algorithm: "md5" }) as Record<string, unknown>;
    expect(r.algorithm).toBe("md5");
    expect(String(r.digest)).toHaveLength(32);
  });

  it("SHA-512 해시", async () => {
    const r = await exec({ action: "hash", input: "hello", algorithm: "sha512" }) as Record<string, unknown>;
    expect(String(r.digest)).toHaveLength(128);
  });

  it("SHA-1 해시", async () => {
    const r = await exec({ action: "hash", input: "hello", algorithm: "sha1" }) as Record<string, unknown>;
    expect(String(r.digest)).toHaveLength(40);
  });

  it("base64 인코딩", async () => {
    const r = await exec({ action: "hash", input: "hello", encoding: "base64" }) as Record<string, unknown>;
    expect(String(r.encoding)).toBe("base64");
    expect(String(r.digest)).not.toMatch(/^[0-9a-f]+$/); // not pure hex
  });

  it("지원하지 않는 알고리즘 → Error", async () => {
    const r = await exec({ action: "hash", input: "hello", algorithm: "sha999" });
    expect(String(r)).toContain("Error");
  });
});

describe("HashTool — hmac", () => {
  it("HMAC-SHA256 계산", async () => {
    const r = await exec({ action: "hmac", input: "hello", key: "secret" }) as Record<string, unknown>;
    expect(r.algorithm).toBe("sha256");
    expect(r.digest).toBeDefined();
    expect(String(r.digest).length).toBeGreaterThan(0);
  });

  it("결정론적 HMAC", async () => {
    const r1 = await exec({ action: "hmac", input: "data", key: "key" }) as Record<string, unknown>;
    const r2 = await exec({ action: "hmac", input: "data", key: "key" }) as Record<string, unknown>;
    expect(r1.digest).toBe(r2.digest);
  });

  it("다른 키 → 다른 HMAC", async () => {
    const r1 = await exec({ action: "hmac", input: "data", key: "key1" }) as Record<string, unknown>;
    const r2 = await exec({ action: "hmac", input: "data", key: "key2" }) as Record<string, unknown>;
    expect(r1.digest).not.toBe(r2.digest);
  });

  it("key 없음 → Error", async () => {
    const r = await exec({ action: "hmac", input: "hello" });
    expect(String(r)).toContain("Error");
  });
});

describe("HashTool — verify", () => {
  it("올바른 해시 검증 → match: true", async () => {
    const h = await exec({ action: "hash", input: "hello" }) as Record<string, unknown>;
    const r = await exec({ action: "verify", input: "hello", expected: h.digest }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });

  it("잘못된 해시 → match: false", async () => {
    const r = await exec({ action: "verify", input: "hello", expected: "wrong_hash" }) as Record<string, unknown>;
    expect(r.match).toBe(false);
  });

  it("HMAC 검증 (key 포함)", async () => {
    const h = await exec({ action: "hmac", input: "data", key: "secret" }) as Record<string, unknown>;
    const r = await exec({ action: "verify", input: "data", key: "secret", expected: h.digest }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });

  it("expected 없음 → Error", async () => {
    const r = await exec({ action: "verify", input: "hello" });
    expect(String(r)).toContain("Error");
  });

  it("지원하지 않는 action → Error (L59)", async () => {
    const r = await exec({ action: "unsupported_action" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("unsupported");
  });
});
