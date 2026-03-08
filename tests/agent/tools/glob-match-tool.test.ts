/**
 * GlobMatchTool — test/filter/extract/parse/to_regex 테스트.
 */
import { describe, it, expect } from "vitest";
import { GlobMatchTool } from "../../../src/agent/tools/glob-match.js";

const tool = new GlobMatchTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("GlobMatchTool — test", () => {
  it("와일드카드 * 매칭", async () => {
    const r = await exec({ action: "test", pattern: "*.ts", input: "hello.ts" }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });

  it("와일드카드 * 비매칭", async () => {
    const r = await exec({ action: "test", pattern: "*.ts", input: "hello.js" }) as Record<string, unknown>;
    expect(r.match).toBe(false);
  });

  it("? 단일 문자 매칭", async () => {
    const r = await exec({ action: "test", pattern: "file?.txt", input: "file1.txt" }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });

  it("** 글로브스타 매칭", async () => {
    const r = await exec({ action: "test", pattern: "src/**/*.ts", input: "src/agent/tools/foo.ts" }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });

  it("{a,b} 대안 매칭", async () => {
    const r = await exec({ action: "test", pattern: "*.{ts,js}", input: "hello.ts" }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });

  it("negate: true → 반전", async () => {
    const r = await exec({ action: "test", pattern: "*.ts", input: "hello.js", negate: true }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });
});

describe("GlobMatchTool — filter", () => {
  it("패턴 매칭 항목만 반환", async () => {
    const inputs = JSON.stringify(["a.ts", "b.js", "c.ts", "d.txt"]);
    const r = await exec({ action: "filter", pattern: "*.ts", inputs }) as Record<string, unknown>;
    expect(r.matched_count).toBe(2);
    expect((r.matched as string[])).toContain("a.ts");
    expect((r.matched as string[])).toContain("c.ts");
  });

  it("negate: true → 비매칭 항목 반환", async () => {
    const inputs = JSON.stringify(["a.ts", "b.js"]);
    const r = await exec({ action: "filter", pattern: "*.ts", inputs, negate: true }) as Record<string, unknown>;
    expect(r.matched_count).toBe(1);
    expect((r.matched as string[])[0]).toBe("b.js");
  });

  it("빈 배열 → matched_count 0", async () => {
    const r = await exec({ action: "filter", pattern: "*.ts", inputs: "[]" }) as Record<string, unknown>;
    expect(r.matched_count).toBe(0);
  });

  it("잘못된 inputs JSON → error", async () => {
    const r = await exec({ action: "filter", pattern: "*.ts", inputs: "not-json" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("GlobMatchTool — extract", () => {
  it("패턴 매칭 여부 반환", async () => {
    const r = await exec({ action: "extract", pattern: "*.ts", input: "hello.ts" }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });

  it("비매칭 → match: false, groups: []", async () => {
    const r = await exec({ action: "extract", pattern: "*.ts", input: "hello.js" }) as Record<string, unknown>;
    expect(r.match).toBe(false);
    expect(r.groups).toEqual([]);
  });
});

describe("GlobMatchTool — parse", () => {
  it("글로브 패턴 파싱", async () => {
    const r = await exec({ action: "parse", pattern: "src/**/*.ts" }) as Record<string, unknown>;
    expect(r.has_globstar).toBe(true);
    expect(r.has_wildcard).toBe(true);
    expect(Array.isArray(r.parts)).toBe(true);
  });

  it("리터럴 패턴 파싱", async () => {
    const r = await exec({ action: "parse", pattern: "hello.txt" }) as Record<string, unknown>;
    expect(r.has_globstar).toBe(false);
    expect(r.has_wildcard).toBe(false);
    expect(r.has_question).toBe(false);
  });
});

describe("GlobMatchTool — to_regex", () => {
  it("glob 패턴 → 정규식 반환", async () => {
    const r = await exec({ action: "to_regex", pattern: "*.ts" }) as Record<string, unknown>;
    expect(r.regex).toBeDefined();
    expect(String(r.regex)).toContain("ts");
  });
});
