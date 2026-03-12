/**
 * TomlTool — parse/generate/validate/query/merge 테스트.
 */
import { describe, it, expect } from "vitest";
import { TomlTool } from "../../../src/agent/tools/toml.js";

const tool = new TomlTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const BASIC_TOML = `
[package]
name = "my-app"
version = "1.0.0"

[dependencies]
vitest = "^4.0"
`;

describe("TomlTool — parse", () => {
  it("섹션 + 키/값 파싱", async () => {
    const r = await exec({ action: "parse", input: BASIC_TOML }) as Record<string, unknown>;
    const result = r.result as Record<string, Record<string, string>>;
    expect(result.package.name).toBe("my-app");
    expect(result.package.version).toBe("1.0.0");
  });

  it("전역 키 파싱", async () => {
    const r = await exec({ action: "parse", input: "title = \"Hello\"\ncount = 42" }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.title).toBe("Hello");
    expect(result.count).toBe(42);
  });

  it("빈 입력 → 빈 result", async () => {
    const r = await exec({ action: "parse", input: "" }) as Record<string, unknown>;
    expect(r.result).toEqual({});
  });
});

describe("TomlTool — generate", () => {
  it("JSON → TOML 생성", async () => {
    const r = await exec({ action: "generate", input: JSON.stringify({ name: "test", version: "1.0.0" }) });
    const text = String(r);
    expect(text).toContain("name");
    expect(text).toContain("test");
  });

  it("잘못된 JSON → Error", async () => {
    const r = await exec({ action: "generate", input: "not-json" });
    expect(String(r)).toContain("Error");
  });
});

