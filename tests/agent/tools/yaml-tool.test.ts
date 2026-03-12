/**
 * YamlTool — YAML 파싱/생성/머지/검증/쿼리 테스트.
 */
import { describe, it, expect } from "vitest";
import { YamlTool } from "../../../src/agent/tools/yaml.js";

const tool = new YamlTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const BASIC_YAML = `name: Alice
age: 30
active: true
score: 9.5
tags:
  - typescript
  - vitest`;

describe("YamlTool — parse", () => {
  it("기본 YAML → JSON 변환", async () => {
    const r = await exec({ action: "parse", data: BASIC_YAML }) as Record<string, unknown>;
    expect(r.name).toBe("Alice");
    expect(r.age).toBe(30);
    expect(r.active).toBe(true);
    expect(r.score).toBe(9.5);
  });

  it("null 값 파싱", async () => {
    const r = await exec({ action: "parse", data: "value: null" }) as Record<string, unknown>;
    expect(r.value).toBeNull();
  });

  it("tilde null 파싱", async () => {
    const r = await exec({ action: "parse", data: "value: ~" }) as Record<string, unknown>;
    expect(r.value).toBeNull();
  });

  it("주석 무시", async () => {
    const yaml = "# comment\nname: Bob\n# another comment\nage: 25";
    const r = await exec({ action: "parse", data: yaml }) as Record<string, unknown>;
    expect(r.name).toBe("Bob");
    expect(r.age).toBe(25);
  });
});

describe("YamlTool — generate", () => {
  it("JSON → YAML 생성", async () => {
    const json = JSON.stringify({ name: "Alice", age: 30, active: true });
    const r = String(await exec({ action: "generate", data: json }));
    expect(r).toContain("name:");
    expect(r).toContain("Alice");
    expect(r).toContain("age:");
    expect(r).toContain("30");
  });

  it("빈 객체 → {} 출력", async () => {
    const r = String(await tool.execute({ action: "generate", data: "{}" }));
    expect(r).toContain("{}");
  });

  it("빈 배열 → [] 출력", async () => {
    const r = String(await tool.execute({ action: "generate", data: "[]" }));
    expect(r).toContain("[]");
  });

  it("잘못된 JSON → Error", async () => {
    expect(String(await exec({ action: "generate", data: "not-json" }))).toContain("Error");
  });
});

