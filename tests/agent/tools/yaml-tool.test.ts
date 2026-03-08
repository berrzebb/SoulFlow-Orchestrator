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
