/**
 * RegexTool — match/match_all/replace/extract/split/test 테스트.
 */
import { describe, it, expect } from "vitest";
import { RegexTool } from "../../../src/agent/tools/regex.js";

const tool = new RegexTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("RegexTool — test", () => {
  it("매칭 성공 → matches: true", async () => {
    const r = await exec({ operation: "test", input: "hello world", pattern: "world" }) as Record<string, unknown>;
    expect(r.matches).toBe(true);
  });

  it("매칭 실패 → matches: false", async () => {
    const r = await exec({ operation: "test", input: "hello", pattern: "xyz" }) as Record<string, unknown>;
    expect(r.matches).toBe(false);
  });

  it("대소문자 무시 플래그", async () => {
    const r = await exec({ operation: "test", input: "Hello", pattern: "hello", flags: "i" }) as Record<string, unknown>;
    expect(r.matches).toBe(true);
  });
});

describe("RegexTool — match", () => {
  it("첫 번째 매칭 반환", async () => {
    const r = await exec({ operation: "match", input: "foo bar foo", pattern: "foo" }) as Record<string, unknown>;
    expect(r.found).toBe(true);
    expect(r.match).toBe("foo");
    expect(r.index).toBe(0);
  });

  it("매칭 없음 → found: false", async () => {
    const r = await exec({ operation: "match", input: "hello", pattern: "xyz" }) as Record<string, unknown>;
    expect(r.found).toBe(false);
  });

  it("캡처 그룹 반환", async () => {
    const r = await exec({ operation: "match", input: "2024-01-15", pattern: "(\\d{4})-(\\d{2})-(\\d{2})" }) as Record<string, unknown>;
    expect(r.found).toBe(true);
    expect((r.captures as string[])[0]).toBe("2024");
    expect((r.captures as string[])[1]).toBe("01");
  });

  it("네임드 그룹 반환", async () => {
    const r = await exec({ operation: "match", input: "2024-01-15", pattern: "(?<year>\\d{4})-(?<month>\\d{2})" }) as Record<string, unknown>;
    expect(r.found).toBe(true);
    expect((r.groups as Record<string, string>).year).toBe("2024");
    expect((r.groups as Record<string, string>).month).toBe("01");
  });
});

describe("RegexTool — match_all", () => {
  it("전체 매칭 목록 반환", async () => {
    const r = await exec({ operation: "match_all", input: "foo bar foo baz foo", pattern: "foo" }) as Record<string, unknown>;
    expect(r.count).toBe(3);
    expect((r.matches as unknown[]).length).toBe(3);
  });

  it("max_results 제한 적용", async () => {
    const r = await exec({ operation: "match_all", input: "aaa", pattern: "a", max_results: 2 }) as Record<string, unknown>;
    expect(r.count).toBe(2);
  });

  it("매칭 없음 → count: 0", async () => {
    const r = await exec({ operation: "match_all", input: "hello", pattern: "xyz" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });
});

describe("RegexTool — replace", () => {
  it("첫 번째 치환", async () => {
    const r = await exec({ operation: "replace", input: "foo bar foo", pattern: "foo", replacement: "baz" });
    expect(String(r)).toBe("baz bar foo");
  });

  it("전체 치환 (g 플래그)", async () => {
    const r = await exec({ operation: "replace", input: "foo bar foo", pattern: "foo", flags: "g", replacement: "baz" });
    expect(String(r)).toBe("baz bar baz");
  });

  it("캡처 그룹 참조 치환", async () => {
    const r = await exec({ operation: "replace", input: "John Smith", pattern: "(\\w+) (\\w+)", replacement: "$2, $1" });
    expect(String(r)).toBe("Smith, John");
  });
});

describe("RegexTool — extract", () => {
  it("네임드 그룹 추출", async () => {
    const r = await exec({ operation: "extract", input: "2024-01-15\n2024-02-20", pattern: "(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})", flags: "g" }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    expect(((r.extracted as Record<string, string>[])[0] as Record<string, string>).year).toBe("2024");
  });

  it("캡처 그룹 추출 (네임드 없음)", async () => {
    const r = await exec({ operation: "extract", input: "a=1\nb=2", pattern: "(\\w+)=(\\d+)", flags: "g" }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    const first = (r.extracted as Record<string, string>[])[0];
    expect(first?.group_1).toBe("a");
    expect(first?.group_2).toBe("1");
  });
});

describe("RegexTool — split", () => {
  it("구분자로 분할", async () => {
    const r = await exec({ operation: "split", input: "a,b,c", pattern: "," });
    expect(Array.isArray(r)).toBe(true);
    expect((r as string[]).length).toBe(3);
    expect((r as string[])[0]).toBe("a");
  });

  it("공백으로 분할", async () => {
    const r = await exec({ operation: "split", input: "hello world foo", pattern: "\\s+" });
    expect((r as string[]).length).toBe(3);
  });
});

describe("RegexTool — 에러 케이스", () => {
  it("빈 pattern → Error", async () => {
    const r = await exec({ operation: "test", input: "hello", pattern: "" });
    expect(String(r)).toContain("Error");
  });

  it("잘못된 정규식 → Error", async () => {
    const r = await exec({ operation: "test", input: "hello", pattern: "[invalid" });
    expect(String(r)).toContain("Error");
  });
});

// L56: unknown operation (default branch)
describe("RegexTool — unknown operation (L56)", () => {
  it("알 수 없는 operation → Error 반환 (L56)", async () => {
    const r = await exec({ operation: "unknown_op", input: "hello", pattern: "h" });
    expect(String(r)).toContain("unsupported operation");
  });
});
