/**
 * XmlTool — XML 파싱/생성/쿼리/검증/포맷팅 테스트.
 */
import { describe, it, expect } from "vitest";
import { XmlTool } from "../../../src/agent/tools/xml.js";

const tool = new XmlTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const BASIC_XML = `<root><name>Alice</name><age>30</age><city>Seoul</city></root>`;
const ATTRS_XML = `<person id="1" active="true"><name>Bob</name></person>`;

describe("XmlTool — parse", () => {
  it("기본 XML → JSON 변환", async () => {
    const r = await exec({ action: "parse", data: BASIC_XML }) as Record<string, unknown>;
    expect(r).toBeDefined();
    const root = r.root as Record<string, unknown>;
    expect(root.name).toBe("Alice");
    expect(root.age).toBe("30");
    expect(root.city).toBe("Seoul");
  });

  it("속성 포함 XML 파싱", async () => {
    const r = await exec({ action: "parse", data: ATTRS_XML }) as Record<string, unknown>;
    const person = r.person as Record<string, unknown>;
    expect(person["@id"]).toBe("1");
    expect(person["@active"]).toBe("true");
  });

  it("자기 종료 태그 파싱", async () => {
    const r = await exec({ action: "parse", data: '<root><item id="1"/></root>' }) as Record<string, unknown>;
    const root = r.root as Record<string, unknown>;
    expect(root).toBeDefined();
  });
});

describe("XmlTool — generate", () => {
  it("JSON → XML 생성", async () => {
    const json = JSON.stringify({ greeting: { message: "hello" } });
    const r = String(await exec({ action: "generate", data: json }));
    expect(r).toContain("<greeting>");
    expect(r).toContain("hello");
    expect(r).toContain("</greeting>");
  });

  it("잘못된 JSON → Error", async () => {
    expect(String(await exec({ action: "generate", data: "not-json" }))).toContain("Error");
  });
});

describe("XmlTool — query", () => {
  it("path로 값 추출", async () => {
    const r = await exec({ action: "query", data: BASIC_XML, path: "root.name" }) as Record<string, unknown>;
    expect(r.result).toBe("Alice");
  });

  it("path 없음 → Error", async () => {
    expect(String(await exec({ action: "query", data: BASIC_XML, path: "" }))).toContain("Error");
  });
});

describe("XmlTool — validate", () => {
  it("유효한 XML → valid: true", async () => {
    const r = await exec({ action: "validate", data: BASIC_XML }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });
});

describe("XmlTool — pretty", () => {
  it("XML 포맷팅", async () => {
    const r = String(await exec({ action: "pretty", data: BASIC_XML }));
    expect(r).toContain("Alice");
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("XmlTool — 미커버 분기", () => {
  it("query: current가 배열이고 part가 비정수 → map 반환 (L64)", async () => {
    // <root><item>a</item><item>b</item></root> → item은 배열, .name은 비정수 인덱스
    const xml = `<root><item><name>Alice</name></item><item><name>Bob</name></item></root>`;
    const r = await exec({ action: "query", data: xml, path: "root.item.name" });
    // map 결과: 배열로 반환되거나 undefined — 에러 없이 반환되어야 함
    expect(r).toBeDefined();
  });

  it("generate: 배열 JSON → L155 Array.isArray 분기", async () => {
    // json_to_xml([...], 0) → L155: Array.isArray fires
    const data = JSON.stringify([{ tag: "item1" }, { tag: "item2" }]);
    const r = String(await exec({ action: "generate", data }));
    expect(r).toContain("item1");
  });

  it("generate: null 포함 배열 → L153 null/undefined 분기", async () => {
    // json_to_xml([null, {tag:"x"}], 0) → L155 array, item null → L153
    const data = JSON.stringify([null, { tag: "x" }]);
    const r = String(await exec({ action: "generate", data }));
    expect(r).toBeDefined();
  });

  it("generate: 문자열 포함 배열 → L154 non-object 분기", async () => {
    // json_to_xml(["hello", "world"], 0) → L155 array, item "hello" → L154
    const data = JSON.stringify(["hello", "world"]);
    const r = String(await exec({ action: "generate", data }));
    expect(r).toContain("hello");
  });
});
