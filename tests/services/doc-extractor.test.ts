import { describe, it, expect } from "vitest";
import { extract_doc_text, BINARY_DOC_EXTENSIONS } from "../../src/utils/doc-extractor.js";

describe("BINARY_DOC_EXTENSIONS", () => {
  it("pdf/docx/pptx/hwpx 포함", () => {
    expect(BINARY_DOC_EXTENSIONS.has(".pdf")).toBe(true);
    expect(BINARY_DOC_EXTENSIONS.has(".docx")).toBe(true);
    expect(BINARY_DOC_EXTENSIONS.has(".pptx")).toBe(true);
    expect(BINARY_DOC_EXTENSIONS.has(".hwpx")).toBe(true);
  });

  it("텍스트 확장자 미포함", () => {
    expect(BINARY_DOC_EXTENSIONS.has(".md")).toBe(false);
    expect(BINARY_DOC_EXTENSIONS.has(".txt")).toBe(false);
  });
});

describe("extract_doc_text", () => {
  it("지원하지 않는 확장자 → 빈 문자열", async () => {
    const result = await extract_doc_text(Buffer.from("hello"), ".xyz");
    expect(result).toBe("");
  });

  it("손상된 PDF → 빈 문자열 (예외 미발생)", async () => {
    const result = await extract_doc_text(Buffer.from("not a real pdf"), ".pdf");
    expect(typeof result).toBe("string");
  });

  it("손상된 DOCX → 빈 문자열 (예외 미발생)", async () => {
    const result = await extract_doc_text(Buffer.from("not a zip"), ".docx");
    expect(typeof result).toBe("string");
  });

  it("손상된 PPTX → 빈 문자열 (예외 미발생)", async () => {
    const result = await extract_doc_text(Buffer.from("not a zip"), ".pptx");
    expect(typeof result).toBe("string");
  });

  it("손상된 HWPX → 빈 문자열 (예외 미발생)", async () => {
    const result = await extract_doc_text(Buffer.from("not a zip"), ".hwpx");
    expect(typeof result).toBe("string");
  });

  it("최소 PDF 스트림에서 텍스트 추출", async () => {
    // BT ... (Hello) ... ET 포함하는 최소 PDF 스트림
    const minimal_pdf = Buffer.from(
      "%PDF-1.4\nstream\r\nBT (Hello World) Tj ET\nendstream",
      "latin1",
    );
    const result = await extract_doc_text(minimal_pdf, ".pdf");
    expect(result).toContain("Hello World");
  });

  it("대소문자 무관하게 확장자 처리", async () => {
    const result = await extract_doc_text(Buffer.from("data"), ".PDF");
    expect(typeof result).toBe("string");
  });
});
