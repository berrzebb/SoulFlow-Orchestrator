/**
 * MarkdownTool — 마크다운 생성 operations 테스트.
 */
import { describe, it, expect } from "vitest";
import { MarkdownTool } from "../../../src/agent/tools/markdown.js";

const tool = new MarkdownTool();

async function exec(params: Record<string, unknown>): Promise<string> {
  return String(await tool.execute(params));
}

describe("MarkdownTool — table", () => {
  it("JSON 배열 → 마크다운 테이블", async () => {
    const data = JSON.stringify([{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }]);
    const r = await exec({ operation: "table", data });
    expect(r).toContain("| name |");
    expect(r).toContain("| Alice |");
    expect(r).toContain("| Bob |");
  });

  it("컬럼 지정", async () => {
    const data = JSON.stringify([{ name: "Alice", age: 30, city: "Seoul" }]);
    const r = await exec({ operation: "table", data, columns: "name,city" });
    expect(r).toContain("name");
    expect(r).toContain("city");
    expect(r).not.toContain("| age |");
  });

  it("정렬 지정", async () => {
    const data = JSON.stringify([{ a: 1, b: 2 }]);
    const r = await exec({ operation: "table", data, align: "center,right" });
    expect(r).toContain(":---:");
    expect(r).toContain("---:");
  });

  it("빈 배열 → empty table 텍스트", async () => {
    const r = await exec({ operation: "table", data: "[]" });
    expect(r).toContain("empty");
  });

  it("잘못된 JSON → Error", async () => {
    expect(await exec({ operation: "table", data: "not-json" })).toContain("Error");
  });
});

describe("MarkdownTool — list", () => {
  it("JSON 배열 → 비순서 목록", async () => {
    const data = JSON.stringify(["item1", "item2", "item3"]);
    const r = await exec({ operation: "list", data });
    expect(r).toContain("- item1");
    expect(r).toContain("- item2");
  });

  it("순서 목록", async () => {
    const data = JSON.stringify(["a", "b"]);
    const r = await exec({ operation: "list", data, ordered: true });
    expect(r).toContain("1. a");
    expect(r).toContain("2. b");
  });
});

describe("MarkdownTool — checklist", () => {
  it("체크리스트 생성", async () => {
    const data = JSON.stringify([
      { text: "Task 1", checked: true },
      { text: "Task 2", checked: false },
    ]);
    const r = await exec({ operation: "checklist", data });
    expect(r).toContain("- [x] Task 1");
    expect(r).toContain("- [ ] Task 2");
  });

  it("문자열 배열 → 체크되지 않은 항목", async () => {
    const data = JSON.stringify(["item1", "item2"]);
    const r = await exec({ operation: "checklist", data });
    expect(r).toContain("- [ ] item1");
  });
});

describe("MarkdownTool — toc", () => {
  it("헤딩에서 TOC 생성", async () => {
    const text = "# Section 1\n## Subsection\n# Section 2";
    const r = await exec({ operation: "toc", text });
    expect(r).toContain("Section 1");
    expect(r).toContain("Section 2");
    expect(r).toContain("Subsection");
  });

  it("헤딩 없음 → 안내 메시지", async () => {
    const r = await exec({ operation: "toc", text: "plain text" });
    expect(r).toContain("no headings");
  });
});

describe("MarkdownTool — html_to_md", () => {
  it("볼드 태그 변환", async () => {
    const r = await exec({ operation: "html_to_md", text: "<strong>bold</strong>" });
    expect(r).toBe("**bold**");
  });

  it("링크 태그 변환", async () => {
    const r = await exec({ operation: "html_to_md", text: '<a href="https://example.com">link</a>' });
    expect(r).toBe("[link](https://example.com)");
  });

  it("헤딩 태그 변환", async () => {
    const r = await exec({ operation: "html_to_md", text: "<h2>Title</h2>" });
    expect(r).toContain("## Title");
  });
});

describe("MarkdownTool — badge / link / image", () => {
  it("badge 생성", async () => {
    const r = await exec({ operation: "badge", label: "build", text: "passing", color: "green" });
    expect(r).toContain("![build]");
    expect(r).toContain("shields.io");
    expect(r).toContain("passing");
  });

  it("link 생성", async () => {
    const r = await exec({ operation: "link", label: "Click", url: "https://example.com" });
    expect(r).toBe("[Click](https://example.com)");
  });

  it("image 생성", async () => {
    const r = await exec({ operation: "image", alt: "Logo", url: "https://example.com/img.png" });
    expect(r).toBe("![Logo](https://example.com/img.png)");
  });
});

describe("MarkdownTool — code_block / details", () => {
  it("code_block 생성", async () => {
    const r = await exec({ operation: "code_block", language: "typescript", code: "const x = 1;" });
    expect(r).toContain("```typescript");
    expect(r).toContain("const x = 1;");
    expect(r).toContain("```");
  });

  it("details 블록 생성", async () => {
    const r = await exec({ operation: "details", summary: "Click me", text: "Hidden content" });
    expect(r).toContain("<details>");
    expect(r).toContain("Click me");
    expect(r).toContain("Hidden content");
    expect(r).toContain("</details>");
  });
});

describe("MarkdownTool — 미커버 분기", () => {
  it("table: data가 객체 JSON (배열 아님) → L54 Error", async () => {
    const r = await exec({ operation: "table", data: '{"a":1}' });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("array");
  });

  it("list: data가 객체 JSON (배열 아님) → L90 Error", async () => {
    const r = await exec({ operation: "list", data: '{"a":1}' });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("array");
  });

  it("checklist: data가 객체 JSON (배열 아님) → L104 Error", async () => {
    const r = await exec({ operation: "checklist", data: '{"a":1}' });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("array");
  });
});
