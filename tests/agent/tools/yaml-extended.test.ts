/**
 * YamlTool — 미커버 분기 보충.
 * merge 비객체, query 중간경로 실패, to_yaml 특수케이스,
 * parse_scalar 인라인 배열/객체, parse_sequence 매핑 아이템,
 * parse_mapping 콜론 끝, deep_merge 중첩, default action, YAML 구분자.
 */
import { describe, it, expect } from "vitest";
import { YamlTool } from "@src/agent/tools/yaml.js";

const tool = new YamlTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const r = await tool.execute(params);
  try { return JSON.parse(String(r)); } catch { return String(r); }
}

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
    // a.y는 99로 덮어쓰이고, a.x와 a.z도 존재
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
    // 콜론 포함 → 따옴표로 감싸짐
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
// parse — parse_mapping 콜론 끝 (끝에 : 만 있는 키)
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
// validate — 잘못된 YAML
// ══════════════════════════════════════════

describe("YamlTool — validate: 결과 확인", () => {
  it("유효한 YAML → valid: true 반환", async () => {
    const r = await exec({ action: "validate", data: "key: value" }) as any;
    expect(r.valid).toBe(true);
  });
});
