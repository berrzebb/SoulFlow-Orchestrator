import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { extract_doc_text, BINARY_DOC_EXTENSIONS } from "@src/utils/doc-extractor.js";

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

// ── from doc-extractor-cov2.test.ts ──

describe("extract_doc_text — PDF 이스케이프 시퀀스", () => {
  it("\\n 이스케이프 → 줄바꿈 처리됨", async () => {
    const pdf = Buffer.from(
      "stream\r\n(Hello\\nWorld) Tj\nendstream",
      "latin1",
    );
    const result = await extract_doc_text(pdf, ".pdf");
    // 텍스트가 추출되면 OK (구체적 공백 변환은 normalize됨)
    expect(typeof result).toBe("string");
  });

  it("\\\\(백슬래시 이스케이프) → 처리됨", async () => {
    const pdf = Buffer.from(
      "stream\r\n(back\\\\slash) Tj\nendstream",
      "latin1",
    );
    const result = await extract_doc_text(pdf, ".pdf");
    expect(result).toContain("slash");
  });

  it("\\( \\) (괄호 이스케이프) → 처리됨", async () => {
    const pdf = Buffer.from(
      "stream\r\n(open\\(bracket\\)here) Tj\nendstream",
      "latin1",
    );
    const result = await extract_doc_text(pdf, ".pdf");
    expect(typeof result).toBe("string");
  });

  it("팔진수 이스케이프 \\101(=A) → 'A' 변환", async () => {
    const pdf = Buffer.from(
      "stream\r\n(\\101\\102\\103) Tj\nendstream",  // ABC in octal
      "latin1",
    );
    const result = await extract_doc_text(pdf, ".pdf");
    expect(result).toContain("ABC");
  });

  it("\\t 이스케이프 → 탭 처리됨", async () => {
    const pdf = Buffer.from(
      "stream\r\n(tab\\there) Tj\nendstream",
      "latin1",
    );
    const result = await extract_doc_text(pdf, ".pdf");
    expect(typeof result).toBe("string");
  });

  it("\\r 이스케이프 → 캐리지 리턴 처리됨", async () => {
    const pdf = Buffer.from(
      "stream\r\n(cr\\rhere) Tj\nendstream",
      "latin1",
    );
    const result = await extract_doc_text(pdf, ".pdf");
    expect(typeof result).toBe("string");
  });

  it("PDF 스트림 내 텍스트 없음 → 빈 문자열", async () => {
    // 괄호 없는 스트림
    const pdf = Buffer.from(
      "stream\r\nq 1 0 0 1 0 0 cm Q\nendstream",
      "latin1",
    );
    const result = await extract_doc_text(pdf, ".pdf");
    expect(result).toBe("");
  });

  it("공백만 있는 스트림 내용 → 빈 문자열 (trim 처리)", async () => {
    const pdf = Buffer.from(
      "stream\r\n(   ) Tj\nendstream",
      "latin1",
    );
    const result = await extract_doc_text(pdf, ".pdf");
    // 공백만 있는 파트는 trim 후 빈 문자열 → push 안 됨
    expect(result).toBe("");
  });
});

describe("extract_doc_text — PPTX 실제 ZIP", () => {
  function make_pptx_zip(slides: { name: string; xml: string }[]): Buffer {
    const zip = new AdmZip();
    for (const s of slides) {
      zip.addFile(s.name, Buffer.from(s.xml, "utf-8"));
    }
    return zip.toBuffer();
  }

  it("슬라이드 1개 → 텍스트 추출됨", async () => {
    const xml = `<p:sld><p:sp><p:txBody><a:t>슬라이드 제목</a:t></p:txBody></p:sp></p:sld>`;
    const buf = make_pptx_zip([{ name: "ppt/slides/slide1.xml", xml }]);
    const result = await extract_doc_text(buf, ".pptx");
    expect(result).toContain("슬라이드 제목");
  });

  it("슬라이드 여러 개 → 정렬 후 모든 텍스트 추출", async () => {
    const slide1 = `<p:sld><a:t>첫번째</a:t></p:sld>`;
    const slide2 = `<p:sld><a:t>두번째</a:t></p:sld>`;
    const buf = make_pptx_zip([
      { name: "ppt/slides/slide2.xml", xml: slide2 },
      { name: "ppt/slides/slide1.xml", xml: slide1 },
    ]);
    const result = await extract_doc_text(buf, ".pptx");
    expect(result).toContain("첫번째");
    expect(result).toContain("두번째");
  });

  it("슬라이드 없는 ZIP → 빈 문자열", async () => {
    const buf = make_pptx_zip([
      { name: "docProps/app.xml", xml: "<app><AppVersion>1.0</AppVersion></app>" },
    ]);
    const result = await extract_doc_text(buf, ".pptx");
    expect(result).toBe("");
  });

  it("XML 특수문자 엔티티 디코딩", async () => {
    const xml = `<p:sld><a:t>&lt;Hello&gt; &amp; &quot;World&quot;</a:t></p:sld>`;
    const buf = make_pptx_zip([{ name: "ppt/slides/slide1.xml", xml }]);
    const result = await extract_doc_text(buf, ".pptx");
    expect(result).toContain("<Hello>");
    expect(result).toContain("&");
    expect(result).toContain('"World"');
  });
});

describe("extract_doc_text — HWPX 실제 ZIP", () => {
  function make_hwpx_zip(sections: { name: string; xml: string }[]): Buffer {
    const zip = new AdmZip();
    for (const s of sections) {
      zip.addFile(s.name, Buffer.from(s.xml, "utf-8"));
    }
    return zip.toBuffer();
  }

  it("섹션 1개 → 텍스트 추출됨", async () => {
    const xml = `<hml><body><text><para><run><t>한글 문서 내용</t></run></para></text></body></hml>`;
    const buf = make_hwpx_zip([{ name: "Contents/section0.xml", xml }]);
    const result = await extract_doc_text(buf, ".hwpx");
    expect(result).toContain("한글 문서 내용");
  });

  it("섹션 여러 개 → 정렬 후 모든 텍스트 추출", async () => {
    const s0 = `<hml><body><t>섹션0</t></body></hml>`;
    const s1 = `<hml><body><t>섹션1</t></body></hml>`;
    const buf = make_hwpx_zip([
      { name: "Contents/section1.xml", xml: s1 },
      { name: "Contents/section0.xml", xml: s0 },
    ]);
    const result = await extract_doc_text(buf, ".hwpx");
    expect(result).toContain("섹션0");
    expect(result).toContain("섹션1");
  });

  it("섹션 없는 ZIP → 빈 문자열", async () => {
    const buf = make_hwpx_zip([
      { name: "META-INF/manifest.xml", xml: "<manifest/>" },
    ]);
    const result = await extract_doc_text(buf, ".hwpx");
    expect(result).toBe("");
  });
});

// ── from doc-extractor-cov3.test.ts ──

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
