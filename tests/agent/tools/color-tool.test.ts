/**
 * ColorTool — parse/convert/blend/contrast/lighten/darken/complement/palette 테스트.
 */
import { describe, it, expect } from "vitest";
import { ColorTool } from "../../../src/agent/tools/color.js";

const tool = new ColorTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("ColorTool — parse", () => {
  it("hex 파싱 → rgb + hsl", async () => {
    const r = await exec({ action: "parse", color: "#ff0000" }) as Record<string, unknown>;
    expect(r.hex).toBe("#ff0000");
    expect(Array.isArray(r.rgb)).toBe(true);
    expect(Array.isArray(r.hsl)).toBe(true);
  });

  it("rgb(255,0,0) 파싱", async () => {
    const r = await exec({ action: "parse", color: "rgb(255, 0, 0)" }) as Record<string, unknown>;
    expect(String(r.hex)).toContain("ff");
  });

  it("잘못된 색상 → Error", async () => {
    const r = await exec({ action: "parse", color: "not-a-color" });
    expect(String(r)).toContain("Error");
  });
});

describe("ColorTool — convert", () => {
  it("hex → rgb 형식", async () => {
    const r = await exec({ action: "convert", color: "#00ff00", format: "rgb" }) as Record<string, unknown>;
    expect(String(r.result)).toContain("rgb");
  });

  it("hex → hsl 형식", async () => {
    const r = await exec({ action: "convert", color: "#0000ff", format: "hsl" }) as Record<string, unknown>;
    expect(String(r.result)).toContain("hsl");
  });

  it("hex → hex 형식", async () => {
    const r = await exec({ action: "convert", color: "#ff0000", format: "hex" }) as Record<string, unknown>;
    expect(r.result).toBe("#ff0000");
  });
});

describe("ColorTool — blend", () => {
  it("두 색상 혼합", async () => {
    const r = await exec({ action: "blend", color: "#000000", color2: "#ffffff", amount: 0.5 }) as Record<string, unknown>;
    expect(r.result).toBeDefined();
    expect(String(r.result)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("color2 없음 → Error", async () => {
    const r = await exec({ action: "blend", color: "#ff0000" });
    expect(String(r)).toContain("Error");
  });
});

describe("ColorTool — contrast", () => {
  it("검정-흰색 대비율 최대", async () => {
    const r = await exec({ action: "contrast", color: "#000000", color2: "#ffffff" }) as Record<string, unknown>;
    expect(Number(r.ratio)).toBeGreaterThan(10);
  });
});

describe("ColorTool — lighten/darken", () => {
  it("lighten: 색상 밝아짐", async () => {
    const r = await exec({ action: "lighten", color: "#404040", amount: 0.3 }) as Record<string, unknown>;
    expect(r.result).toBeDefined();
  });

  it("darken: 색상 어두워짐", async () => {
    const r = await exec({ action: "darken", color: "#c0c0c0", amount: 0.3 }) as Record<string, unknown>;
    expect(r.result).toBeDefined();
  });
});

describe("ColorTool — complement/palette", () => {
  it("complement: 보색 반환 (complement 키)", async () => {
    // 반환: { original, complement }
    const r = await exec({ action: "complement", color: "#ff0000" }) as Record<string, unknown>;
    expect(r.complement).toBeDefined();
    expect(String(r.complement)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("palette: 5개 색상 생성 (palette 키)", async () => {
    // 반환: { palette, count }
    const r = await exec({ action: "palette", color: "#ff0000", count: 5 }) as Record<string, unknown>;
    expect(Array.isArray(r.palette)).toBe(true);
    expect((r.palette as unknown[]).length).toBe(5);
  });
});
