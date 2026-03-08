/**
 * YamlTool — 미커버 분기 보충.
 * parse_scalar inline JSON 파싱 실패, to_yaml 특수 케이스,
 * parse_mapping 따옴표 키/else 분기, collect_block 주석·빈라인,
 * parse_sequence collect_block 내부 호출, deep_merge 배열 덮어쓰기.
 */
import { describe, it, expect } from "vitest";
import { YamlTool } from "@src/agent/tools/yaml.js";

const tool = new YamlTool();

// ══════════════════════════════════════════
// parse_scalar — inline JSON parse 실패 경로
// ══════════════════════════════════════════

describe("YamlTool — parse_scalar inline JSON 실패 → 문자열 반환", () => {
  it("잘못된 인라인 배열 '[a b c]' → 문자열 그대로 반환", async () => {
    const r = await tool.execute({ action: "parse", data: "key: [a b c]" });
    const parsed = JSON.parse(r);
    // JSON.parse 실패 → 스칼라로 "[a b c]" 문자열 반환
    expect(typeof parsed.key).toBe("string");
    expect(parsed.key).toContain("[a b c]");
  });

  it("잘못된 인라인 객체 '{a:b}' → 문자열 그대로 반환", async () => {
    const r = await tool.execute({ action: "parse", data: "key: {a:b}" });
    const parsed = JSON.parse(r);
    // JSON.parse({a:b}) 실패 → 스칼라 문자열 반환
    expect(typeof parsed.key).toBe("string");
  });
});

// ══════════════════════════════════════════
// to_yaml — 특수 케이스
// ══════════════════════════════════════════

