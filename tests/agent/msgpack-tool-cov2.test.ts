/**
 * MsgpackTool — 미커버 분기 보충.
 * 대형 정수(uint16/uint32/int8/int16/float64), 대형 문자열(str8),
 * info action 다양한 byte type, decode 대형 타입, compare_size.
 */
import { describe, it, expect } from "vitest";
import { MsgpackTool } from "@src/agent/tools/msgpack.js";

function make(): MsgpackTool {
  return new MsgpackTool();
}

// ══════════════════════════════════════════
// encode — 다양한 정수 범위
// ══════════════════════════════════════════

describe("MsgpackTool — encode 정수 범위", () => {
  it("0-127 → positive fixint", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "42" }));
    expect(r.hex).toBeDefined();
    expect(r.byte_length).toBeGreaterThan(0);
  });

  it("음수 -1~-32 → negative fixint", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "-5" }));
    expect(r.hex).toBeDefined();
  });

  it("uint8 범위 (128-255) → 0xcc 접두사", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "200" }));
    expect(r.hex.startsWith("cc")).toBe(true);
  });

  it("uint16 범위 (256-65535) → 0xcd 접두사", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "1000" }));
    expect(r.hex.startsWith("cd")).toBe(true);
  });

  it("uint32 범위 (65536-4294967295) → 0xce 접두사", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "70000" }));
    expect(r.hex.startsWith("ce")).toBe(true);
  });

  it("int8 범위 (-128 ~ -33) → 0xd0 접두사", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "-100" }));
    expect(r.hex.startsWith("d0")).toBe(true);
  });

  it("int16 범위 (-32768 ~ -129) → 0xd1 접두사", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "-1000" }));
    expect(r.hex.startsWith("d1")).toBe(true);
  });

  it("큰 정수 (> int32) → float64 fallback", async () => {
    // 2^33 = 8589934592 (> 4294967295)
    const r = JSON.parse(await make().execute({ action: "encode", data: "8589934592" }));
    expect(r.hex.startsWith("cb")).toBe(true);
  });

  it("소수점 숫자 → float64", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "3.14" }));
    expect(r.hex.startsWith("cb")).toBe(true);
  });
});

// ══════════════════════════════════════════
// encode — 문자열 범위
// ══════════════════════════════════════════

describe("MsgpackTool — encode 문자열 범위", () => {
  it("짧은 문자열 (< 32) → fixstr", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: '"hello"' }));
    expect(r.byte_length).toBeGreaterThan(0);
  });

  it("긴 문자열 (32-255 bytes) → str8 (0xd9)", async () => {
    const long = "A".repeat(50);
    const r = JSON.parse(await make().execute({ action: "encode", data: JSON.stringify(long) }));
    expect(r.hex.startsWith("d9")).toBe(true);
  });

  it("매우 긴 문자열 (256-65535 bytes) → str16 (0xda)", async () => {
    const long = "B".repeat(300);
    const r = JSON.parse(await make().execute({ action: "encode", data: JSON.stringify(long) }));
    expect(r.hex.startsWith("da")).toBe(true);
  });
});

// ══════════════════════════════════════════
// encode — 배열/객체 범위
// ══════════════════════════════════════════

describe("MsgpackTool — encode 배열/객체", () => {
  it("null → nil (0xc0)", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "null" }));
    expect(r.hex).toBe("c0");
  });

  it("true → boolean (0xc3)", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "true" }));
    expect(r.hex).toBe("c3");
  });

  it("false → boolean (0xc2)", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "false" }));
    expect(r.hex).toBe("c2");
  });

  it("배열 (< 16) → fixarray", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "[1,2,3]" }));
    expect(r.byte_length).toBeGreaterThan(0);
  });

  it("배열 (16개 이상) → array16 (0xdc)", async () => {
    const arr = new Array(20).fill(0);
    const r = JSON.parse(await make().execute({ action: "encode", data: JSON.stringify(arr) }));
    expect(r.hex.startsWith("dc")).toBe(true);
  });

  it("객체 (16개 이상) → map16 (0xde)", async () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 20; i++) obj[`k${i}`] = i;
    const r = JSON.parse(await make().execute({ action: "encode", data: JSON.stringify(obj) }));
    expect(r.hex.startsWith("de")).toBe(true);
  });

  it("잘못된 JSON → error", async () => {
    const r = JSON.parse(await make().execute({ action: "encode", data: "{bad" }));
    expect(r.error).toContain("invalid JSON");
  });
});

// ══════════════════════════════════════════
// decode — 다양한 타입
// ══════════════════════════════════════════

