/**
 * SlugTool — slugify/filename_safe/camel_to_snake/snake_to_camel/truncate/transliterate 테스트.
 */
import { describe, it, expect } from "vitest";
import { SlugTool } from "../../../src/agent/tools/slug.js";

const tool = new SlugTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("SlugTool — slugify", () => {
  it("기본 슬러그 생성", async () => {
    const r = await exec({ action: "slugify", input: "Hello World" }) as Record<string, unknown>;
    expect(r.slug).toBe("hello-world");
  });

  it("특수문자 제거", async () => {
    const r = await exec({ action: "slugify", input: "Hello, World! 2024" }) as Record<string, unknown>;
    expect(String(r.slug)).not.toMatch(/[,!]/);
    expect(String(r.slug)).toContain("hello");
  });

  it("커스텀 구분자", async () => {
    const r = await exec({ action: "slugify", input: "Hello World", separator: "_" }) as Record<string, unknown>;
    expect(r.slug).toBe("hello_world");
  });

  it("lowercase: false → 대문자 유지", async () => {
    const r = await exec({ action: "slugify", input: "Hello World", lowercase: false }) as Record<string, unknown>;
    expect(String(r.slug)).toContain("H");
  });

  it("중복 구분자 병합", async () => {
    const r = await exec({ action: "slugify", input: "Hello   World" }) as Record<string, unknown>;
    expect(r.slug).toBe("hello-world");
  });

  it("악센트 문자 변환 (transliterate)", async () => {
    const r = await exec({ action: "slugify", input: "café" }) as Record<string, unknown>;
    expect(r.slug).toBe("cafe");
  });
});

describe("SlugTool — filename_safe", () => {
  it("파일명 위험 문자 제거", async () => {
    const r = await exec({ action: "filename_safe", input: 'my/file:name*.txt' }) as Record<string, unknown>;
    expect(String(r.filename)).not.toMatch(/[/:*]/);
  });

  it("max_length 적용", async () => {
    const r = await exec({ action: "filename_safe", input: "a".repeat(300), max_length: 50 }) as Record<string, unknown>;
    expect(String(r.filename).length).toBeLessThanOrEqual(50);
  });

  it("기본 소문자 변환", async () => {
    const r = await exec({ action: "filename_safe", input: "MyFile" }) as Record<string, unknown>;
    expect(r.filename).toBe("myfile");
  });
});

describe("SlugTool — camel_to_snake", () => {
  it("camelCase → snake_case", async () => {
    const r = await exec({ action: "camel_to_snake", input: "camelCaseString" }) as Record<string, unknown>;
    expect(r.result).toBe("camel_case_string");
  });

  it("연속 대문자 처리 (HTMLParser → html_parser)", async () => {
    const r = await exec({ action: "camel_to_snake", input: "HTMLParser" }) as Record<string, unknown>;
    expect(String(r.result)).toContain("_");
  });

  it("이미 snake_case → 변화 없음", async () => {
    const r = await exec({ action: "camel_to_snake", input: "already_snake" }) as Record<string, unknown>;
    expect(r.result).toBe("already_snake");
  });
});

describe("SlugTool — snake_to_camel", () => {
  it("snake_case → camelCase", async () => {
    const r = await exec({ action: "snake_to_camel", input: "snake_case_string" }) as Record<string, unknown>;
    expect(r.result).toBe("snakeCaseString");
  });

  it("단일 단어 → 변화 없음", async () => {
    const r = await exec({ action: "snake_to_camel", input: "hello" }) as Record<string, unknown>;
    expect(r.result).toBe("hello");
  });
});

describe("SlugTool — truncate", () => {
  it("짧은 문자열 → truncated: false", async () => {
    const r = await exec({ action: "truncate", input: "short", max_length: 80 }) as Record<string, unknown>;
    expect(r.truncated).toBe(false);
    expect(r.result).toBe("short");
  });

  it("긴 문자열 → 자르고 ... 추가", async () => {
    const r = await exec({ action: "truncate", input: "a".repeat(100), max_length: 20 }) as Record<string, unknown>;
    expect(r.truncated).toBe(true);
    expect(String(r.result).length).toBeLessThanOrEqual(20);
    expect(String(r.result)).toContain("...");
  });

  it("original_length 기록", async () => {
    const r = await exec({ action: "truncate", input: "a".repeat(100), max_length: 20 }) as Record<string, unknown>;
    expect(r.original_length).toBe(100);
  });
});

describe("SlugTool — transliterate", () => {
  it("악센트 문자 변환", async () => {
    const r = await exec({ action: "transliterate", input: "café résumé" }) as Record<string, unknown>;
    expect(String(r.result)).toContain("cafe");
    expect(String(r.result)).toContain("resume");
  });

  it("ASCII 문자는 그대로", async () => {
    const r = await exec({ action: "transliterate", input: "hello" }) as Record<string, unknown>;
    expect(r.result).toBe("hello");
  });
});

describe("SlugTool — 에러 케이스", () => {
  it("지원되지 않는 action → Error", async () => {
    const r = await exec({ action: "unknown", input: "test" });
    expect(String(r)).toContain("Error");
  });
});
