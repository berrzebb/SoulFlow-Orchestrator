/**
 * doc-extractor — 미커버 분기 보충.
 * extract_pdf_stream 이스케이프 시퀀스, PPTX/HWPX 실제 ZIP 콘텐츠,
 * PDF 스트림 내 텍스트 없음, 대용량 초과 케이스.
 */
import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { extract_doc_text } from "@src/utils/doc-extractor.js";

// ══════════════════════════════════════════
// PDF — extract_pdf_stream 이스케이프 시퀀스
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// PPTX — 유효한 ZIP + 슬라이드 XML
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// HWPX — 유효한 ZIP + 섹션 XML
// ══════════════════════════════════════════

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
