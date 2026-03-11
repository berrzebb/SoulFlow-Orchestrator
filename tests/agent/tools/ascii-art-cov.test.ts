/**
 * AsciiArtTool — 미커버 분기 (cov):
 * - L102: default case → unknown action → error JSON 반환
 */
import { describe, it, expect } from "vitest";
import { AsciiArtTool } from "@src/agent/tools/ascii-art.js";

const tool = new AsciiArtTool();

describe("AsciiArtTool — default case (L102)", () => {
  it("알 수 없는 action → error JSON 반환 (L102)", async () => {
    const result = String(await tool.execute({ action: "nonexistent_action" }));
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("unknown action");
    expect(parsed.error).toContain("nonexistent_action");
  });
});
