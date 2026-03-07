import { describe, it, expect } from "vitest";
import { UuidTool } from "@src/agent/tools/uuid.js";

function make_tool(): UuidTool {
  return new UuidTool();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("UuidTool", () => {
  describe("generate", () => {
    it("v4 UUID 생성", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "generate" }));
      expect(result.uuid).toMatch(UUID_RE);
      expect(result.version).toBe(4);
      expect(result.uuid[14]).toBe("4");
    });

    it("v7 UUID 생성", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "generate", version: 7 }));
      expect(result.uuid).toMatch(UUID_RE);
      expect(result.version).toBe(7);
      expect(result.uuid[14]).toBe("7");
    });

    it("매번 다른 UUID 생성", async () => {
      const tool = make_tool();
      const a = JSON.parse(await tool.execute({ action: "generate" }));
      const b = JSON.parse(await tool.execute({ action: "generate" }));
      expect(a.uuid).not.toBe(b.uuid);
    });
  });

  describe("parse", () => {
    it("v4 UUID 파싱", async () => {
      const tool = make_tool();
      const gen = JSON.parse(await tool.execute({ action: "generate" }));
      const parsed = JSON.parse(await tool.execute({ action: "parse", uuid: gen.uuid }));
      expect(parsed.valid).toBe(true);
      expect(parsed.version).toBe(4);
      expect(parsed.variant).toBe("RFC4122");
    });

    it("v7 UUID → timestamp 포함", async () => {
      const before = Date.now();
      const tool = make_tool();
      const gen = JSON.parse(await tool.execute({ action: "generate", version: 7 }));
      const parsed = JSON.parse(await tool.execute({ action: "parse", uuid: gen.uuid }));
      expect(parsed.version).toBe(7);
      expect(parsed.timestamp).toBeGreaterThanOrEqual(before - 1000);
      expect(parsed.date).toBeTruthy();
    });

    it("nil UUID 인식", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", uuid: "00000000-0000-0000-0000-000000000000" }));
      expect(result.nil).toBe(true);
    });

    it("잘못된 형식 → valid: false", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", uuid: "not-a-uuid" }));
      expect(result.valid).toBe(false);
    });
  });

  describe("validate", () => {
    it("유효한 UUID", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "validate", uuid: "550e8400-e29b-41d4-a716-446655440000" }));
      expect(result.valid).toBe(true);
    });

    it("유효하지 않은 UUID", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "validate", uuid: "invalid" }));
      expect(result.valid).toBe(false);
    });
  });

  describe("batch", () => {
    it("기본 5개 생성", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "batch" }));
      expect(result.count).toBe(5);
      expect(result.uuids).toHaveLength(5);
      for (const u of result.uuids) expect(u).toMatch(UUID_RE);
    });

    it("지정 개수 생성", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "batch", count: 3 }));
      expect(result.count).toBe(3);
    });

    it("최대 100개 제한", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "batch", count: 200 }));
      expect(result.count).toBe(100);
    });

    it("v7 배치", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "batch", count: 2, version: 7 }));
      expect(result.version).toBe(7);
      for (const u of result.uuids) expect(u[14]).toBe("7");
    });
  });

  describe("nil", () => {
    it("nil UUID 반환", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "nil" }));
      expect(result.uuid).toBe("00000000-0000-0000-0000-000000000000");
    });
  });

  it("지원하지 않는 action → 에러", async () => {
    const result = await make_tool().execute({ action: "nope" });
    expect(result).toContain("unsupported action");
  });
});
