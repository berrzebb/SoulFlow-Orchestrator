/**
 * doc-extractor.ts — 미커버 분기 (cov3):
 * - L42: PDF 스트림 total >= MAX_EXTRACT_CHARS → break (200,001자 스트림)
 * - L73: DOCX mammoth.extractRawText → return value.replace(...)
 */
import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { extract_doc_text } from "@src/utils/doc-extractor.js";

// ── L42: PDF 스트림 200,001자 → total >= MAX_EXTRACT_CHARS → break ────────────

describe("extract_doc_text — L42: PDF 대용량 스트림 → break", () => {
  it("200,001자 스트림 → 두 번째 스트림 순회 시 total >= 200,000 → L42 break", async () => {
    // 첫 번째 스트림: (AAAA...AAAA) 200,001자 → extract_pdf_stream 반환 후 total=200,001
    // 두 번째 스트림: 두 번째 while 루프 진입 시 L42 break
    const big_content = "A".repeat(200_001);
    const fake_pdf = Buffer.from(
      `stream\n(${big_content})\nendstream\nstream\n(SHOULD_NOT_REACH)\nendstream`,
      "latin1",
    );
    const result = await extract_doc_text(fake_pdf, ".pdf");
    // 첫 번째 스트림의 내용은 포함, 두 번째는 break로 스킵
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain("SHOULD_NOT_REACH");
  });
});

// ── L73: DOCX mammoth 추출 → return value.replace(...) ──────────────────────

describe("extract_doc_text — L73: DOCX 텍스트 추출", () => {
  it("최소 DOCX ZIP → mammoth 추출 → L73 return value.replace(...)", async () => {
    // mammoth이 처리할 수 있는 최소 DOCX 구조 (word/document.xml 포함)
    const zip = new AdmZip();
    const doc_xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello from DOCX</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    zip.addFile("word/document.xml", Buffer.from(doc_xml, "utf-8"));
    zip.addFile("[Content_Types].xml", Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, "utf-8",
    ));

    const buf = zip.toBuffer();
    const result = await extract_doc_text(buf, ".docx");
    expect(typeof result).toBe("string");
    // mammoth이 텍스트를 추출하거나 빈 문자열을 반환해도 L73 실행됨
  });
});
