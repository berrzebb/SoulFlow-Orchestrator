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

async function exec_raw(params: Record<string, unknown>): Promise<string> {
  return tool.execute(params);
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

// ══════════════════════════════════════════
// convert — 추가 base 변환 (base32, base62, base36 roundtrip, 에러)
// ══════════════════════════════════════════

describe("BaseConvertTool — convert (추가 base)", () => {
  it("oct → hex 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "convert", value: "17", from: "oct", to: "hex" }));
    expect(r.result).toBe("f");
  });

  it("dec → base36 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "convert", value: "255", from: "dec", to: "base36" }));
    expect(r.result).toBe("73");
  });

  it("dec → base32 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "convert", value: "10", from: "dec", to: "base32" }));
    expect(r.result).toBeDefined();
    expect(typeof r.result).toBe("string");
  });

  it("base32 → dec 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "convert", value: "K", from: "base32", to: "dec" }));
    expect(r.decimal).toBe(10);
  });

  it("dec → base62 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "convert", value: "62", from: "dec", to: "base62" }));
    expect(r.result).toBe("10");
  });

  it("base62 → dec 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "convert", value: "10", from: "base62", to: "dec" }));
    expect(r.decimal).toBe(62);
  });

  it("0 변환 → 0 반환", async () => {
    const r = JSON.parse(await exec_raw({ action: "convert", value: "0", from: "dec", to: "hex" }));
    expect(r.result).toBe("0");
  });

  it("알 수 없는 from base → 에러 반환", async () => {
    const r = await exec_raw({ action: "convert", value: "123", from: "base999", to: "hex" });
    expect(r).toContain("Error");
  });

  it("잘못된 base32 문자 → 에러 반환", async () => {
    const r = await exec_raw({ action: "convert", value: "!!!", from: "base32", to: "dec" });
    expect(r).toContain("Error");
  });

  it("잘못된 base62 문자 → 에러 반환", async () => {
    const r = await exec_raw({ action: "convert", value: "!@#", from: "base62", to: "dec" });
    expect(r).toContain("Error");
  });

  it("알 수 없는 to base → toString 폴백", async () => {
    const r = JSON.parse(await exec_raw({ action: "convert", value: "10", from: "dec", to: "base999" }));
    expect(r.result).toBeDefined();
  });

  it("base36 → dec 변환 (to_decimal case)", async () => {
    const r = JSON.parse(await exec_raw({ action: "convert", value: "73", from: "base36", to: "dec" }));
    expect(r.decimal).toBe(255);
    expect(r.result).toBe("255");
  });
});

// ══════════════════════════════════════════
// bytes_parse
// ══════════════════════════════════════════

describe("BaseConvertTool — bytes_parse", () => {
  it("1.5 GB → 바이트 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "bytes_parse", value: "1.5 GB" }));
    expect(r.bytes).toBe(Math.round(1.5 * 1024 ** 3));
  });

  it("1024 MB → 바이트 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "bytes_parse", value: "1024 MB" }));
    expect(r.bytes).toBe(1024 * 1024 * 1024);
  });

  it("1 TB → 바이트 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "bytes_parse", value: "1 TB" }));
    expect(r.bytes).toBe(1024 ** 4);
  });

  it("1 KB → 바이트 변환", async () => {
    const r = JSON.parse(await exec_raw({ action: "bytes_parse", value: "1 KB" }));
    expect(r.bytes).toBe(1024);
  });

  it("GiB 단위 파싱", async () => {
    const r = JSON.parse(await exec_raw({ action: "bytes_parse", value: "2 GiB" }));
    expect(r.bytes).toBe(2 * 1024 ** 3);
  });

  it("잘못된 형식 → 에러 반환", async () => {
    const r = await exec_raw({ action: "bytes_parse", value: "not a size" });
    expect(r).toContain("Error");
  });

  it("B 단위 → 그대로 1 바이트", async () => {
    const r = JSON.parse(await exec_raw({ action: "bytes_parse", value: "1 B" }));
    expect(r.bytes).toBe(1);
  });
});

// ══════════════════════════════════════════
// int_to_roman/roman_to_int — 추가 케이스
// ══════════════════════════════════════════

describe("BaseConvertTool — roman 추가 케이스", () => {
  it("1 → I", async () => {
    const r = JSON.parse(await exec_raw({ action: "int_to_roman", value: "1" }));
    expect(r.roman).toBe("I");
  });

  it("3999 → MMMCMXCIX", async () => {
    const r = JSON.parse(await exec_raw({ action: "int_to_roman", value: "3999" }));
    expect(r.roman).toBe("MMMCMXCIX");
  });

  it("4000 → 에러 반환", async () => {
    const r = await exec_raw({ action: "int_to_roman", value: "4000" });
    expect(r).toContain("Error");
  });

  it("소수 → 에러 반환", async () => {
    const r = await exec_raw({ action: "int_to_roman", value: "3.5" });
    expect(r).toContain("Error");
  });

  it("MMXXIV → 2024", async () => {
    const r = JSON.parse(await exec_raw({ action: "roman_to_int", value: "MMXXIV" }));
    expect(r.integer).toBe(2024);
  });

  it("IX → 9 (빼기 규칙)", async () => {
    const r = JSON.parse(await exec_raw({ action: "roman_to_int", value: "IX" }));
    expect(r.integer).toBe(9);
  });
});

// ══════════════════════════════════════════
// 에러 케이스
// ══════════════════════════════════════════

describe("BaseConvertTool — unsupported action", () => {
  it("unsupported action → 에러 반환", async () => {
    const r = await exec_raw({ action: "multiply" });
    expect(r).toContain("Error");
  });
});
