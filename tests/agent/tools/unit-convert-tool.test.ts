/**
 * UnitConvertTool — 단위 변환 operations 테스트.
 */
import { describe, it, expect } from "vitest";
import { UnitConvertTool } from "../../../src/agent/tools/unit-convert.js";

const tool = new UnitConvertTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("UnitConvertTool — length", () => {
  it("m → km", async () => {
    const r = await exec({ action: "convert", value: 1000, from: "m", to: "km" }) as Record<string, unknown>;
    expect(r.result).toBe(1);
  });

  it("km → m", async () => {
    const r = await exec({ action: "convert", value: 1, from: "km", to: "m" }) as Record<string, unknown>;
    expect(r.result).toBe(1000);
  });

  it("ft → m 근사", async () => {
    const r = await exec({ action: "convert", value: 1, from: "ft", to: "m" }) as Record<string, unknown>;
    expect(Number(r.result)).toBeCloseTo(0.3048, 4);
  });
});

describe("UnitConvertTool — weight", () => {
  it("kg → g", async () => {
    const r = await exec({ action: "convert", value: 1, from: "kg", to: "g" }) as Record<string, unknown>;
    expect(r.result).toBe(1000);
  });

  it("lb → kg 근사", async () => {
    const r = await exec({ action: "convert", value: 1, from: "lb", to: "kg" }) as Record<string, unknown>;
    expect(Number(r.result)).toBeCloseTo(0.453592, 4);
  });
});

describe("UnitConvertTool — temperature", () => {
  it("°C → °F (0°C = 32°F)", async () => {
    const r = await exec({ action: "temperature", value: 0, from: "c", to: "f" }) as Record<string, unknown>;
    expect(r.result).toBe(32);
  });

  it("°C → °F (100°C = 212°F)", async () => {
    const r = await exec({ action: "temperature", value: 100, from: "c", to: "f" }) as Record<string, unknown>;
    expect(r.result).toBe(212);
  });

  it("°F → °C (32°F = 0°C)", async () => {
    const r = await exec({ action: "temperature", value: 32, from: "f", to: "c" }) as Record<string, unknown>;
    expect(r.result).toBe(0);
  });

  it("°C → K (0°C = 273.15K)", async () => {
    const r = await exec({ action: "temperature", value: 0, from: "c", to: "k" }) as Record<string, unknown>;
    expect(Number(r.result)).toBeCloseTo(273.15, 2);
  });

  it("convert action으로 온도 변환", async () => {
    const r = await exec({ action: "convert", value: 100, from: "c", to: "f" }) as Record<string, unknown>;
    expect(r.result).toBe(212);
  });
});

describe("UnitConvertTool — speed", () => {
  it("km/h → m/s", async () => {
    const r = await exec({ action: "convert", value: 3.6, from: "km/h", to: "m/s" }) as Record<string, unknown>;
    expect(Number(r.result)).toBeCloseTo(1, 4);
  });
});

describe("UnitConvertTool — data", () => {
  it("kb → b", async () => {
    const r = await exec({ action: "convert", value: 1, from: "kb", to: "b" }) as Record<string, unknown>;
    expect(r.result).toBe(1024);
  });

  it("gb → mb", async () => {
    const r = await exec({ action: "convert", value: 1, from: "gb", to: "mb" }) as Record<string, unknown>;
    expect(r.result).toBe(1024);
  });
});

describe("UnitConvertTool — time", () => {
  it("h → min", async () => {
    const r = await exec({ action: "convert", value: 1, from: "h", to: "min" }) as Record<string, unknown>;
    expect(r.result).toBe(60);
  });

  it("d → h", async () => {
    const r = await exec({ action: "convert", value: 1, from: "d", to: "h" }) as Record<string, unknown>;
    expect(r.result).toBe(24);
  });
});

describe("UnitConvertTool — list_units / list_categories", () => {
  it("categories 목록 반환", async () => {
    const r = await exec({ action: "list_categories" }) as Record<string, unknown>;
    const cats = r.categories as string[];
    expect(cats).toContain("length");
    expect(cats).toContain("weight");
    expect(cats).toContain("temperature");
  });

  it("length 단위 목록", async () => {
    const r = await exec({ action: "list_units", category: "length" }) as Record<string, unknown>;
    const units = r.units as string[];
    expect(units).toContain("m");
    expect(units).toContain("km");
    expect(units).toContain("ft");
  });

  it("temperature 단위 목록", async () => {
    const r = await exec({ action: "list_units", category: "temperature" }) as Record<string, unknown>;
    const units = r.units as string[];
    expect(units).toContain("c");
    expect(units).toContain("f");
    expect(units).toContain("k");
  });

  it("알 수 없는 category → error 포함", async () => {
    const r = await exec({ action: "list_units", category: "unknown" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("UnitConvertTool — 에러 처리", () => {
  it("알 수 없는 단위 → error 포함", async () => {
    const r = await exec({ action: "convert", value: 1, from: "xyz", to: "abc" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("unknown action → error 반환 (default 분기)", async () => {
    const r = await exec({ action: "unknown_op", value: 1 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("kelvin→celsius 변환 (convert_temp case 'k')", async () => {
    // from='k' → case 'k': celsius = value - 273.15
    const r = await exec({ action: "temperature", value: 373.15, from: "k", to: "c" }) as Record<string, unknown>;
    expect(r.result).toBeCloseTo(100, 1);
  });

  it("convert_temp: 알 수 없는 from → NaN→null 반환 (default: return NaN)", async () => {
    // from이 c/f/k가 아닌 경우 → default → NaN → JSON.stringify(NaN)=null
    const r = await exec({ action: "temperature", value: 100, from: "x", to: "c" }) as Record<string, unknown>;
    expect(r.result).toBeNull();
  });

  it("convert_temp: 알 수 없는 to → NaN→null 반환 (default: return NaN)", async () => {
    // from='c'(valid) → celsius=100, to='z'(invalid) → default → NaN → null
    const r = await exec({ action: "temperature", value: 100, from: "c", to: "z" }) as Record<string, unknown>;
    expect(r.result).toBeNull();
  });
});
