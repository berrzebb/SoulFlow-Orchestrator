import { describe, it, expect } from "vitest";
import { XmlTool } from "@src/agent/tools/xml.js";

function make_tool(): XmlTool {
  return new XmlTool();
}

const SAMPLE_XML = `<root><item id="1">Hello</item><item id="2">World</item></root>`;

describe("XmlTool", () => {
  describe("parse", () => {
    it("기본 XML → JSON", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: "<name>Alice</name>" }));
      expect(result.name).toBe("Alice");
    });

    it("속성 파싱 (@ 접두사)", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: '<item id="42">test</item>' }));
      expect(result.item["@id"]).toBe("42");
      expect(result.item["#text"]).toBe("test");
    });

    it("중복 태그 → 배열", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: SAMPLE_XML }));
      expect(result.root.item).toBeInstanceOf(Array);
      expect(result.root.item).toHaveLength(2);
    });

    it("self-closing 태그", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: '<root><br/></root>' }));
      expect(result.root).toHaveProperty("br");
    });
  });

  describe("generate", () => {
    it("JSON → XML", async () => {
      const data = JSON.stringify({ name: "Alice", age: 30 });
      const result = await make_tool().execute({ action: "generate", data });
      expect(result).toContain("<name>Alice</name>");
      expect(result).toContain("<age>30</age>");
    });

    it("배열 → 반복 태그", async () => {
      const data = JSON.stringify({ items: { item: ["a", "b"] } });
      const result = await make_tool().execute({ action: "generate", data });
      expect(result).toContain("<item>a</item>");
      expect(result).toContain("<item>b</item>");
    });

    it("잘못된 JSON → 에러", async () => {
      const result = await make_tool().execute({ action: "generate", data: "not-json" });
      expect(result).toContain("Error");
    });
  });

  describe("query", () => {
    it("경로 쿼리", async () => {
      const xml = "<config><db><host>localhost</host><port>5432</port></db></config>";
      const result = JSON.parse(await make_tool().execute({ action: "query", data: xml, path: "config.db.host" }));
      expect(result.result).toBe("localhost");
    });

    it("없는 경로 → null", async () => {
      const xml = "<root><a>1</a></root>";
      const result = JSON.parse(await make_tool().execute({ action: "query", data: xml, path: "root.b" }));
      expect(result.result).toBeUndefined();
    });

    it("path 없으면 에러", async () => {
      const result = await make_tool().execute({ action: "query", data: "<root/>" });
      expect(result).toContain("Error");
    });
  });

  describe("validate", () => {
    it("유효한 XML → valid: true", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "validate", data: "<root><a>1</a></root>" }));
      expect(result.valid).toBe(true);
    });
  });

  describe("pretty", () => {
    it("들여쓰기된 XML 출력", async () => {
      const result = await make_tool().execute({ action: "pretty", data: "<root><a>1</a><b>2</b></root>" });
      expect(result).toContain("  <a>1</a>");
      expect(result).toContain("  <b>2</b>");
    });
  });

  it("지원하지 않는 action → 에러", async () => {
    const result = await make_tool().execute({ action: "nope", data: "" });
    expect(result).toContain("unsupported action");
  });
});
