import { describe, it, expect } from "vitest";
import { UuidTool } from "@src/agent/tools/uuid.js";

const tool = new UuidTool();

describe("UuidTool — parse_uuid variant 분기 (L92/L93/L94)", () => {
  it("RFC4122 variant (8xxx) → L92 'RFC4122'", async () => {
    const result = JSON.parse(
      await tool.execute({ action: "parse", uuid: "12345678-1234-4234-8234-123456789abc" }),
    );
    expect(result.valid).toBe(true);
    expect(result.variant).toBe("RFC4122");
  });

  it("Microsoft variant (cxxx) → L93 'Microsoft'", async () => {
    const result = JSON.parse(
      await tool.execute({ action: "parse", uuid: "12345678-1234-4234-c234-123456789abc" }),
    );
    expect(result.valid).toBe(true);
    expect(result.variant).toBe("Microsoft");
  });

  it("Future variant (exxx) → L94 'Future'", async () => {
    const result = JSON.parse(
      await tool.execute({ action: "parse", uuid: "12345678-1234-4234-e234-123456789abc" }),
    );
    expect(result.valid).toBe(true);
    expect(result.variant).toBe("Future");
  });
});
