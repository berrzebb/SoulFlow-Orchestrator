/**
 * TextTool — 텍스트 변환 operations 테스트.
 */
import { describe, it, expect } from "vitest";
import { TextTool } from "../../../src/agent/tools/text.js";

const tool = new TextTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("TextTool — case", () => {
  it("upper: 대문자 변환", async () => {
    expect(await exec({ operation: "upper", input: "hello world" })).toBe("HELLO WORLD");
  });

  it("lower: 소문자 변환", async () => {
    expect(await exec({ operation: "lower", input: "HELLO WORLD" })).toBe("hello world");
  });

  it("title: 단어 첫 글자 대문자", async () => {
    expect(await exec({ operation: "title", input: "hello world" })).toBe("Hello World");
  });

  it("camel: camelCase 변환", async () => {
    expect(await exec({ operation: "camel", input: "hello_world" })).toBe("helloWorld");
  });

  it("snake: snake_case 변환", async () => {
    expect(await exec({ operation: "snake", input: "helloWorld" })).toBe("hello_world");
  });

  it("kebab: kebab-case 변환", async () => {
    expect(await exec({ operation: "kebab", input: "hello world" })).toBe("hello-world");
  });

  it("slugify: slug 생성", async () => {
    const r = String(await exec({ operation: "slugify", input: "Hello World! 123" }));
    expect(r).toBe("hello-world-123");
  });

  it("reverse: 문자열 역순", async () => {
    expect(await exec({ operation: "reverse", input: "abcde" })).toBe("edcba");
  });
});

describe("TextTool — truncate", () => {
  it("길이 초과 시 ...로 잘라냄", async () => {
    const r = String(await exec({ operation: "truncate", input: "Hello World", max_length: 8 }));
    expect(r).toBe("Hello...");
  });

  it("길이 이내 → 그대로 반환", async () => {
    expect(await exec({ operation: "truncate", input: "short", max_length: 100 })).toBe("short");
  });
});

describe("TextTool — pad", () => {
  it("right pad (기본값)", async () => {
    const r = String(await exec({ operation: "pad", input: "hi", pad_length: 5 }));
    expect(r).toBe("hi   ");
  });

  it("left pad", async () => {
    const r = String(await exec({ operation: "pad", input: "hi", pad_length: 5, pad_side: "left", pad_char: "0" }));
    expect(r).toBe("000hi");
  });

  it("both pad", async () => {
    const r = String(await exec({ operation: "pad", input: "hi", pad_length: 6, pad_side: "both" }));
    expect(r.length).toBe(6);
    expect(r).toContain("hi");
  });
});

describe("TextTool — count", () => {
  it("기본 통계 반환", async () => {
    const r = await exec({ operation: "count", input: "Hello World\nGoodbye" }) as Record<string, number>;
    expect(r.chars).toBeGreaterThan(0);
    expect(r.words).toBe(3);
    expect(r.lines).toBe(2);
  });

  it("빈 입력 → words:0", async () => {
    const r = await exec({ operation: "count", input: "" }) as Record<string, number>;
    expect(r.words).toBe(0);
  });
});

describe("TextTool — dedup", () => {
  it("중복 줄 제거", async () => {
    const r = String(await exec({ operation: "dedup", input: "a\nb\na\nc\nb" }));
    expect(r).toBe("a\nb\nc");
  });
});

describe("TextTool — similarity", () => {
  it("동일 문자열 → 100%", async () => {
    const r = await exec({ operation: "similarity", input: "hello", input2: "hello" }) as Record<string, unknown>;
    expect(r.levenshtein_distance).toBe(0);
    expect(String(r.similarity)).toBe("100%");
  });

  it("다른 문자열 → 거리 > 0", async () => {
    const r = await exec({ operation: "similarity", input: "hello", input2: "world" }) as Record<string, unknown>;
    expect(r.levenshtein_distance).toBeGreaterThan(0);
  });

  it("input2 없음 → Error", async () => {
    expect(String(await exec({ operation: "similarity", input: "a" }))).toContain("Error");
  });
});

describe("TextTool — join", () => {
  it("줄을 구분자로 합침", async () => {
    const r = String(await exec({ operation: "join", input: "a\nb\nc", separator: ", " }));
    expect(r).toBe("a, b, c");
  });

  it("기본 구분자는 줄바꿈", async () => {
    const r = String(await exec({ operation: "join", input: "a\nb\nc" }));
    expect(r).toContain("a");
  });
});

describe("TextTool — wrap", () => {
  it("긴 줄 줄바꿈", async () => {
    const long = "This is a very long line that should be wrapped at some point because it exceeds the width";
    const r = String(await exec({ operation: "wrap", input: long, width: 30 }));
    const lines = r.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });
});

describe("TextTool — trim_lines", () => {
  it("각 줄 앞뒤 공백 제거 + 빈 줄 제거", async () => {
    const r = String(await exec({ operation: "trim_lines", input: "  hello  \n  world  \n   " }));
    expect(r).toBe("hello\nworld");
  });
});

describe("TextTool — 에러 처리", () => {
  it("지원하지 않는 operation → Error", async () => {
    expect(String(await exec({ operation: "invalid", input: "x" }))).toContain("Error");
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("TextTool — 미커버 분기", () => {
  it("levenshtein: 5000자 초과 → L135 math.abs 빠른 경로", async () => {
    // a.length > 5000 → L135 return Math.abs(a.length - b.length)
    const long_a = "a".repeat(5001);
    const short_b = "b".repeat(3);
    const r = await exec({ operation: "similarity", input: long_a, input2: short_b }) as Record<string, unknown>;
    expect(r.levenshtein_distance).toBe(Math.abs(5001 - 3));
  });

  it("wrap: 짧은 줄 + 긴 줄 혼합 → L152 short line pass-through", async () => {
    // "Short\n" + 긴 줄 → "Short"은 width보다 짧아 L152 return line
    const input = "Short\n" + "word ".repeat(20);
    const r = String(await exec({ operation: "wrap", input, width: 30 }));
    expect(r).toContain("Short");
  });
});

describe("TextTool — MAX_INPUT 초과 → L37 Error", () => {
  it("512KB 초과 입력 → L37 Error: input exceeds", async () => {
    const big = "x".repeat(1024 * 512 + 1);
    const r = String(await exec({ operation: "upper", input: big }));
    expect(r).toContain("Error");
    expect(r).toContain("exceeds");
  });
});