describe("YamlTool — validate", () => {
  it("유효한 YAML → valid: true", async () => {
    const r = await exec({ action: "validate", data: BASIC_YAML }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });
});

describe("YamlTool — query", () => {
  it("단순 키 쿼리", async () => {
    const r = await exec({ action: "query", data: BASIC_YAML, path: "name" }) as Record<string, unknown>;
    expect(r.result).toBe("Alice");
  });

  it("path 없음 → Error", async () => {
    expect(String(await exec({ action: "query", data: BASIC_YAML, path: "" }))).toContain("Error");
  });

  it("없는 키 → result: undefined/null", async () => {
    const r = await exec({ action: "query", data: BASIC_YAML, path: "nonexistent" }) as Record<string, unknown>;
    expect(r.result === null || r.result === undefined).toBe(true);
  });
});

describe("YamlTool — merge", () => {
  it("두 YAML 객체 병합", async () => {
    const yaml1 = "name: Alice\nage: 30";
    const yaml2 = "city: Seoul\nage: 31";
    const r = String(await exec({ action: "merge", data: yaml1, data2: yaml2 }));
    expect(r).toContain("name:");
    expect(r).toContain("city:");
    expect(r).toContain("31"); // age overridden
  });
});

// ══════════════════════════════════════════
// merge — 비객체 입력 거부
// ══════════════════════════════════════════

describe("YamlTool — merge: 비객체 입력", () => {
  it("data가 배열이면 → 오류 메시지", async () => {
    const r = String(await tool.execute({ action: "merge", data: "- a\n- b", data2: "key: val" }));
    expect(r).toContain("Error");
    expect(r).toContain("objects");
  });

  it("data2가 배열이면 → 오류 메시지", async () => {
    const r = String(await tool.execute({ action: "merge", data: "key: val", data2: "- a\n- b" }));
    expect(r).toContain("Error");
    expect(r).toContain("objects");
  });

  it("중첩 객체 deep merge", async () => {
    const yaml1 = "a:\n  x: 1\n  y: 2";
    const yaml2 = "a:\n  y: 99\n  z: 3";
    const r = String(await exec({ action: "merge", data: yaml1, data2: yaml2 }));
    expect(r).toContain("x:");
    expect(r).toContain("z:");
  });
});

// ══════════════════════════════════════════
// query — 중간 경로 비객체
// ══════════════════════════════════════════

describe("YamlTool — query: 중간 경로 실패", () => {
  it("중간 경로가 문자열이면 → result: null", async () => {
    const yaml = "name: Alice";
    const r = await exec({ action: "query", data: yaml, path: "name.sub" }) as any;
    expect(r.result).toBeNull();
    expect(r.path).toBe("name.sub");
  });

  it("중간 경로가 숫자이면 → result: null", async () => {
    const yaml = "count: 42";
    const r = await exec({ action: "query", data: yaml, path: "count.sub" }) as any;
    expect(r.result).toBeNull();
  });
});

// ══════════════════════════════════════════
// generate (to_yaml) — 특수 케이스
// ══════════════════════════════════════════

describe("YamlTool — generate: to_yaml 특수 케이스", () => {
  it("멀티라인 문자열 → | 블록 스타일", async () => {
    const json = JSON.stringify({ text: "line1\nline2\nline3" });
    const r = String(await tool.execute({ action: "generate", data: json }));
    expect(r).toContain("|");
    expect(r).toContain("line1");
  });

  it("특수문자 포함 문자열 → 따옴표 처리", async () => {
    const json = JSON.stringify({ val: "has: colon" });
    const r = String(await tool.execute({ action: "generate", data: json }));
    expect(r).toContain("val:");
    expect(r).toContain("colon");
  });

  it("빈 문자열 → 따옴표 처리", async () => {
    const json = JSON.stringify({ empty: "" });
    const r = String(await tool.execute({ action: "generate", data: json }));
    expect(r).toContain('""');
  });

  it("null 값 → null 출력", async () => {
    const json = JSON.stringify({ val: null });
    const r = String(await tool.execute({ action: "generate", data: json }));
    expect(r).toContain("null");
  });

  it("배열 안에 객체 → - key: val 형식", async () => {
    const json = JSON.stringify({ items: [{ name: "Alice" }, { name: "Bob" }] });
    const r = String(await tool.execute({ action: "generate", data: json }));
    expect(r).toContain("- ");
    expect(r).toContain("name:");
  });

  it("indent 파라미터 → 들여쓰기 변경", async () => {
    const json = JSON.stringify({ a: { b: 1 } });
    const r4 = String(await tool.execute({ action: "generate", data: json, indent: 4 }));
    expect(r4).toContain("    b:");
  });

  it("{ 포함 문자열 → 따옴표 처리", async () => {
    const r = await tool.execute({
      action: "generate",
      data: JSON.stringify({ key: "{not an object}" }),
    });
    expect(r).toContain('"');
  });

  it("& 포함 문자열 → 따옴표 처리", async () => {
    const r = await tool.execute({
      action: "generate",
      data: JSON.stringify({ key: "a & b" }),
    });
    expect(r).toContain('"');
  });

  it("배열 안에 숫자 → - N 형식", async () => {
    const r = await tool.execute({
      action: "generate",
      data: JSON.stringify([1, 2, 3]),
    });
    expect(r).toContain("- 1");
    expect(r).toContain("- 2");
    expect(r).toContain("- 3");
  });
});

// ══════════════════════════════════════════
// parse — parse_scalar 인라인 컨테이너
// ══════════════════════════════════════════

describe("YamlTool — parse: parse_scalar 인라인 컨테이너", () => {
  it("인라인 배열 [a,b] → 배열로 파싱", async () => {
    const r = await exec({ action: "parse", data: 'tags: ["ts","js"]' }) as any;
    expect(Array.isArray(r.tags)).toBe(true);
  });

  it("인라인 객체 {a:1} → 객체로 파싱", async () => {
    const r = await exec({ action: "parse", data: 'meta: {"version": 1}' }) as any;
    expect(r.meta).toMatchObject({ version: 1 });
  });

  it("True/FALSE boolean 파싱", async () => {
    const r = await exec({ action: "parse", data: "a: True\nb: FALSE" }) as any;
    expect(r.a).toBe(true);
    expect(r.b).toBe(false);
  });

  it("단따옴표/쌍따옴표 문자열 파싱", async () => {
    const r = await exec({ action: "parse", data: "x: 'hello'\ny: \"world\"" }) as any;
    expect(r.x).toBe("hello");
    expect(r.y).toBe("world");
  });
});

// ══════════════════════════════════════════
// parse — parse_sequence 매핑 아이템
// ══════════════════════════════════════════

describe("YamlTool — parse: parse_sequence 매핑 아이템", () => {
  it("- key: val 형식 시퀀스 → 객체 배열", async () => {
    const yaml = "people:\n  - name: Alice\n    age: 30\n  - name: Bob\n    age: 25";
    const r = await exec({ action: "parse", data: yaml }) as any;
    expect(Array.isArray(r.people)).toBe(true);
    expect(r.people[0].name).toBe("Alice");
  });
});

// ══════════════════════════════════════════
// parse — parse_mapping 키 끝 :
// ══════════════════════════════════════════

describe("YamlTool — parse: parse_mapping 키 끝 :", () => {
  it("key:\\n  nested: val → 중첩 파싱", async () => {
    const yaml = "config:\n  host: localhost\n  port: 3000";
    const r = await exec({ action: "parse", data: yaml }) as any;
    expect(r.config).toMatchObject({ host: "localhost", port: 3000 });
  });

  it("YAML --- 구분자 무시", async () => {
    const yaml = "---\nname: Alice\n...";
    const r = await exec({ action: "parse", data: yaml }) as any;
    expect(r.name).toBe("Alice");
  });
});

// ══════════════════════════════════════════
// default action
// ══════════════════════════════════════════

describe("YamlTool — default action", () => {
  it("지원하지 않는 action → Error 문자열", async () => {
    const r = String(await tool.execute({ action: "unknown_action", data: "test" }));
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});

// ══════════════════════════════════════════
// validate — 결과 확인
// ══════════════════════════════════════════

describe("YamlTool — validate: 결과 확인", () => {
  it("유효한 YAML → valid: true 반환", async () => {
    const r = await exec({ action: "validate", data: "key: value" }) as any;
    expect(r.valid).toBe(true);
  });

  it("... 구분자 포함 → 필터링 후 파싱", async () => {
    const yaml = "---\nkey: value\n...";
    const r = await exec({ action: "validate", data: yaml }) as any;
    expect(r.valid).toBe(true);
  });
});

// ══════════════════════════════════════════
// validate_yaml / query_yaml / parse_yaml / merge_yaml catch
// ══════════════════════════════════════════

describe("YamlTool — validate_yaml 예외 처리", () => {
  it("yaml_parse 예외 → { valid: false, error } 반환", async () => {
    const t = new YamlTool();
    (t as any).yaml_parse = () => { throw new Error("invalid yaml structure"); };
    const r = (t as any).validate_yaml("any input");
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("invalid yaml structure");
  });
});

describe("YamlTool — query_yaml 예외 처리", () => {
  it("yaml_parse 예외 → Error 문자열 반환", async () => {
    const t = new YamlTool();
    (t as any).yaml_parse = () => { throw new Error("parse failure"); };
    const r = (t as any).query_yaml("any input", "some.path");
    expect(r).toContain("Error: parse failure");
  });
});

describe("YamlTool — parse_yaml catch", () => {
  it("yaml_parse 예외 → Error 문자열", () => {
    const t = new YamlTool();
    (t as any).yaml_parse = () => { throw new Error("parse error in yaml"); };
    const r = (t as any).parse_yaml("any yaml");
    expect(r).toContain("Error: parse error in yaml");
  });
});

describe("YamlTool — merge_yaml catch", () => {
  it("yaml_parse 예외 → Error 문자열", () => {
    const t = new YamlTool();
    (t as any).yaml_parse = () => { throw new Error("merge parse error"); };
    const r = (t as any).merge_yaml("yaml1", "yaml2");
    expect(r).toContain("Error: merge parse error");
  });
});

// ══════════════════════════════════════════
// parse_mapping 빈 val_str → 네스팅
// ══════════════════════════════════════════

describe("YamlTool — parse_mapping 빈 val_str → 네스팅", () => {
  it("'key: \\n  child: value' → 네스팅 객체", async () => {
    const yaml = "parent: \n  child: nested_value";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.parent).toBeDefined();
    expect(parsed.parent.child).toBe("nested_value");
  });

  it("다중 빈 val_str 키 → 각각 네스팅", async () => {
    const yaml = "a: \n  x: 1\nb: \n  y: 2";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.a?.x).toBe(1);
    expect(parsed.b?.y).toBe(2);
  });
});

// ══════════════════════════════════════════
// parse_sequence break
// ══════════════════════════════════════════

describe("YamlTool — parse_sequence break", () => {
  it("시퀀스 후 비시퀀스 라인 → break, 시퀀스 항목만 반환", async () => {
    const yaml = "- item1\n- item2\nkey: value";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain("item1");
    expect(parsed).toContain("item2");
  });
});

// ══════════════════════════════════════════
// to_yaml 비표준 타입 fallback
// ══════════════════════════════════════════

describe("YamlTool — to_yaml 비표준 타입 fallback", () => {
  it("BigInt → String(val) 반환", () => {
    const r = (tool as any).to_yaml(BigInt(42), 0, 2);
    expect(r).toContain("42");
  });
});

// ══════════════════════════════════════════
// parse_mapping 빈 줄 처리
// ══════════════════════════════════════════

describe("YamlTool — parse_mapping 빈 줄 처리", () => {
  it("최상위 매핑 내 빈 줄 → skip", async () => {
    const yaml = "a: 1\n\nb: 2";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe(2);
  });

  it("중첩 매핑 내 빈 줄 → break", async () => {
    const yaml = "parent:\n  first: val\n\n  second: other";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.parent?.first).toBe("val");
  });
});

