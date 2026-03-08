/**
 * HtmlTool — HTML 파싱/텍스트 추출/링크/테이블/새니타이즈/마크다운 변환 테스트.
 */
import { describe, it, expect } from "vitest";
import { HtmlTool } from "../../../src/agent/tools/html.js";

const tool = new HtmlTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const SAMPLE_HTML = `
<html>
<head><title>Test</title><style>.foo{color:red}</style></head>
<body>
  <h1>Hello World</h1>
  <p>Some <strong>bold</strong> text.</p>
  <script>alert('xss')</script>
  <p>&nbsp;Special &amp; chars &lt;gt&gt;</p>
  <a href="https://example.com">Example</a>
  <a href="/local">Local Link</a>
</body>
</html>
`;

describe("HtmlTool — extract_text", () => {
  it("HTML 태그 제거 후 텍스트 추출", async () => {
    const r = await exec({ action: "extract_text", html: SAMPLE_HTML }) as Record<string, unknown>;
    const text = String(r.text);
    expect(text).toContain("Hello World");
    expect(text).toContain("Some bold text");
    expect(text).not.toContain("<h1>");
    expect(text).not.toContain("alert(");
    expect(text).not.toContain(".foo{color:red}");
  });

  it("HTML 엔티티 변환", async () => {
    const r = await exec({ action: "extract_text", html: "<p>&amp; &lt; &gt; &quot; &#39; &nbsp;</p>" }) as Record<string, unknown>;
    const text = String(r.text);
    expect(text).toContain("&");
    expect(text).toContain("<");
    expect(text).toContain(">");
  });

  it("length 반환", async () => {
    const r = await exec({ action: "extract_text", html: "<p>Hello</p>" }) as Record<string, unknown>;
    expect(Number(r.length)).toBeGreaterThan(0);
  });
});

describe("HtmlTool — extract_links", () => {
  it("링크 추출", async () => {
    const r = await exec({ action: "extract_links", html: SAMPLE_HTML }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    const links = r.links as { href: string; text: string }[];
    expect(links.some((l) => l.href === "https://example.com")).toBe(true);
    expect(links.some((l) => l.text === "Example")).toBe(true);
    expect(links.some((l) => l.href === "/local")).toBe(true);
  });

  it("링크 없음 → count 0", async () => {
    const r = await exec({ action: "extract_links", html: "<p>No links here</p>" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });

  it("내부 태그 있는 링크 텍스트 추출", async () => {
    const r = await exec({ action: "extract_links", html: '<a href="/x"><strong>Bold Link</strong></a>' }) as Record<string, unknown>;
    const links = r.links as { href: string; text: string }[];
    expect(links[0].text).toBe("Bold Link");
  });
});

describe("HtmlTool — extract_tables", () => {
  const TABLE_HTML = `
    <table>
      <tr><th>Name</th><th>Age</th></tr>
      <tr><td>Alice</td><td>30</td></tr>
      <tr><td>Bob</td><td>25</td></tr>
    </table>
  `;

  it("테이블 추출", async () => {
    const r = await exec({ action: "extract_tables", html: TABLE_HTML }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    const tables = r.tables as string[][][];
    expect(tables[0].length).toBe(3); // 헤더 포함 3행
    expect(tables[0][0]).toContain("Name");
    expect(tables[0][1]).toContain("Alice");
  });

  it("테이블 없음 → count 0", async () => {
    const r = await exec({ action: "extract_tables", html: "<p>No table</p>" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });

  it("복수 테이블 추출", async () => {
    const html = TABLE_HTML + TABLE_HTML;
    const r = await exec({ action: "extract_tables", html }) as Record<string, unknown>;
    expect(r.count).toBe(2);
  });
});

describe("HtmlTool — sanitize", () => {
  it("script 태그 제거", async () => {
    const r = await exec({ action: "sanitize", html: '<p>Safe</p><script>alert("xss")</script>' }) as Record<string, unknown>;
    expect(String(r.html)).not.toContain("script");
    expect(String(r.html)).toContain("<p>");
  });

  it("style 태그 제거", async () => {
    const r = await exec({ action: "sanitize", html: "<style>.x{color:red}</style><p>Text</p>" }) as Record<string, unknown>;
    expect(String(r.html)).not.toContain("style");
  });

  it("허용 목록 외 태그 제거", async () => {
    const r = await exec({ action: "sanitize", html: "<div><p>OK</p><span>removed</span></div>" }) as Record<string, unknown>;
    const html = String(r.html);
    expect(html).toContain("<p>");
    expect(html).not.toContain("<div>");
    expect(html).not.toContain("<span>");
  });

  it("사용자 정의 allowed_tags", async () => {
    const r = await exec({ action: "sanitize", html: "<div>Keep</div><p>Remove</p>", allowed_tags: "div" }) as Record<string, unknown>;
    const html = String(r.html);
    expect(html).toContain("<div>");
    expect(html).not.toContain("<p>");
  });
});

describe("HtmlTool — to_markdown", () => {
  it("헤딩 변환", async () => {
    const r = await exec({ action: "to_markdown", html: "<h1>Title</h1><h2>Sub</h2>" }) as Record<string, unknown>;
    const md = String(r.markdown);
    expect(md).toContain("# Title");
    expect(md).toContain("## Sub");
  });

  it("링크 변환", async () => {
    const r = await exec({ action: "to_markdown", html: '<a href="https://example.com">Click Here</a>' }) as Record<string, unknown>;
    expect(String(r.markdown)).toContain("[Click Here](https://example.com)");
  });

  it("bold/italic 변환", async () => {
    const r = await exec({ action: "to_markdown", html: "<strong>Bold</strong> and <em>Italic</em>" }) as Record<string, unknown>;
    const md = String(r.markdown);
    expect(md).toContain("**Bold**");
    expect(md).toContain("*Italic*");
  });

  it("code 변환", async () => {
    const r = await exec({ action: "to_markdown", html: "<code>const x = 1</code>" }) as Record<string, unknown>;
    expect(String(r.markdown)).toContain("`const x = 1`");
  });

  it("list item 변환", async () => {
    const r = await exec({ action: "to_markdown", html: "<ul><li>Item 1</li><li>Item 2</li></ul>" }) as Record<string, unknown>;
    const md = String(r.markdown);
    expect(md).toContain("- Item 1");
    expect(md).toContain("- Item 2");
  });

  it("script/style 제거", async () => {
    const r = await exec({ action: "to_markdown", html: '<script>bad()</script><style>.x{}</style><p>Good</p>' }) as Record<string, unknown>;
    const md = String(r.markdown);
    expect(md).not.toContain("bad()");
    expect(md).not.toContain(".x{}");
    expect(md).toContain("Good");
  });
});
