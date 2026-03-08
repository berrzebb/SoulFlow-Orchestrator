/**
 * EnvTool — get/list/check/required/defaults 테스트.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EnvTool } from "../../../src/agent/tools/env.js";

const tool = new EnvTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

// 테스트용 환경변수 설정
beforeAll(() => {
  process.env.TEST_ENV_VAR_HELLO = "world123";
  process.env.TEST_ENV_EMPTY = "";
});

afterAll(() => {
  delete process.env.TEST_ENV_VAR_HELLO;
  delete process.env.TEST_ENV_EMPTY;
});

describe("EnvTool — get", () => {
  it("존재하는 환경변수 조회 (마스킹)", async () => {
    const r = await exec({ action: "get", key: "TEST_ENV_VAR_HELLO" }) as Record<string, unknown>;
    expect(r.exists).toBe(true);
    expect(String(r.value)).toContain("*"); // 마스킹됨
  });

  it("존재하는 환경변수 조회 (마스킹 해제)", async () => {
    const r = await exec({ action: "get", key: "TEST_ENV_VAR_HELLO", mask: false }) as Record<string, unknown>;
    expect(r.exists).toBe(true);
    expect(r.value).toBe("world123");
  });

  it("존재하지 않는 환경변수 → exists: false", async () => {
    const r = await exec({ action: "get", key: "NONEXISTENT_VAR_XYZ_12345" }) as Record<string, unknown>;
    expect(r.exists).toBe(false);
    expect(r.value).toBeNull();
  });

  it("key 없음 → Error", async () => {
    const r = await exec({ action: "get" });
    expect(String(r)).toContain("Error");
  });
});

describe("EnvTool — list", () => {
  it("환경변수 목록 반환", async () => {
    const r = await exec({ action: "list" }) as Record<string, unknown>;
    expect(r.count).toBeGreaterThan(0);
    expect(Array.isArray(r.variables)).toBe(true);
  });

  it("prefix 필터링", async () => {
    const r = await exec({ action: "list", prefix: "TEST_ENV_" }) as Record<string, unknown>;
    const vars = r.variables as { key: string }[];
    vars.forEach(v => expect(v.key.startsWith("TEST_ENV_")).toBe(true));
    expect(r.count).toBeGreaterThanOrEqual(1);
  });
});

describe("EnvTool — check", () => {
  it("존재하는 변수 → set: true", async () => {
    const r = await exec({ action: "check", keys: "TEST_ENV_VAR_HELLO" }) as Record<string, unknown>;
    const results = r.results as { key: string; exists: boolean; set: boolean }[];
    expect(results[0]?.set).toBe(true);
    expect(r.all_set).toBe(true);
  });

  it("없는 변수 포함 → all_set: false", async () => {
    const r = await exec({ action: "check", keys: "TEST_ENV_VAR_HELLO,NONEXISTENT_XYZ" }) as Record<string, unknown>;
    expect(r.all_set).toBe(false);
  });
});

describe("EnvTool — required", () => {
  it("모두 존재 → valid: true, missing: []", async () => {
    const r = await exec({ action: "required", keys: "TEST_ENV_VAR_HELLO" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect((r.missing as string[]).length).toBe(0);
  });

  it("누락 변수 → valid: false, missing에 포함", async () => {
    const r = await exec({ action: "required", keys: "TEST_ENV_VAR_HELLO,MISSING_VAR_XYZ" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect(r.missing).toContain("MISSING_VAR_XYZ");
  });
});

describe("EnvTool — defaults", () => {
  it("존재하는 변수 → source: env", async () => {
    const r = await exec({
      action: "defaults",
      defaults: JSON.stringify({ TEST_ENV_VAR_HELLO: "fallback" }),
    }) as Record<string, unknown>;
    const resolved = r.resolved as Record<string, { source: string }>;
    expect(resolved.TEST_ENV_VAR_HELLO?.source).toBe("env");
  });

  it("없는 변수 → source: default, 기본값 사용", async () => {
    const r = await exec({
      action: "defaults",
      defaults: JSON.stringify({ MISSING_VAR_XYZ_123: "my-default" }),
      mask: false,
    }) as Record<string, unknown>;
    const resolved = r.resolved as Record<string, { source: string; value: string }>;
    expect(resolved.MISSING_VAR_XYZ_123?.source).toBe("default");
    expect(resolved.MISSING_VAR_XYZ_123?.value).toBe("my-default");
  });

  it("잘못된 JSON → Error", async () => {
    const r = await exec({ action: "defaults", defaults: "not-json" });
    expect(String(r)).toContain("Error");
  });
});
