/**
 * GlobMatchTool — 미커버 경로 보충.
 * char class negation/escape, brace alternatives, globstar slash, single char wildcard,
 * parse 액션 (class/alternatives 파트), to_regex negation bracket.
 */
import { describe, it, expect } from "vitest";
import { GlobMatchTool } from "../../../src/agent/tools/glob-match.js";

const tool = new GlobMatchTool();
async function exec(params: Record<string, unknown>): Promise<unknown> {
  const r = await tool.execute(params, {} as any);
  try { return JSON.parse(r); } catch { return r; }
}

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

describe("GlobMatchTool — {alternatives}", () => {
  it("{ts,js} → 여러 확장자 매칭", async () => {
    const r = await exec({ action: "filter", pattern: "src/*.{ts,js}", inputs: JSON.stringify(["src/app.ts", "src/app.js", "src/app.py"]) }) as any;
    expect(r.matched).toContain("src/app.ts");
    expect(r.matched).toContain("src/app.js");
    expect(r.matched).not.toContain("src/app.py");
  });

  it("{} 닫힘 없음 → 리터럴 { 처리", async () => {
    // { 없이 닫힘 없을 때 리터럴로 처리됨
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
// glob_to_regex: ? 단일 문자
// ══════════════════════════════════════════

describe("GlobMatchTool — ? single char", () => {
  it("file?.ts → 한 글자 와일드카드 매칭", async () => {
    const r = await exec({ action: "filter", pattern: "file?.ts", inputs: JSON.stringify(["filea.ts", "fileab.ts", "file.ts"]) }) as any;
    expect(r.matched).toContain("filea.ts");
    expect(r.matched).not.toContain("fileab.ts");
    expect(r.matched).not.toContain("file.ts");
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
    // { 닫힘 없으면 literal로 처리됨
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
