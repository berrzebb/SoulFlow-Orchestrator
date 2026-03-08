/**
 * BaseConvertTool — 미커버 브랜치 보완 (base32/base62/bytes_parse/로마자).
 */
import { describe, it, expect } from "vitest";
import { BaseConvertTool } from "@src/agent/tools/base-convert.js";

const tool = new BaseConvertTool();

describe("BaseConvertTool — convert (미커버 base)", () => {
  it("bin → dec 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "1010", from: "bin", to: "dec" }));
    expect(r.result).toBe("10");
    expect(r.decimal).toBe(10);
  });

  it("oct → hex 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "17", from: "oct", to: "hex" }));
    expect(r.result).toBe("f");
  });

  it("dec → base36 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "255", from: "dec", to: "base36" }));
    expect(r.result).toBe("73");
  });

  it("dec → base32 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "10", from: "dec", to: "base32" }));
    expect(r.result).toBeDefined();
    expect(typeof r.result).toBe("string");
  });

  it("base32 → dec 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "K", from: "base32", to: "dec" }));
    expect(r.decimal).toBe(10);
  });

  it("dec → base62 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "62", from: "dec", to: "base62" }));
    expect(r.result).toBe("10");
  });

  it("base62 → dec 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "10", from: "base62", to: "dec" }));
    expect(r.decimal).toBe(62);
  });

  it("dec → bin 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "10", from: "dec", to: "bin" }));
    expect(r.result).toBe("1010");
  });

  it("dec → oct 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "8", from: "dec", to: "oct" }));
    expect(r.result).toBe("10");
  });

  it("0 변환 → 0 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "0", from: "dec", to: "hex" }));
    expect(r.result).toBe("0");
  });

  it("알 수 없는 from base → 에러 반환", async () => {
    const r = await tool.execute({ action: "convert", value: "123", from: "base999", to: "hex" });
    expect(r).toContain("Error");
  });

  it("잘못된 base32 문자 → 에러 반환", async () => {
    const r = await tool.execute({ action: "convert", value: "!!!", from: "base32", to: "dec" });
    expect(r).toContain("Error");
  });

  it("잘못된 base62 문자 → 에러 반환", async () => {
    const r = await tool.execute({ action: "convert", value: "!@#", from: "base62", to: "dec" });
    expect(r).toContain("Error");
  });

  it("알 수 없는 to base → toString 폴백", async () => {
    const r = JSON.parse(await tool.execute({ action: "convert", value: "10", from: "dec", to: "base999" }));
    expect(r.result).toBeDefined();
  });
});

describe("BaseConvertTool — bytes_parse", () => {
  it("1.5 GB → 바이트 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_parse", value: "1.5 GB" }));
    expect(r.bytes).toBe(Math.round(1.5 * 1024 ** 3));
  });

  it("1024 MB → 바이트 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_parse", value: "1024 MB" }));
    expect(r.bytes).toBe(1024 * 1024 * 1024);
  });

  it("1 TB → 바이트 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_parse", value: "1 TB" }));
    expect(r.bytes).toBe(1024 ** 4);
  });

  it("1 KB → 바이트 변환", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_parse", value: "1 KB" }));
    expect(r.bytes).toBe(1024);
  });

  it("GiB 단위 파싱", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_parse", value: "2 GiB" }));
    expect(r.bytes).toBe(2 * 1024 ** 3);
  });

  it("잘못된 형식 → 에러 반환", async () => {
    const r = await tool.execute({ action: "bytes_parse", value: "not a size" });
    expect(r).toContain("Error");
  });

  it("B 단위 → 그대로 1 바이트", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_parse", value: "1 B" }));
    expect(r.bytes).toBe(1);
  });
});

describe("BaseConvertTool — bytes_format", () => {
  it("1024 → 1.00 KB", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_format", bytes: 1024 }));
    expect(r.formatted).toBe("1.00 KB");
    expect(r.unit).toBe("KB");
  });

  it("0 → 0.00 B", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_format", bytes: 0 }));
    expect(r.unit).toBe("B");
  });

  it("precision 옵션", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_format", bytes: 1500, precision: 0 }));
    expect(r.formatted).toContain("1 KB");
  });

  it("GB 단위", async () => {
    const r = JSON.parse(await tool.execute({ action: "bytes_format", bytes: 1024 ** 3 }));
    expect(r.unit).toBe("GB");
  });
});

describe("BaseConvertTool — int_to_roman / roman_to_int", () => {
  it("1 → I", async () => {
    const r = JSON.parse(await tool.execute({ action: "int_to_roman", value: "1" }));
    expect(r.roman).toBe("I");
  });

  it("2024 → MMXXIV", async () => {
    const r = JSON.parse(await tool.execute({ action: "int_to_roman", value: "2024" }));
    expect(r.roman).toBe("MMXXIV");
  });

  it("3999 → MMMCMXCIX", async () => {
    const r = JSON.parse(await tool.execute({ action: "int_to_roman", value: "3999" }));
    expect(r.roman).toBe("MMMCMXCIX");
  });

  it("4000 → 에러 반환", async () => {
    const r = await tool.execute({ action: "int_to_roman", value: "4000" });
    expect(r).toContain("Error");
  });

  it("0 → 에러 반환", async () => {
    const r = await tool.execute({ action: "int_to_roman", value: "0" });
    expect(r).toContain("Error");
  });

  it("소수 → 에러 반환", async () => {
    const r = await tool.execute({ action: "int_to_roman", value: "3.5" });
    expect(r).toContain("Error");
  });

  it("XIV → 14", async () => {
    const r = JSON.parse(await tool.execute({ action: "roman_to_int", value: "XIV" }));
    expect(r.integer).toBe(14);
  });

  it("MMXXIV → 2024", async () => {
    const r = JSON.parse(await tool.execute({ action: "roman_to_int", value: "MMXXIV" }));
    expect(r.integer).toBe(2024);
  });

  it("IX → 9 (빼기 규칙)", async () => {
    const r = JSON.parse(await tool.execute({ action: "roman_to_int", value: "IX" }));
    expect(r.integer).toBe(9);
  });
});

describe("BaseConvertTool — 에러 케이스", () => {
  it("unsupported action → 에러 반환", async () => {
    const r = await tool.execute({ action: "multiply" });
    expect(r).toContain("Error");
  });
});
