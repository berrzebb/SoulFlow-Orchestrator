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

// ══════════════════════════════════════════
// glob_to_regex 경로: char class [...]
// ══════════════════════════════════════════

describe("GlobMatchTool — char class [...]", () => {
  it("[abc] → 문자 클래스 매칭", async () => {
    const r = await exec({ action: "filter", pattern: "file[abc].ts", inputs: JSON.stringify(["filea.ts", "filed.ts", "fileb.ts"]) }) as any;
    expect(r.matched).toContain("filea.ts");
    expect(r.matched).toContain("fileb.ts");
    expect(r.matched).not.toContain("filed.ts");
  });

  it("[!abc] 부정 클래스 → 매칭 제외", async () => {
    const r = await exec({ action: "filter", pattern: "file[!ab].ts", inputs: JSON.stringify(["filea.ts", "filec.ts"]) }) as any;
    expect(r.matched).toContain("filec.ts");
    expect(r.matched).not.toContain("filea.ts");
  });

  it("[^abc] 부정(^) 클래스 → 매칭 제외", async () => {
    const r = await exec({ action: "filter", pattern: "file[^a].ts", inputs: JSON.stringify(["filea.ts", "fileb.ts"]) }) as any;
    expect(r.matched).toContain("fileb.ts");
    expect(r.matched).not.toContain("filea.ts");
  });
});

// ══════════════════════════════════════════
// glob_to_regex 경로: {alternatives}
// ══════════════════════════════════════════

describe("GlobMatchTool — {alternatives} 추가", () => {
  it("{} 닫힘 없음 → 리터럴 { 처리", async () => {
    const r = await exec({ action: "to_regex", pattern: "test{noexit" }) as any;
    expect(r.regex).toBeDefined();
  });
});

// ══════════════════════════════════════════
// glob_to_regex: **/ 경로 prefix
// ══════════════════════════════════════════

describe("GlobMatchTool — **/ path prefix", () => {
  it("**/file.ts → 어떤 디렉토리에서도 매칭", async () => {
    const r = await exec({ action: "filter", pattern: "**/file.ts", inputs: JSON.stringify(["file.ts", "src/file.ts", "a/b/c/file.ts", "other.ts"]) }) as any;
    expect(r.matched).toContain("file.ts");
    expect(r.matched).toContain("src/file.ts");
    expect(r.matched).toContain("a/b/c/file.ts");
    expect(r.matched).not.toContain("other.ts");
  });

  it("** (경로 없음) → 모든 경로 매칭", async () => {
    const r = await exec({ action: "filter", pattern: "src/**", inputs: JSON.stringify(["src/a.ts", "src/b/c.ts", "other/d.ts"]) }) as any;
    expect(r.matched).toContain("src/a.ts");
    expect(r.matched).toContain("src/b/c.ts");
    expect(r.matched).not.toContain("other/d.ts");
  });
});

// ══════════════════════════════════════════
// glob_to_regex: 특수 문자 이스케이프
// ══════════════════════════════════════════

describe("GlobMatchTool — special char escape", () => {
  it("패턴에 . + ^ $ → 리터럴로 처리", async () => {
    const r = await exec({ action: "filter", pattern: "file.ts", inputs: JSON.stringify(["file.ts", "fileXts"]) }) as any;
    expect(r.matched).toContain("file.ts");
    expect(r.matched).not.toContain("fileXts");
  });
});

// ══════════════════════════════════════════
// parse 액션 — class/alternatives 파트
// ══════════════════════════════════════════

describe("GlobMatchTool — parse class/alternatives", () => {
  it("[abc] 파싱 → parts에 class 포함", async () => {
    const r = await exec({ action: "parse", pattern: "file[abc].ts" }) as any;
    expect(Array.isArray(r.parts)).toBe(true);
    expect(r.parts.some((p: any) => p.type === "class")).toBe(true);
  });

  it("{ts,js} 파싱 → parts에 alternatives 포함", async () => {
    const r = await exec({ action: "parse", pattern: "*.{ts,js}" }) as any;
    expect(r.parts.some((p: any) => p.type === "alternatives")).toBe(true);
  });

  it("? 파싱 → parts에 any_char 포함", async () => {
    const r = await exec({ action: "parse", pattern: "file?.ts" }) as any;
    expect(r.parts.some((p: any) => p.type === "any_char")).toBe(true);
  });

  it("리터럴 + { 닫힘없음 → literal로 포함", async () => {
    const r = await exec({ action: "parse", pattern: "test{noexit" }) as any;
    expect(Array.isArray(r.parts)).toBe(true);
    expect(r.parts.some((p: any) => p.type === "literal")).toBe(true);
  });
});

// ══════════════════════════════════════════
// to_regex 액션 — 다양한 패턴
// ══════════════════════════════════════════

describe("GlobMatchTool — to_regex 다양한 패턴", () => {
  it("[abc] → 정규식 반환", async () => {
    const r = await exec({ action: "to_regex", pattern: "file[abc].ts" }) as any;
    expect(r.regex).toBeDefined();
  });

  it("{ts,js} → 정규식 반환", async () => {
    const r = await exec({ action: "to_regex", pattern: "*.{ts,js}" }) as any;
    expect(r.regex).toBeDefined();
    expect(String(r.regex)).toContain("ts");
  });

  it("[\\\\a] 이스케이프 → 정규식 반환", async () => {
    const r = await exec({ action: "to_regex", pattern: "file[\\a-z].ts" }) as any;
    expect(r.regex).toBeDefined();
  });
});