// ══════════════════════════════════════════
// parse_sequence 빈 줄 처리
// ══════════════════════════════════════════

describe("YamlTool — parse_sequence 빈 줄 처리", () => {
  it("최상위 시퀀스 내 빈 줄 → skip", async () => {
    const yaml = "- item1\n\n- item2";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain("item1");
    expect(parsed).toContain("item2");
  });

  it("중첩 시퀀스 내 빈 줄 → break", async () => {
    const yaml = "list:\n  - item1\n\n  - item2";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed.list)).toBe(true);
    expect(parsed.list).toContain("item1");
  });
});

// ══════════════════════════════════════════
// parse — 빈/특수 입력
// ══════════════════════════════════════════

describe("YamlTool — parse: 빈/특수 입력", () => {
  it("빈 문자열 → 빈 문자열 스칼라 반환", async () => {
    const r = await tool.execute({ action: "parse", data: "" });
    expect(String(r)).toBe('""');
  });

  it("주석만 있는 YAML → null", async () => {
    const r = await tool.execute({ action: "parse", data: "# just a comment\n# another" });
    expect(String(r)).toBe("null");
  });

  it("스칼라만 있는 YAML → 문자열 반환", async () => {
    const r = await tool.execute({ action: "parse", data: "hello world" });
    expect(String(r)).toContain("hello world");
  });

  it("음수 정수 파싱", async () => {
    const r = await tool.execute({ action: "parse", data: "value: -42" });
    const parsed = JSON.parse(String(r));
    expect(parsed.value).toBe(-42);
  });

  it("음수 실수 파싱", async () => {
    const r = await tool.execute({ action: "parse", data: "value: -3.14" });
    const parsed = JSON.parse(String(r));
    expect(parsed.value).toBe(-3.14);
  });
});

