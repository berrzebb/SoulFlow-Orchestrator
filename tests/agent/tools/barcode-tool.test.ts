/**
 * BarcodeTool 커버리지 — code128/ean13/code39 생성 + validate/parse/checksum.
 */
import { describe, it, expect } from "vitest";
import { BarcodeTool } from "@src/agent/tools/barcode.js";

const tool = new BarcodeTool();

describe("BarcodeTool — 메타데이터", () => {
  it("name = barcode", () => expect(tool.name).toBe("barcode"));
  it("category = data", () => expect(tool.category).toBe("data"));
  it("to_schema: function 형식", () => expect(tool.to_schema().type).toBe("function"));
});

describe("BarcodeTool — generate code128", () => {
  it("기본 포맷 code128 SVG 생성", async () => {
    const result = await tool.execute({ action: "generate", data: "HELLO", format: "code128" });
    expect(result).toContain("<svg");
    expect(result).toContain("</svg>");
    expect(result).toContain("<rect");
  });

  it("code128 기본 포맷 (format 미지정)", async () => {
    const result = await tool.execute({ action: "generate", data: "TEST" });
    expect(result).toContain("<svg");
  });

  it("code128 숫자 데이터", async () => {
    const result = await tool.execute({ action: "generate", data: "1234567890", format: "code128" });
    expect(result).toContain("<svg");
  });

  it("code128 빈 데이터", async () => {
    const result = await tool.execute({ action: "generate", data: "", format: "code128" });
    expect(result).toContain("<svg"); // 빈 데이터도 SVG 반환
  });

  it("code128 width/height 커스텀", async () => {
    const result = await tool.execute({ action: "generate", data: "ABC", format: "code128", width: 3, height: 100 });
    expect(result).toContain("<svg");
    expect(result).toContain('height="120"'); // 100 + 20
  });
});

describe("BarcodeTool — generate ean13", () => {
  it("EAN-13 (12자리 → 체크섬 자동 추가)", async () => {
    const result = await tool.execute({ action: "generate", data: "123456789012", format: "ean13" });
    expect(result).toContain("<svg");
    expect(result).toContain("1234567890128"); // 체크섬 8 추가
  });

  it("EAN-13 (13자리)", async () => {
    const result = await tool.execute({ action: "generate", data: "4006381333931", format: "ean13" });
    expect(result).toContain("<svg");
  });

  it("EAN-13 12자리 미만 → 에러 JSON", async () => {
    const result = await tool.execute({ action: "generate", data: "12345", format: "ean13" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("12 digits");
  });

  it("EAN-13 비숫자 입력 필터링", async () => {
    const result = await tool.execute({ action: "generate", data: "123-456-789012", format: "ean13" });
    expect(result).toContain("<svg");
  });
});

describe("BarcodeTool — generate code39", () => {
  it("code39 SVG 생성", async () => {
    const result = await tool.execute({ action: "generate", data: "CODE39", format: "code39" });
    expect(result).toContain("<svg");
    expect(result).toContain("CODE39");
  });

  it("code39 소문자 입력 → SVG 생성", async () => {
    const result = await tool.execute({ action: "generate", data: "hello", format: "code39" });
    expect(result).toContain("<svg");
    expect(result).toContain("hello"); // 텍스트 레이블에 원본 표시
  });

  it("code39 숫자 포함", async () => {
    const result = await tool.execute({ action: "generate", data: "ABC-123", format: "code39" });
    expect(result).toContain("<svg");
  });
});

describe("BarcodeTool — 미지원 포맷", () => {
  it("알 수 없는 format → 에러 JSON", async () => {
    const result = await tool.execute({ action: "generate", data: "test", format: "qrcode" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("unsupported format");
  });
});

describe("BarcodeTool — validate_ean", () => {
  it("유효한 EAN-13 → valid=true", async () => {
    const result = await tool.execute({ action: "validate_ean", data: "4006381333931" });
    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(true);
    expect(parsed.data).toBe("4006381333931");
  });

  it("잘못된 체크섬 → valid=false", async () => {
    const result = await tool.execute({ action: "validate_ean", data: "4006381333930" });
    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(false);
  });

  it("13자리 미만 → valid=false", async () => {
    const result = await tool.execute({ action: "validate_ean", data: "12345" });
    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(false);
  });

  it("비숫자 포함 → valid=false", async () => {
    const result = await tool.execute({ action: "validate_ean", data: "400638133393X" });
    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(false);
  });
});

describe("BarcodeTool — parse_ean", () => {
  it("EAN-13 파싱 → prefix/manufacturer/product/check_digit", async () => {
    const result = await tool.execute({ action: "parse_ean", data: "4006381333931" });
    const parsed = JSON.parse(result);
    expect(parsed.prefix).toBe("400");
    expect(parsed.manufacturer).toBe("63813");
    expect(parsed.product).toBe("3393");
    expect(parsed.check_digit).toBe("1");
  });

  it("13자리 아님 → 에러 JSON", async () => {
    const result = await tool.execute({ action: "parse_ean", data: "12345" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("13 digits");
  });
});

describe("BarcodeTool — checksum_ean", () => {
  it("12자리 → 체크섬 계산", async () => {
    const result = await tool.execute({ action: "checksum_ean", data: "400638133393" });
    const parsed = JSON.parse(result);
    expect(parsed.check_digit).toBe(1);
    expect(parsed.ean13).toBe("4006381333931");
  });

  it("12자리 미만 → 에러 JSON", async () => {
    const result = await tool.execute({ action: "checksum_ean", data: "12345" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("12 digits");
  });

  it("대표 체크섬 케이스: 978014028747", async () => {
    const result = await tool.execute({ action: "checksum_ean", data: "978014028747" });
    const parsed = JSON.parse(result);
    expect(parsed.ean13).toHaveLength(13);
  });
});

describe("BarcodeTool — 알 수 없는 action", () => {
  it("unknown action → 에러 JSON", async () => {
    const result = await tool.execute({ action: "unknown_action" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("unknown action");
  });
});
