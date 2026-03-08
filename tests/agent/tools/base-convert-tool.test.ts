/**
 * BaseConvertTool — convert/bytes_format/bytes_parse/int_to_roman/roman_to_int 테스트.
 */
import { describe, it, expect } from "vitest";
import { BaseConvertTool } from "../../../src/agent/tools/base-convert.js";

const tool = new BaseConvertTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("BaseConvertTool — convert", () => {
  it("dec → hex", async () => {
    const r = await exec({ action: "convert", value: "255", from: "dec", to: "hex" }) as Record<string, unknown>;
    expect(r.result).toBe("ff");
  });

  it("hex → dec", async () => {
    const r = await exec({ action: "convert", value: "ff", from: "hex", to: "dec" }) as Record<string, unknown>;
    expect(r.result).toBe("255");
  });

  it("dec → bin", async () => {
    const r = await exec({ action: "convert", value: "10", from: "dec", to: "bin" }) as Record<string, unknown>;
    expect(r.result).toBe("1010");
  });

  it("bin → dec", async () => {
    const r = await exec({ action: "convert", value: "1010", from: "bin", to: "dec" }) as Record<string, unknown>;
    expect(r.result).toBe("10");
  });

  it("dec → oct", async () => {
    const r = await exec({ action: "convert", value: "8", from: "dec", to: "oct" }) as Record<string, unknown>;
    expect(r.result).toBe("10");
  });

  it("잘못된 bin 값 → Error 포함 문자열", async () => {
    // bin 파싱 실패: parseInt("xyz", 2) = NaN → null → Error 반환
    const raw = await tool.execute({ action: "convert", value: "xyz", from: "bin", to: "hex" });
    expect(String(raw)).toContain("Error");
  });
});

describe("BaseConvertTool — bytes_format", () => {
  it("1024 bytes → 1.00 KB", async () => {
    const r = await exec({ action: "bytes_format", bytes: 1024 }) as Record<string, unknown>;
    expect(r.formatted).toBe("1.00 KB");
    expect(r.unit).toBe("KB");
  });

  it("0 bytes", async () => {
    const r = await exec({ action: "bytes_format", bytes: 0 }) as Record<string, unknown>;
    expect(r.unit).toBe("B");
  });

  it("1GB = 1073741824 bytes", async () => {
    const r = await exec({ action: "bytes_format", bytes: 1073741824 }) as Record<string, unknown>;
    expect(r.unit).toBe("GB");
  });

  it("precision=0", async () => {
    const r = await exec({ action: "bytes_format", bytes: 1536, precision: 0 }) as Record<string, unknown>;
    expect(String(r.formatted)).not.toContain(".");
  });
});

describe("BaseConvertTool — int_to_roman / roman_to_int", () => {
  it("int_to_roman: 2024 → MMXXIV", async () => {
    // 반환: { roman, integer }
    const r = await exec({ action: "int_to_roman", value: "2024" }) as Record<string, unknown>;
    expect(r.roman).toBe("MMXXIV");
  });

  it("roman_to_int: XIV → 14", async () => {
    // 반환: { integer, roman }
    const r = await exec({ action: "roman_to_int", value: "XIV" }) as Record<string, unknown>;
    expect(r.integer).toBe(14);
  });

  it("roman_to_int: MCMXCIX → 1999", async () => {
    const r = await exec({ action: "roman_to_int", value: "MCMXCIX" }) as Record<string, unknown>;
    expect(r.integer).toBe(1999);
  });

  it("int_to_roman: 0 → Error", async () => {
    const raw = await tool.execute({ action: "int_to_roman", value: "0" });
    expect(String(raw)).toContain("Error");
  });
});
