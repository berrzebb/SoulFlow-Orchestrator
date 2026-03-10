/**
 * UuidTool — generate/parse/validate/batch/nil 테스트.
 */
import { describe, it, expect } from "vitest";
import { UuidTool } from "../../../src/agent/tools/uuid.js";

const tool = new UuidTool();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("UuidTool — generate", () => {
  it("UUID v4 생성", async () => {
    const r = await exec({ action: "generate", version: 4 }) as Record<string, unknown>;
    expect(r.version).toBe(4);
    expect(UUID_RE.test(String(r.uuid))).toBe(true);
  });

  it("UUID v7 생성", async () => {
    const r = await exec({ action: "generate", version: 7 }) as Record<string, unknown>;
    expect(r.version).toBe(7);
    expect(UUID_RE.test(String(r.uuid))).toBe(true);
  });

  it("기본값은 v4", async () => {
    const r = await exec({ action: "generate" }) as Record<string, unknown>;
    expect(r.version).toBe(4);
  });

  it("매번 고유한 UUID 생성", async () => {
    const r1 = await exec({ action: "generate" }) as Record<string, unknown>;
    const r2 = await exec({ action: "generate" }) as Record<string, unknown>;
    expect(r1.uuid).not.toBe(r2.uuid);
  });
});

describe("UuidTool — validate", () => {
  it("유효한 UUID → valid: true", async () => {
    const r = await exec({ action: "validate", uuid: "550e8400-e29b-41d4-a716-446655440000" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("대문자 UUID도 유효", async () => {
    const r = await exec({ action: "validate", uuid: "550E8400-E29B-41D4-A716-446655440000" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("잘못된 UUID → valid: false", async () => {
    const r = await exec({ action: "validate", uuid: "not-a-uuid" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("빈 문자열 → valid: false", async () => {
    const r = await exec({ action: "validate", uuid: "" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });
});

describe("UuidTool — parse", () => {
  it("UUID v4 파싱 → version: 4", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const r = await exec({ action: "parse", uuid }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect(r.version).toBe(4);
    expect(r.variant).toBe("RFC4122");
  });

  it("NIL UUID 파싱 → nil: true", async () => {
    const r = await exec({ action: "parse", uuid: "00000000-0000-0000-0000-000000000000" }) as Record<string, unknown>;
    expect(r.nil).toBe(true);
  });

  it("잘못된 UUID → valid: false", async () => {
    const r = await exec({ action: "parse", uuid: "invalid" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect(r.error).toBeDefined();
  });
});

describe("UuidTool — batch", () => {
  it("5개 UUID 생성 (기본값)", async () => {
    const r = await exec({ action: "batch" }) as Record<string, unknown>;
    expect(r.count).toBe(5);
    expect((r.uuids as string[]).length).toBe(5);
    (r.uuids as string[]).forEach(u => expect(UUID_RE.test(u)).toBe(true));
  });

  it("지정한 개수 생성", async () => {
    const r = await exec({ action: "batch", count: 10 }) as Record<string, unknown>;
    expect(r.count).toBe(10);
    expect((r.uuids as string[]).length).toBe(10);
  });

  it("최대 100개 제한", async () => {
    const r = await exec({ action: "batch", count: 200 }) as Record<string, unknown>;
    expect(r.count).toBe(100);
  });

  it("v7 배치 생성", async () => {
    const r = await exec({ action: "batch", count: 3, version: 7 }) as Record<string, unknown>;
    expect(r.version).toBe(7);
    expect((r.uuids as string[]).length).toBe(3);
  });

  it("모든 UUID가 고유함", async () => {
    const r = await exec({ action: "batch", count: 20 }) as Record<string, unknown>;
    const uuids = r.uuids as string[];
    const unique = new Set(uuids);
    expect(unique.size).toBe(20);
  });
});

describe("UuidTool — nil", () => {
  it("NIL UUID 반환", async () => {
    const r = await exec({ action: "nil" }) as Record<string, unknown>;
    expect(r.uuid).toBe("00000000-0000-0000-0000-000000000000");
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("UuidTool — 미커버 분기", () => {
  it("unknown action → L50 Error", async () => {
    const r = await tool.execute({ action: "unknown_action" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("unsupported");
  });

  it("parse: v7 UUID → L99 timestamp/date 포함", async () => {
    // generate v7 first, then parse
    const v7 = await exec({ action: "generate", version: 7 }) as Record<string, unknown>;
    const r = await exec({ action: "parse", uuid: String(v7.uuid) }) as Record<string, unknown>;
    expect(r.version).toBe(7);
    expect(r.timestamp).toBeDefined();
    expect(r.date).toBeDefined();
  });

  it("parse: nil UUID → L104 nil=true", async () => {
    // nil UUID: 00000000-0000-0000-0000-000000000000 → result.nil = true
    const r = await exec({ action: "parse", uuid: "00000000-0000-0000-0000-000000000000" }) as Record<string, unknown>;
    expect(r.nil).toBe(true);
  });
});