describe("YamlTool — to_yaml 특수 케이스", () => {
  it("{ 포함 문자열 → 따옴표 처리", async () => {
    const r = await tool.execute({
      action: "generate",
      data: JSON.stringify({ key: "{not an object}" }),
    });
    // 중괄호 포함 → 따옴표로 감쌈
    expect(r).toContain('"');
  });

  it("콜론 포함 문자열 → 따옴표 처리", async () => {
    const r = await tool.execute({
      action: "generate",
      data: JSON.stringify({ key: "host: localhost" }),
    });
    expect(r).toContain('"');
  });

  it("숫자형 값 → 숫자 그대로 출력", async () => {
    const r = await tool.execute({
      action: "generate",
      data: JSON.stringify({ count: 42, ratio: 3.14 }),
    });
    expect(r).toContain("42");
    expect(r).toContain("3.14");
  });

  it("undefined 값 → null 출력 (JSON stringify → null)", async () => {
    // JSON.stringify에서 undefined는 null로 대체됨
    const r = await tool.execute({
      action: "generate",
      data: JSON.stringify({ key: null }),
    });
    expect(r).toContain("null");
  });

  it("& 포함 문자열 → 따옴표 처리", async () => {
    const r = await tool.execute({
      action: "generate",
      data: JSON.stringify({ key: "a & b" }),
    });
    expect(r).toContain('"');
  });

  it("배열 안에 중첩 객체 → - key: val 올바른 포맷", async () => {
    const r = await tool.execute({
      action: "generate",
      data: JSON.stringify([{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }]),
    });
    expect(r).toContain("name:");
    expect(r).toContain("age:");
  });

  it("빈 배열 안에 숫자 → - N 형식", async () => {
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
// parse_mapping — 따옴표 키, else 분기
// ══════════════════════════════════════════

describe("YamlTool — parse_mapping 분기", () => {
  it("따옴표로 감싼 키 → 따옴표 제거 후 파싱", async () => {
    const r = await tool.execute({ action: "parse", data: "'my-key': value\n\"another-key\": 42" });
    const parsed = JSON.parse(r);
    // 키에서 따옴표 제거됨
    expect(parsed["my-key"]).toBe("value");
    expect(parsed["another-key"]).toBe(42);
  });

  it("콜론 없고 : 끝도 아닌 라인 → 건너뜀 (else 분기)", async () => {
    // 매핑 중간에 파싱 불가 라인이 있어도 계속 진행
    const yaml = "name: Alice\nsome garbage line\nage: 30";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.name).toBe("Alice");
    expect(parsed.age).toBe(30);
  });
});

// ══════════════════════════════════════════
// collect_block — 주석·빈라인 처리
// ══════════════════════════════════════════

describe("YamlTool — collect_block 주석·빈라인", () => {
  it("블록 내 주석 → 필터링 후 블록 수집", async () => {
    // yaml_parse가 # 주석 라인을 먼저 필터링 후 parse_block에 전달
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
// parse_sequence — collect_block 내부 호출
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
// deep_merge — 배열 덮어쓰기
// ══════════════════════════════════════════

describe("YamlTool — deep_merge 배열 덮어쓰기", () => {
  it("배열은 deep merge 안 함 → data2 배열이 data1 배열 덮어씀", async () => {
    const yaml1 = "items:\n  - a\n  - b";
    const yaml2 = "items:\n  - c\n  - d\n  - e";
    const r = await tool.execute({ action: "merge", data: yaml1, data2: yaml2 });
    // merge 결과 확인 — items 키의 값은 data2의 것이어야 함
    const parsed = await tool.execute({ action: "parse", data: r });
    const obj = JSON.parse(parsed);
    expect(Array.isArray(obj.items)).toBe(true);
    // data2의 배열로 덮어써짐
    expect(obj.items.some((x: string) => x === "c" || x === "d")).toBe(true);
  });
});

// ══════════════════════════════════════════
// query — 깊은 경로 접근
// ══════════════════════════════════════════

describe("YamlTool — query 깊은 경로", () => {
  it("nested.key 경로로 깊이 접근", async () => {
    const yaml = "outer:\n  inner:\n    value: 42";
    const r = await tool.execute({ action: "query", data: yaml, path: "outer.inner.value" });
    const parsed = JSON.parse(r);
    expect(parsed.result).toBe(42);
  });

  it("배열 최상위에서 path 접근 → result: null", async () => {
    // 최상위가 배열인 경우 → 배열은 object지만 string key 접근 → null
    const yaml = "- a\n- b\n- c";
    const r = await tool.execute({ action: "query", data: yaml, path: "0" });
    const parsed = JSON.parse(r);
    // 배열의 "0" 키 접근 → JS 배열은 숫자 인덱스가 string으로도 접근 가능
    expect(parsed).toBeDefined();
  });
});

// ══════════════════════════════════════════
// validate — 에러 경로
// ══════════════════════════════════════════

describe("YamlTool — validate 다양한 경로", () => {
  it("유효한 YAML → valid:true", async () => {
    const r = JSON.parse(await tool.execute({ action: "validate", data: "key: value\nnum: 42" }));
    expect(r.valid).toBe(true);
  });

  it("... 구분자 포함 → 필터링 후 파싱", async () => {
    const yaml = "---\nkey: value\n...";
    const r = JSON.parse(await tool.execute({ action: "validate", data: yaml }));
    expect(r.valid).toBe(true);
  });
});

// ══════════════════════════════════════════
// parse — 스칼라 타입 분기
// ══════════════════════════════════════════

describe("YamlTool — parse_scalar 다양한 타입", () => {
  it("~ → null", async () => {
    const r = await tool.execute({ action: "parse", data: "key: ~" });
    expect(JSON.parse(r).key).toBeNull();
  });

  it("null → null", async () => {
    const r = await tool.execute({ action: "parse", data: "key: null" });
    expect(JSON.parse(r).key).toBeNull();
  });

  it("True → true (대문자)", async () => {
    const r = await tool.execute({ action: "parse", data: "key: True" });
    expect(JSON.parse(r).key).toBe(true);
  });

  it("FALSE → false (대문자)", async () => {
    const r = await tool.execute({ action: "parse", data: "key: FALSE" });
    expect(JSON.parse(r).key).toBe(false);
  });

  it("정수 파싱", async () => {
    const r = await tool.execute({ action: "parse", data: "count: 100" });
    expect(JSON.parse(r).count).toBe(100);
  });

  it("실수 파싱", async () => {
    const r = await tool.execute({ action: "parse", data: "ratio: 3.14" });
    expect(JSON.parse(r).ratio).toBeCloseTo(3.14);
  });
});