// ══════════════════════════════════════════
// parse_mapping 값 없는 키, 따옴표 키, else 분기
// ══════════════════════════════════════════

describe("YamlTool — parse: parse_mapping 값 없는 키", () => {
  it("값 없이 key만 있는 라인 → null로 처리", async () => {
    const yaml = "parent:\n  child1: val1\norphan_key:\n";
    const r = JSON.parse(await tool.execute({ action: "parse", data: yaml }));
    expect(r.parent.child1).toBe("val1");
    expect("orphan_key" in r).toBe(true);
  });
});

describe("YamlTool — parse_scalar inline JSON 실패 → 문자열 반환", () => {
  it("잘못된 인라인 배열 '[a b c]' → 문자열 그대로 반환", async () => {
    const r = await tool.execute({ action: "parse", data: "key: [a b c]" });
    const parsed = JSON.parse(r);
    expect(typeof parsed.key).toBe("string");
    expect(parsed.key).toContain("[a b c]");
  });

  it("잘못된 인라인 객체 '{a:b}' → 문자열 그대로 반환", async () => {
    const r = await tool.execute({ action: "parse", data: "key: {a:b}" });
    const parsed = JSON.parse(r);
    expect(typeof parsed.key).toBe("string");
  });
});

describe("YamlTool — parse_mapping 분기", () => {
  it("따옴표로 감싼 키 → 따옴표 제거 후 파싱", async () => {
    const r = await tool.execute({ action: "parse", data: "'my-key': value\n\"another-key\": 42" });
    const parsed = JSON.parse(r);
    expect(parsed["my-key"]).toBe("value");
    expect(parsed["another-key"]).toBe(42);
  });

  it("콜론 없고 : 끝도 아닌 라인 → 건너뜀 (else 분기)", async () => {
    const yaml = "name: Alice\nsome garbage line\nage: 30";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.name).toBe("Alice");
    expect(parsed.age).toBe(30);
  });
});