describe("TomlTool — validate", () => {
  it("유효한 TOML → valid: true", async () => {
    const r = await exec({ action: "validate", input: BASIC_TOML }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("빈 입력도 유효", async () => {
    const r = await exec({ action: "validate", input: "" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });
});

describe("TomlTool — query", () => {
  it("점 경로로 값 조회", async () => {
    const r = await exec({ action: "query", input: BASIC_TOML, path: "package.name" }) as Record<string, unknown>;
    expect(r.found).toBe(true);
    expect(r.value).toBe("my-app");
  });

  it("존재하지 않는 경로 → found: false", async () => {
    const r = await exec({ action: "query", input: BASIC_TOML, path: "package.nonexistent" }) as Record<string, unknown>;
    expect(r.found).toBe(false);
  });

  it("path 없음 → Error", async () => {
    const r = await exec({ action: "query", input: BASIC_TOML });
    expect(String(r)).toContain("Error");
  });
});

describe("TomlTool — merge", () => {
  it("두 TOML 병합 → 두 번째가 오버라이드", async () => {
    const first = "[db]\nhost = \"localhost\"\nport = 5432";
    const second = "[db]\nport = 9999\nssl = true";
    const r = await exec({ action: "merge", input: first, second }) as Record<string, unknown>;
    const result = r.result as Record<string, Record<string, unknown>>;
    expect(result.db.host).toBe("localhost");
    expect(result.db.port).toBe(9999);
  });
});

// ══════════════════════════════════════════
// parse — 추가 타입
// ══════════════════════════════════════════

describe("TomlTool — parse 추가 타입", () => {
  it("주석 라인 무시", async () => {
    const r = await exec({ action: "parse", input: "# this is a comment\nkey = 1" }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.key).toBe(1);
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("boolean 파싱", async () => {
    const r = await exec({ action: "parse", input: "flag = true\ndisabled = false" }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.flag).toBe(true);
    expect(result.disabled).toBe(false);
  });

  it("단일 인용부호 문자열", async () => {
    const r = await exec({ action: "parse", input: "key = 'no escape here'" }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.key).toBe("no escape here");
  });

  it("이중 인용부호 이스케이프 (\\n, \\t, \\\\)", async () => {
    const r = await exec({ action: "parse", input: 'key = "line1\\nline2\\ttab\\\\backslash"' }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.key).toBe("line1\nline2\ttab\\backslash");
  });

  it("날짜 형식 → 문자열로 보존", async () => {
    const r = await exec({ action: "parse", input: "date = 2024-01-15" }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.date).toBe("2024-01-15");
  });

  it("인라인 배열 파싱", async () => {
    const r = await exec({ action: "parse", input: "nums = [1, 2, 3]" }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(Array.isArray(result.nums)).toBe(true);
    expect((result.nums as number[])[1]).toBe(2);
  });

  it("배열 테이블 ([[section]])", async () => {
    const input = "[[products]]\nname = \"apple\"\n\n[[products]]\nname = \"banana\"";
    const r = await exec({ action: "parse", input }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(Array.isArray(result.products)).toBe(true);
    expect((result.products as { name: string }[]).length).toBe(2);
    expect((result.products as { name: string }[])[0]!.name).toBe("apple");
    expect((result.products as { name: string }[])[1]!.name).toBe("banana");
  });

  it("중첩 테이블 경로", async () => {
    const input = "[a.b.c]\nkey = \"deep\"";
    const r = await exec({ action: "parse", input }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    const a = result.a as Record<string, unknown>;
    const b = a.b as Record<string, unknown>;
    const c = b.c as Record<string, unknown>;
    expect(c.key).toBe("deep");
  });

  it("'=' 없는 라인은 스킵", async () => {
    const r = await exec({ action: "parse", input: "no_equals_sign\nkey = 1" }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.key).toBe(1);
    expect("no_equals_sign" in result).toBe(false);
  });
});

// ══════════════════════════════════════════
// generate — 타입별 직렬화
// ══════════════════════════════════════════

describe("TomlTool — generate 타입별", () => {
  it("boolean 직렬화", async () => {
    const r = String(await exec({ action: "generate", input: JSON.stringify({ enabled: true }) }));
    expect(r).toContain("enabled = true");
  });

  it("number 직렬화", async () => {
    const r = String(await exec({ action: "generate", input: JSON.stringify({ count: 42 }) }));
    expect(r).toContain("count = 42");
  });

  it("배열 직렬화", async () => {
    const r = String(await exec({ action: "generate", input: JSON.stringify({ tags: ["a", "b"] }) }));
    expect(r).toContain("tags");
  });

  it("중첩 객체 → 섹션 헤더", async () => {
    const r = String(await exec({ action: "generate", input: JSON.stringify({ db: { host: "localhost", port: 5432 } }) }));
    expect(r).toContain("[db]");
    expect(r).toContain("host");
  });

  it("문자열에 이스케이프 필요한 문자", async () => {
    const r = String(await exec({ action: "generate", input: JSON.stringify({ msg: 'say "hi"' }) }));
    expect(r).toContain('\\"hi\\"');
  });
});

// ══════════════════════════════════════════
// query — 추가
// ══════════════════════════════════════════

describe("TomlTool — query 추가", () => {
  it("중간 경로가 null → found: false", async () => {
    const input = "key = 1";
    const r = await exec({ action: "query", input, path: "key.sub" }) as Record<string, unknown>;
    expect(r.found).toBe(false);
  });

  it("최상위 키 직접 조회", async () => {
    const r = await exec({ action: "query", input: "count = 99", path: "count" }) as Record<string, unknown>;
    expect(r.found).toBe(true);
    expect(r.value).toBe(99);
  });
});

// ══════════════════════════════════════════
// merge — 추가 케이스
// ══════════════════════════════════════════

describe("TomlTool — merge 추가", () => {
  it("a에 없는 키 → b에서 추가", async () => {
    const a = "x = 1";
    const b = "y = 2";
    const r = await exec({ action: "merge", input: a, second: b }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
  });

  it("배열은 병합 안 하고 오버라이드", async () => {
    const a = "tags = [\"old\"]";
    const b = "tags = [\"new1\", \"new2\"]";
    const r = await exec({ action: "merge", input: a, second: b }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    const tags = result.tags as string[];
    expect(tags).toEqual(["new1", "new2"]);
  });

  it("second 없음 → 빈 TOML로 처리", async () => {
    const r = await exec({ action: "merge", input: "key = 1", second: "" }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.key).toBe(1);
  });
});

// ══════════════════════════════════════════
// unsupported action
// ══════════════════════════════════════════

describe("TomlTool — unsupported action", () => {
  it("bogus → Error", async () => {
    const r = await tool.execute({ action: "bogus" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});

// ══════════════════════════════════════════
// parse_toml throws → catch 분기
// ══════════════════════════════════════════

function make_throwing_tool() {
  const t = new TomlTool();
  (t as any).parse_toml = () => { throw new Error("forced parse error"); };
  return t;
}

async function run_throwing(t: TomlTool, params: Record<string, unknown>): Promise<unknown> {
  const raw = await (t as any).run(params);
  try { return JSON.parse(raw); } catch { return raw; }
}

describe("TomlTool — parse catch", () => {
  it("parse_toml throws → catch → { error } 반환", async () => {
    const t = make_throwing_tool();
    const result = await run_throwing(t, { action: "parse", input: "anything" }) as any;
    expect(result.error).toBeDefined();
    expect(result.error).toContain("forced parse error");
  });
});

describe("TomlTool — validate catch", () => {
  it("parse_toml throws → catch → { valid: false, error } 반환", async () => {
    const t = make_throwing_tool();
    const result = await run_throwing(t, { action: "validate", input: "anything" }) as any;
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});

describe("TomlTool — query catch", () => {
  it("parse_toml throws → catch → { error } 반환", async () => {
    const t = make_throwing_tool();
    const result = await run_throwing(t, { action: "query", input: "anything", path: "key" }) as any;
    expect(result.error).toBeDefined();
  });
});

describe("TomlTool — merge catch", () => {
  it("parse_toml throws → catch → { error } 반환", async () => {
    const t = make_throwing_tool();
    const result = await run_throwing(t, { action: "merge", input: "key = 1", second: "other = 2" }) as any;
    expect(result.error).toBeDefined();
  });
});
