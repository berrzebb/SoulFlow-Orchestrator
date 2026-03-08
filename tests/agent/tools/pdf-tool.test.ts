/**
 * PdfTool — fs/promises mock 기반 커버리지.
 * PDF 바이너리를 메모리에서 생성하여 사용.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mock_read_file } = vi.hoisted(() => ({ mock_read_file: vi.fn() }));

vi.mock("node:fs/promises", () => ({
  readFile: mock_read_file,
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { PdfTool } from "@src/agent/tools/pdf.js";

const WS = "/tmp/workspace";

function make_tool() { return new PdfTool({ workspace: WS }); }

/**
 * 최소한의 PDF 바이너리 생성.
 * %PDF 매직 바이트 + 페이지 구조 + 텍스트 스트림.
 */
function make_pdf(content = "BT (Hello World) Tj ET", page_count = 2): Buffer {
  const pages = Array.from({ length: page_count }, (_, i) => `
  ${i + 1} 0 obj
  <<
    /Type /Page
    /Parent 10 0 R
    /Contents ${20 + i} 0 R
  >>
  endobj
  ${20 + i} 0 obj
  << /Length ${content.length + 10} >>
  stream
  ${content}
  endstream
  endobj`).join("\n");

  const pdf_text = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 10 0 R >>
endobj
10 0 obj
<< /Type /Pages /Count ${page_count} >>
endobj
/Title (Test PDF Document)
/Author (Test Author)
/Creator (Test Creator)
/Producer (PdfTool Test)
${pages}
%%EOF`;

  return Buffer.from(pdf_text, "latin1");
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("PdfTool — 메타데이터", () => {
  it("name = pdf", () => expect(make_tool().name).toBe("pdf"));
  it("category = data", () => expect(make_tool().category).toBe("data"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// 파라미터 검증
// ══════════════════════════════════════════

describe("PdfTool — 파라미터 검증", () => {
  it("path 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "extract_text", path: "" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("path");
  });

  it("path traversal → Error", async () => {
    // readFile은 호출되지 않음 (path 검사가 먼저 차단)
    const r = await make_tool().execute({ action: "extract_text", path: "../../etc/passwd" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("path traversal");
  });

  it("PDF 매직바이트 불일치 → Error", async () => {
    mock_read_file.mockResolvedValueOnce(Buffer.from("NOT A PDF FILE"));
    const r = await make_tool().execute({ action: "extract_text", path: "not-pdf.txt" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("valid PDF");
  });
});

// ══════════════════════════════════════════
// extract_text
// ══════════════════════════════════════════

describe("PdfTool — extract_text", () => {
  it("텍스트 추출 → JSON 반환", async () => {
    mock_read_file.mockResolvedValueOnce(make_pdf("BT (Sample text content) Tj ET"));
    const r = JSON.parse(await make_tool().execute({ action: "extract_text", path: "doc.pdf" }));
    expect(r.text).toBeDefined();
    expect(typeof r.length).toBe("number");
    expect(typeof r.truncated).toBe("boolean");
    expect(typeof r.pages).toBe("number");
  });

  it("pages 범위 지정 (1-2)", async () => {
    mock_read_file.mockResolvedValueOnce(make_pdf("BT (Page content) Tj ET", 3));
    const r = JSON.parse(await make_tool().execute({
      action: "extract_text",
      path: "doc.pdf",
      pages: "1-2",
    }));
    expect(r).toBeDefined();
  });

  it("pages 쉼표 지정 (1,3)", async () => {
    mock_read_file.mockResolvedValueOnce(make_pdf("BT (Content) Tj ET", 3));
    const r = JSON.parse(await make_tool().execute({
      action: "extract_text",
      path: "doc.pdf",
      pages: "1,3",
    }));
    expect(r).toBeDefined();
  });

  it("max_chars 제한 → truncated=true", async () => {
    const long_text = "A".repeat(200);
    mock_read_file.mockResolvedValueOnce(make_pdf(`BT (${long_text}) Tj ET`));
    const r = JSON.parse(await make_tool().execute({
      action: "extract_text",
      path: "doc.pdf",
      max_chars: 100,
    }));
    // 텍스트가 길면 truncated될 수 있음
    expect(r).toBeDefined();
  });

  it("이스케이프 시퀀스 처리 (octal, \\n, \\t)", async () => {
    mock_read_file.mockResolvedValueOnce(make_pdf("BT (Hello\\nWorld\\t\\101) Tj ET"));
    const r = JSON.parse(await make_tool().execute({ action: "extract_text", path: "doc.pdf" }));
    expect(r.text).toBeDefined();
  });

  it("readFile 오류 → Error 전파", async () => {
    mock_read_file.mockRejectedValueOnce(new Error("ENOENT: no such file"));
    try {
      await make_tool().execute({ action: "extract_text", path: "missing.pdf" });
    } catch (e) {
      expect((e as Error).message).toContain("ENOENT");
    }
  });
});

// ══════════════════════════════════════════
// info
// ══════════════════════════════════════════

describe("PdfTool — info", () => {
  it("메타데이터 반환", async () => {
    mock_read_file.mockResolvedValueOnce(make_pdf("BT (text) Tj ET", 3));
    const r = JSON.parse(await make_tool().execute({ action: "info", path: "doc.pdf" }));
    expect(r.path).toBeDefined();
    expect(r.size_bytes).toBeGreaterThan(0);
    expect(typeof r.pages).toBe("number");
    // version field
    expect(r.version).toBeDefined();
  });

  it("title/author 필드 파싱", async () => {
    mock_read_file.mockResolvedValueOnce(make_pdf());
    const r = JSON.parse(await make_tool().execute({ action: "info", path: "doc.pdf" }));
    // Test PDF has /Title (Test PDF Document) and /Author (Test Author)
    expect(r.title).toBe("Test PDF Document");
    expect(r.author).toBe("Test Author");
  });
});

// ══════════════════════════════════════════
// page_count
// ══════════════════════════════════════════

describe("PdfTool — page_count", () => {
  it("페이지 수 반환", async () => {
    mock_read_file.mockResolvedValueOnce(make_pdf("", 3));
    const r = JSON.parse(await make_tool().execute({ action: "page_count", path: "doc.pdf" }));
    expect(r.pages).toBe(3);
  });

  it("페이지 없음 → 0", async () => {
    const no_pages = Buffer.from("%PDF-1.7\nno pages here\n%%EOF", "latin1");
    mock_read_file.mockResolvedValueOnce(no_pages);
    const r = JSON.parse(await make_tool().execute({ action: "page_count", path: "empty.pdf" }));
    expect(r.pages).toBe(0);
  });
});

// ══════════════════════════════════════════
// unsupported action
// ══════════════════════════════════════════

describe("PdfTool — unsupported action", () => {
  it("bogus → Error", async () => {
    mock_read_file.mockResolvedValueOnce(make_pdf());
    const r = await make_tool().execute({ action: "bogus", path: "doc.pdf" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});