// ══════════════════════════════════════════
// collect_block 주석·빈라인
// ══════════════════════════════════════════

describe("YamlTool — collect_block 주석·빈라인", () => {
  it("블록 내 주석 → 필터링 후 블록 수집", async () => {
    const yaml = [
      "parent:",
      "  # 주석",
      "  child: hello",
    ].join("\n");
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.parent?.child).toBe("hello");
  });

  it("중첩 YAML에서 인덴트 감소 → 블록 종료", async () => {
    const yaml = [
      "level1:",
      "  level2: nested",
      "toplevel: back",
    ].join("\n");
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.toplevel).toBe("back");
    expect(parsed.level1?.level2).toBe("nested");
  });
});

// ══════════════════════════════════════════
// parse_sequence collect_block 내부 호출
// ══════════════════════════════════════════

describe("YamlTool — parse_sequence 내부 collect_block 호출", () => {
  it("시퀀스 아이템이 'key:' 형태 (끝 콜론) → 객체 파싱", async () => {
    const yaml = [
      "items:",
      "  - name:",
      "      Alice",
      "  - name:",
      "      Bob",
    ].join("\n");
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed.items)).toBe(true);
  });

  it("시퀀스 아이템이 key: value 형식 → 객체로 파싱", async () => {
    const yaml = [
      "- name: Alice",
      "  age: 30",
      "- name: Bob",
      "  age: 25",
    ].join("\n");
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].name).toBe("Alice");
  });
});

// ══════════════════════════════════════════
// deep_merge 배열 덮어쓰기
// ══════════════════════════════════════════

describe("YamlTool — deep_merge 배열 덮어쓰기", () => {
  it("배열은 deep merge 안 함 → data2 배열이 data1 배열 덮어씀", async () => {
    const yaml1 = "items:\n  - a\n  - b";
    const yaml2 = "items:\n  - c\n  - d\n  - e";
    const r = await tool.execute({ action: "merge", data: yaml1, data2: yaml2 });
    const parsed = await tool.execute({ action: "parse", data: r });
    const obj = JSON.parse(parsed);
    expect(Array.isArray(obj.items)).toBe(true);
    expect(obj.items.some((x: string) => x === "c" || x === "d")).toBe(true);
  });
});

// ══════════════════════════════════════════
// query 깊은 경로
// ══════════════════════════════════════════

describe("YamlTool — query 깊은 경로", () => {
  it("nested.key 경로로 깊이 접근", async () => {
    const yaml = "outer:\n  inner:\n    value: 42";
    const r = await tool.execute({ action: "query", data: yaml, path: "outer.inner.value" });
    const parsed = JSON.parse(r);
    expect(parsed.result).toBe(42);
  });

  it("배열 최상위에서 path 접근", async () => {
    const yaml = "- a\n- b\n- c";
    const r = await tool.execute({ action: "query", data: yaml, path: "0" });
    const parsed = JSON.parse(r);
    expect(parsed).toBeDefined();
  });
});
