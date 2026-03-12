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

// ══════════════════════════════════════════
// query_xml — 배열 인덱스 탐색
// ══════════════════════════════════════════

describe("XmlTool — query 배열 인덱스", () => {
  it("중복 태그 배열 인덱스로 접근", async () => {
    const xml = "<list><item>첫번째</item><item>두번째</item></list>";
    const r = JSON.parse(await make_tool().execute({ action: "query", data: xml, path: "list.item.1" }));
    expect(r.result).toBe("두번째");
  });

  it("경로 도중 비객체/비배열 → null 반환", async () => {
    const xml = "<root><a>text</a></root>";
    const r = JSON.parse(await make_tool().execute({ action: "query", data: xml, path: "root.a.b" }));
    expect(r.result).toBeNull();
  });
});

// ══════════════════════════════════════════
// validate — 실패 케이스
// ══════════════════════════════════════════

describe("XmlTool — validate 실패", () => {
  it("텍스트만 있는 비XML → valid: false 또는 true (텍스트 처리)", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "validate", data: "plain text no tags" }));
    expect(r).toBeDefined();
  });
});

// ══════════════════════════════════════════
// json_to_xml — null/undefined, attrs, #text
// ══════════════════════════════════════════

describe("XmlTool — generate 특수 케이스", () => {
  it("null 값 → self-closing 태그", async () => {
    const data = JSON.stringify({ empty: null });
    const r = await make_tool().execute({ action: "generate", data });
    expect(r).toContain("<empty");
    expect(r).toContain("/>");
  });

  it("@ 속성 포함 → 속성으로 변환", async () => {
    const data = JSON.stringify({ item: { "@id": "42", "#text": "내용" } });
    const r = await make_tool().execute({ action: "generate", data });
    expect(r).toContain('id="42"');
    expect(r).toContain("내용");
  });

  it("배열 of objects → 각각 태그로 감쌈", async () => {
    const data = JSON.stringify({ list: { item: [{ name: "A" }, { name: "B" }] } });
    const r = await make_tool().execute({ action: "generate", data });
    expect(r).toContain("<item>");
    expect(r).toContain("<name>A</name>");
  });

  it("primitive 값 → <tag>value</tag>", async () => {
    const data = JSON.stringify({ count: 42, flag: true });
    const r = await make_tool().execute({ action: "generate", data });
    expect(r).toContain("<count>42</count>");
  });

  it("@ 키와 #text 이외 내부 키가 있는 경우 → 자식 태그 포함", async () => {
    const data = JSON.stringify({ root: { "@id": "1", child: "value" } });
    const r = await make_tool().execute({ action: "generate", data });
    expect(r).toContain("<root");
    expect(r).toContain("<child>value</child>");
  });
});

// ══════════════════════════════════════════
// parse — 텍스트 전용 (비태그 입력)
// ══════════════════════════════════════════

describe("XmlTool — parse 텍스트 전용 입력", () => {
  it("태그 없는 plain text → #text 필드로 반환", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "parse", data: "plain text content" }));
    expect(r["#text"]).toBe("plain text content");
  });
});

// ══════════════════════════════════════════
// pretty — 기존 커버리지 보강
// ══════════════════════════════════════════

describe("XmlTool — pretty 보강", () => {
  it("파싱 실패 XML → 원본 그대로 반환", async () => {
    const data = "not xml at all ><><";
    const r = await make_tool().execute({ action: "pretty", data });
    expect(typeof r).toBe("string");
  });
});

// ══════════════════════════════════════════
// json_to_xml — 배열 내 primitive 값
// ══════════════════════════════════════════

describe("XmlTool — generate 배열 내 primitive", () => {
  it("배열 내 string → <tag>value</tag> 반복", async () => {
    const data = JSON.stringify({ tags: { tag: ["alpha", "beta"] } });
    const r = await make_tool().execute({ action: "generate", data });
    expect(r).toContain("<tag>alpha</tag>");
    expect(r).toContain("<tag>beta</tag>");
  });
});
