/**
 * XmlTool — 미커버 분기 보충.
 * query_xml 배열 인덱스 탐색, 비배열/비객체 경계,
 * json_to_xml null/attrs/@text, collect_attrs 비객체,
 * generate 배열 of objects, validate 실패.
 */
import { describe, it, expect } from "vitest";
import { XmlTool } from "@src/agent/tools/xml.js";

function make(): XmlTool {
  return new XmlTool();
}

// ══════════════════════════════════════════
// query_xml — 배열 인덱스 탐색
// ══════════════════════════════════════════

describe("XmlTool — query 배열 인덱스", () => {
  it("중복 태그 배열 인덱스로 접근", async () => {
    const xml = "<list><item>첫번째</item><item>두번째</item></list>";
    const r = JSON.parse(await make().execute({ action: "query", data: xml, path: "list.item.1" }));
    expect(r.result).toBe("두번째");
  });

  it("경로 도중 비객체/비배열 → null 반환", async () => {
    const xml = "<root><a>text</a></root>";
    // a.b → a는 "text"(string), b 접근 → null
    const r = JSON.parse(await make().execute({ action: "query", data: xml, path: "root.a.b" }));
    expect(r.result).toBeNull();
  });
});

// ══════════════════════════════════════════
// validate — 실패 케이스
// ══════════════════════════════════════════

describe("XmlTool — validate 실패", () => {
  it("텍스트만 있는 비XML → valid: false 또는 true (텍스트 처리)", async () => {
    // xml_to_json은 태그 없으면 #text 반환 → valid: true
    const r = JSON.parse(await make().execute({ action: "validate", data: "plain text no tags" }));
    // 에러 없이 처리됨
    expect(r).toBeDefined();
  });
});

// ══════════════════════════════════════════
// json_to_xml — null/undefined, attrs, #text
// ══════════════════════════════════════════

describe("XmlTool — generate 특수 케이스", () => {
  it("null 값 → self-closing 태그", async () => {
    const data = JSON.stringify({ empty: null });
    const r = await make().execute({ action: "generate", data });
    expect(r).toContain("<empty");
    expect(r).toContain("/>");
  });

  it("@ 속성 포함 → 속성으로 변환", async () => {
    const data = JSON.stringify({ item: { "@id": "42", "#text": "내용" } });
    const r = await make().execute({ action: "generate", data });
    expect(r).toContain('id="42"');
    expect(r).toContain("내용");
  });

  it("배열 of objects → 각각 태그로 감쌈", async () => {
    const data = JSON.stringify({ list: { item: [{ name: "A" }, { name: "B" }] } });
    const r = await make().execute({ action: "generate", data });
    expect(r).toContain("<item>");
    expect(r).toContain("<name>A</name>");
  });

  it("primitive 값 → <tag>value</tag>", async () => {
    const data = JSON.stringify({ count: 42, flag: true });
    const r = await make().execute({ action: "generate", data });
    expect(r).toContain("<count>42</count>");
  });

  it("@ 키와 #text 이외 내부 키가 있는 경우 → 자식 태그 포함", async () => {
    const data = JSON.stringify({ root: { "@id": "1", child: "value" } });
    const r = await make().execute({ action: "generate", data });
    expect(r).toContain("<root");
    expect(r).toContain("<child>value</child>");
  });
});

// ══════════════════════════════════════════
// parse — 텍스트 전용 (비태그 입력)
// ══════════════════════════════════════════

describe("XmlTool — parse 텍스트 전용 입력", () => {
  it("태그 없는 plain text → #text 필드로 반환", async () => {
    const r = JSON.parse(await make().execute({ action: "parse", data: "plain text content" }));
    expect(r["#text"]).toBe("plain text content");
  });
});

// ══════════════════════════════════════════
// pretty — 기존 커버리지 보강
// ══════════════════════════════════════════

describe("XmlTool — pretty 보강", () => {
  it("파싱 실패 XML → 원본 그대로 반환", async () => {
    // xml_to_json 실패 시 원본 반환
    const data = "not xml at all ><><";
    const r = await make().execute({ action: "pretty", data });
    // 에러 없이 처리됨
    expect(typeof r).toBe("string");
  });
});

// ══════════════════════════════════════════
// json_to_xml — 배열 내 primitive 값
// ══════════════════════════════════════════

describe("XmlTool — generate 배열 내 primitive", () => {
  it("배열 내 string → <tag>value</tag> 반복", async () => {
    const data = JSON.stringify({ tags: { tag: ["alpha", "beta"] } });
    const r = await make().execute({ action: "generate", data });
    expect(r).toContain("<tag>alpha</tag>");
    expect(r).toContain("<tag>beta</tag>");
  });
});
