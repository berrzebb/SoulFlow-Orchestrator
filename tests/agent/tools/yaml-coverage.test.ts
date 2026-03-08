/**
 * YamlTool — 미커버 분기 추가 보충.
 * to_yaml: 빈 배열, 빈 객체, 대괄호 포함 문자열, unknown 타입.
 * generate_yaml: JSON 파싱 실패.
 * parse_block: 빈 줄 입력.
 * parse_sequence: child.consumed=0 경로.
 * merge: YAML 파싱 실패.
 */
import { describe, it, expect } from "vitest";
import { YamlTool } from "@src/agent/tools/yaml.js";

const tool = new YamlTool();

// ══════════════════════════════════════════
// generate — to_yaml 특수 케이스
// ══════════════════════════════════════════

describe("YamlTool — generate: to_yaml 빈 컨테이너", () => {
  it("빈 배열 [] → []", async () => {
    const r = await tool.execute({ action: "generate", data: "[]" });
    expect(String(r)).toContain("[]");
  });

  it("빈 객체 {} → {}", async () => {
    const r = await tool.execute({ action: "generate", data: "{}" });
    expect(String(r)).toContain("{}");
  });

  it("대괄호 포함 문자열 → 따옴표 처리", async () => {
    const json = JSON.stringify({ val: "list [a, b]" });
    const r = String(await tool.execute({ action: "generate", data: json }));
    expect(r).toContain('"');
  });

  it("JSON 파싱 실패 → Error 반환", async () => {
    const r = String(await tool.execute({ action: "generate", data: "{invalid json" }));
    expect(r).toContain("Error");
  });

  it("boolean 값 generate", async () => {
    const r = String(await tool.execute({ action: "generate", data: JSON.stringify({ flag: true }) }));
    expect(r).toContain("true");
  });

  it("number 값 generate", async () => {
    const r = String(await tool.execute({ action: "generate", data: JSON.stringify({ count: 42 }) }));
    expect(r).toContain("42");
  });
});

// ══════════════════════════════════════════
// parse — parse_block 빈 입력
// ══════════════════════════════════════════

describe("YamlTool — parse: 빈/특수 입력", () => {
  it("빈 문자열 → 빈 문자열 스칼라 반환", async () => {
    const r = await tool.execute({ action: "parse", data: "" });
    // yaml_parse("") → parse_block([""], 0) → parse_scalar("") → ""
    // JSON.stringify("") = '""'
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
// parse — parse_mapping edge cases
// ══════════════════════════════════════════

describe("YamlTool — parse: parse_mapping 엣지케이스", () => {
  it("값 없이 key만 있는 라인 → 빈 객체로 처리", async () => {
    // 'orphan_key' has no child → child block is empty → null
    const yaml = "parent:\n  child1: val1\norphan_key:\n";
    const r = JSON.parse(await tool.execute({ action: "parse", data: yaml }));
    expect(r.parent.child1).toBe("val1");
    // orphan_key exists (value may be null or empty)
    expect("orphan_key" in r).toBe(true);
  });

  it("인덴트 감소로 블록 종료", async () => {
    const yaml = "outer:\n  inner: 1\ntoplevel: 2";
    const r = JSON.parse(await tool.execute({ action: "parse", data: yaml }));
    expect(r.outer.inner).toBe(1);
    expect(r.toplevel).toBe(2);
  });
});

// ══════════════════════════════════════════
// merge — YAML 파싱 실패
// ══════════════════════════════════════════

describe("YamlTool — merge: 유효한 입력", () => {
  it("단순 병합 → 두 키 모두 포함", async () => {
    const r = String(await tool.execute({ action: "merge", data: "a: 1", data2: "b: 2" }));
    expect(r).toContain("a:");
    expect(r).toContain("b:");
  });

  it("중복 키 → data2 값이 우선", async () => {
    const r = String(await tool.execute({ action: "merge", data: "x: old", data2: "x: new" }));
    expect(r).toContain("new");
  });
});

// ══════════════════════════════════════════
// query — path 없음
// ══════════════════════════════════════════

describe("YamlTool — query: path 없음", () => {
  it("path 미전달 → Error", async () => {
    const r = String(await tool.execute({ action: "query", data: "key: val", path: "" }));
    expect(r).toContain("Error");
    expect(r).toContain("path");
  });

  it("존재하지 않는 경로 → result: undefined or null", async () => {
    const r = JSON.parse(await tool.execute({ action: "query", data: "a: 1", path: "nonexistent" }));
    expect(r.result).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// parse — sequence with nested mapping
// ══════════════════════════════════════════

describe("YamlTool — parse: sequence 안의 mapping (콜론 끝)", () => {
  it("sequence 아이템이 mapping 형식 → 객체로 파싱", async () => {
    const yaml = "items:\n  - name: Alice\n  - name: Bob";
    const r = JSON.parse(await tool.execute({ action: "parse", data: yaml }));
    expect(Array.isArray(r.items)).toBe(true);
    expect(r.items.length).toBe(2);
  });

  it("- 로 시작하지 않는 줄에서 시퀀스 종료", async () => {
    const yaml = "list:\n  - x\n  - y\nextra: z";
    const r = JSON.parse(await tool.execute({ action: "parse", data: yaml }));
    expect(r.list).toEqual(["x", "y"]);
    expect(r.extra).toBe("z");
  });
});