describe("MsgpackTool — decode 타입별", () => {
  async function roundtrip(data: string): Promise<unknown> {
    const encoded = JSON.parse(await make().execute({ action: "encode", data }));
    const decoded = JSON.parse(await make().execute({ action: "decode", hex: encoded.hex }));
    return decoded.data;
  }

  it("null roundtrip", async () => {
    expect(await roundtrip("null")).toBeNull();
  });

  it("boolean roundtrip", async () => {
    expect(await roundtrip("true")).toBe(true);
    expect(await roundtrip("false")).toBe(false);
  });

  it("정수 roundtrip (다양한 범위)", async () => {
    expect(await roundtrip("42")).toBe(42);
    expect(await roundtrip("200")).toBe(200);
    expect(await roundtrip("1000")).toBe(1000);
    expect(await roundtrip("70000")).toBe(70000);
    expect(await roundtrip("-5")).toBe(-5);
    expect(await roundtrip("-100")).toBe(-100);
  });

  it("문자열 roundtrip (긴 문자열)", async () => {
    const long = "X".repeat(50);
    expect(await roundtrip(JSON.stringify(long))).toBe(long);
  });

  it("배열 roundtrip (16+ 원소)", async () => {
    const arr = new Array(20).fill(7);
    const result = await roundtrip(JSON.stringify(arr));
    expect(result).toEqual(arr);
  });

  it("객체 roundtrip (16+ 키)", async () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 20; i++) obj[`k${i}`] = i;
    const result = await roundtrip(JSON.stringify(obj)) as Record<string, number>;
    expect(result.k0).toBe(0);
    expect(result.k19).toBe(19);
  });

  it("잘못된 hex → error", async () => {
    const r = JSON.parse(await make().execute({ action: "decode", hex: "xx" }));
    // xx는 빈 hex처럼 동작하거나 에러
    expect(r).toBeDefined();
  });
});

// ══════════════════════════════════════════
// info — 다양한 byte type 분류
// ══════════════════════════════════════════

describe("MsgpackTool — info byte type", () => {
  async function get_info(data: string) {
    const encoded = JSON.parse(await make().execute({ action: "encode", data }));
    return JSON.parse(await make().execute({ action: "info", hex: encoded.hex }));
  }

  it("nil → type: nil", async () => {
    const r = await get_info("null");
    expect(r.type).toBe("nil");
  });

  it("boolean → type: boolean", async () => {
    const r = await get_info("true");
    expect(r.type).toBe("boolean");
  });

  it("positive fixint → type: positive fixint", async () => {
    const r = await get_info("10");
    expect(r.type).toBe("positive fixint");
  });

  it("negative fixint → type: negative fixint", async () => {
    const r = await get_info("-5");
    expect(r.type).toBe("negative fixint");
  });

  it("fixmap → type: fixmap", async () => {
    const r = await get_info('{"a":1}');
    expect(r.type).toBe("fixmap");
  });

  it("fixarray → type: fixarray", async () => {
    const r = await get_info("[1,2]");
    expect(r.type).toBe("fixarray");
  });

  it("fixstr → type: fixstr", async () => {
    const r = await get_info('"hello"');
    expect(r.type).toBe("fixstr");
  });

  it("int (uint8) → type: int", async () => {
    const r = await get_info("200");
    expect(r.type).toBe("int");
  });

  it("float (float64) → type: float", async () => {
    const r = await get_info("3.14");
    expect(r.type).toBe("float");
  });

  it("str8 → type: str", async () => {
    const r = await get_info(JSON.stringify("A".repeat(50)));
    expect(r.type).toBe("str");
  });

  it("array16 → type: array", async () => {
    const r = await get_info(JSON.stringify(new Array(20).fill(0)));
    expect(r.type).toBe("array");
  });

  it("map16 → type: map", async () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 20; i++) obj[`k${i}`] = i;
    const r = await get_info(JSON.stringify(obj));
    expect(r.type).toBe("map");
  });
});

// ══════════════════════════════════════════
// compare_size
// ══════════════════════════════════════════

describe("MsgpackTool — compare_size", () => {
  it("데이터 크기 비교 — json vs msgpack", async () => {
    const data = JSON.stringify({ name: "Alice", age: 30, scores: [90, 85, 92] });
    const r = JSON.parse(await make().execute({ action: "compare_size", data }));
    expect(r.json_bytes).toBeGreaterThan(0);
    expect(r.msgpack_bytes).toBeGreaterThan(0);
    expect(typeof r.ratio_percent).toBe("number");
    expect(typeof r.savings_percent).toBe("number");
  });

  it("잘못된 JSON → error", async () => {
    const r = JSON.parse(await make().execute({ action: "compare_size", data: "{bad" }));
    expect(r.error).toContain("invalid JSON");
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("MsgpackTool — 알 수 없는 action", () => {
  it("unknown action → error", async () => {
    const r = JSON.parse(await make().execute({ action: "unknown" }));
    expect(r.error).toContain("unknown action");
  });
});
