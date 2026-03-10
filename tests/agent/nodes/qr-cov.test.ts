/**
 * qr_handler 미커버 경로:
 * - data > 60 bytes → "data too long" 에러
 * - data 18-60 bytes → version >= 2 (alignment pattern 경로 + pad bytes)
 */
import { describe, it, expect } from "vitest";
import { QrTool } from "@src/agent/tools/qr.js";

const tool = new QrTool();

describe("QrTool — data too long", () => {
  it("data > 60 bytes → Error 반환", async () => {
    const result = await tool.execute({ action: "generate", data: "A".repeat(61) });
    expect(result).toContain("too long");
  });
});

describe("QrTool — version >= 2 (18-60 bytes)", () => {
  it("18바이트 → version 2, alignment pattern 실행, SVG 반환", async () => {
    const result = await tool.execute({ action: "generate", data: "A".repeat(18) });
    expect(result).toContain("svg");
  });

  it("33바이트 → version 3, pad bytes 실행, text 반환", async () => {
    const result = await tool.execute({ action: "text", data: "A".repeat(33) });
    expect(result).toContain("text");
  });

  it("50바이트 → version 4, SVG 반환", async () => {
    const result = await tool.execute({ action: "generate", data: "A".repeat(50) });
    expect(result).toContain("svg");
  });
});
