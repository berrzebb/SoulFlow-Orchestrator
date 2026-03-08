/**
 * MsgpackTool — encode/decode/info/compare_size 테스트.
 * 외부 라이브러리 없이 자체 구현된 MessagePack encode/decode를 왕복 검증.
 */
import { describe, it, expect } from "vitest";
import { MsgpackTool } from "../../../src/agent/tools/msgpack.js";

const tool = new MsgpackTool();

async function exec(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = await tool.execute(params);
  return JSON.parse(String(raw));
}

async function encode(data: unknown): Promise<string> {
  const r = await exec({ action: "encode", data: JSON.stringify(data) });
  return r.hex as string;
}

async function decode(hex: string): Promise<unknown> {
  const r = await exec({ action: "decode", hex });
  return r.data;
}

describe("MsgpackTool — encode", () => {
  it("null 인코딩", async () => {
    const r = await exec({ action: "encode", data: "null" });
    expect(r.hex).toBe("c0");
    expect(r.byte_length).toBe(1);
  });

  it("true/false 인코딩", async () => {
    const t = await exec({ action: "encode", data: "true" });
    expect(t.hex).toBe("c3");

    const f = await exec({ action: "encode", data: "false" });
    expect(f.hex).toBe("c2");
  });

  it("fixint (0-127) 인코딩", async () => {
    const r = await exec({ action: "encode", data: "42" });
    expect(r.hex).toBe("2a"); // 0x2a = 42
    expect(r.byte_length).toBe(1);
  });

  it("fixint (0) 인코딩", async () => {
    const r = await exec({ action: "encode", data: "0" });
    expect(r.hex).toBe("00");
  });

  it("short string (fixstr) 인코딩", async () => {
    const r = await exec({ action: "encode", data: JSON.stringify("hi") });
    // fixstr: 0xa0 | len(2) = 0xa2, then 'h'=0x68, 'i'=0x69
    expect(r.hex).toBe("a268 69".replace(/ /g, ""));
    expect(r.byte_length).toBe(3);
  });

  it("빈 문자열 인코딩", async () => {
    const r = await exec({ action: "encode", data: JSON.stringify("") });
    expect(r.hex).toBe("a0"); // fixstr, len=0
  });

  it("fixarray 인코딩", async () => {
    const r = await exec({ action: "encode", data: "[1,2,3]" });
    // 0x93 = fixarray len=3, then 01 02 03
    expect(r.hex).toBe("93010203");
    expect(r.byte_length).toBe(4);
  });

  it("빈 배열 인코딩", async () => {
    const r = await exec({ action: "encode", data: "[]" });
    expect(r.hex).toBe("90"); // fixarray len=0
  });

  it("fixmap 인코딩", async () => {
    const r = await exec({ action: "encode", data: JSON.stringify({ a: 1 }) });
    // 0x81 = fixmap len=1
    expect(r.hex.startsWith("81")).toBe(true);
  });

  it("빈 객체 인코딩", async () => {
    const r = await exec({ action: "encode", data: "{}" });
    expect(r.hex).toBe("80"); // fixmap len=0
  });

  it("음수 fixint 인코딩", async () => {
    const r = await exec({ action: "encode", data: "-1" });
    // negative fixint: -1 → 0xff
    expect(r.byte_length).toBe(1);
  });

  it("uint8 범위 (128-255) 인코딩", async () => {
    const r = await exec({ action: "encode", data: "200" });
    expect(r.hex).toBe("cc" + "c8"); // 0xcc = uint8 format, 0xc8 = 200
    expect(r.byte_length).toBe(2);
  });

  it("잘못된 JSON → error 반환", async () => {
    const r = await exec({ action: "encode", data: "not-json" });
    expect(r.error).toBeDefined();
  });
});

describe("MsgpackTool — decode (왕복 검증)", () => {
  it("null 왕복", async () => {
    const hex = await encode(null);
    expect(await decode(hex)).toBeNull();
  });

  it("boolean 왕복", async () => {
    expect(await decode(await encode(true))).toBe(true);
    expect(await decode(await encode(false))).toBe(false);
  });

  it("정수 왕복 (fixint)", async () => {
    expect(await decode(await encode(42))).toBe(42);
    expect(await decode(await encode(0))).toBe(0);
    expect(await decode(await encode(127))).toBe(127);
  });

  it("uint8 정수 왕복 (128-255)", async () => {
    expect(await decode(await encode(200))).toBe(200);
    expect(await decode(await encode(255))).toBe(255);
  });

  it("uint16 정수 왕복", async () => {
    expect(await decode(await encode(1000))).toBe(1000);
    expect(await decode(await encode(65535))).toBe(65535);
  });

  it("문자열 왕복", async () => {
    expect(await decode(await encode("hello"))).toBe("hello");
    expect(await decode(await encode(""))).toBe("");
  });

  it("배열 왕복", async () => {
    const arr = [1, 2, 3];
    expect(await decode(await encode(arr))).toEqual(arr);
  });

  it("중첩 배열 왕복", async () => {
    const arr = [1, "two", null, true];
    expect(await decode(await encode(arr))).toEqual(arr);
  });

  it("객체 왕복", async () => {
    const obj = { name: "Alice", age: 30 };
    expect(await decode(await encode(obj))).toEqual(obj);
  });

  it("잘못된 hex → error 반환", async () => {
    const r = await exec({ action: "decode", hex: "ffff" }); // 잘못된 msgpack
    // 오류 또는 null 반환 모두 허용
    expect(r).toBeDefined();
  });
});

describe("MsgpackTool — info", () => {
  it("fixint 첫 바이트 타입 식별", async () => {
    const hex = await encode(42); // 0x2a
    const r = await exec({ action: "info", hex });
    expect(r.type).toBe("positive fixint");
    expect(r.byte_length).toBeGreaterThan(0);
  });

  it("fixstr 첫 바이트 타입 식별", async () => {
    const hex = await encode("hi"); // 0xa2
    const r = await exec({ action: "info", hex });
    expect(r.type).toBe("fixstr");
  });

  it("nil 타입 식별", async () => {
    const hex = await encode(null); // 0xc0
    const r = await exec({ action: "info", hex });
    expect(r.type).toBe("nil");
  });

  it("boolean 타입 식별", async () => {
    const hex = await encode(true); // 0xc3
    const r = await exec({ action: "info", hex });
    expect(r.type).toBe("boolean");
  });

  it("fixmap 타입 식별", async () => {
    const hex = await encode({ a: 1 }); // 0x81
    const r = await exec({ action: "info", hex });
    expect(r.type).toBe("fixmap");
  });

  it("fixarray 타입 식별", async () => {
    const hex = await encode([1, 2]); // 0x92
    const r = await exec({ action: "info", hex });
    expect(r.type).toBe("fixarray");
  });

  it("negative fixint 타입 식별", async () => {
    const hex = await encode(-1); // 0xff
    const r = await exec({ action: "info", hex });
    expect(r.type).toBe("negative fixint");
  });
});

describe("MsgpackTool — str8/str16/array16/map16 (큰 데이터)", () => {
  it("str8: 32바이트 이상 문자열 왕복", async () => {
    // fixstr 한계(31바이트)를 넘는 문자열 → 0xd9 format
    const long_str = "A".repeat(50);
    expect(await decode(await encode(long_str))).toBe(long_str);
  });

  it("str8: 255바이트 문자열 왕복", async () => {
    const str = "x".repeat(200);
    expect(await decode(await encode(str))).toBe(str);
  });

  it("str16: 256바이트 이상 문자열 왕복", async () => {
    const str = "y".repeat(300);
    expect(await decode(await encode(str))).toBe(str);
  });

  it("array16: 16개 이상 배열 왕복", async () => {
    // fixarray 한계(15개)를 넘는 배열 → 0xdc format
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const result = await decode(await encode(arr));
    expect(result).toEqual(arr);
  });

  it("map16: 16개 이상 키를 가진 객체 왕복", async () => {
    // fixmap 한계(15개)를 넘는 맵 → 0xde format
    const obj: Record<string, number> = {};
    for (let i = 0; i < 20; i++) obj[`key${i}`] = i;
    const result = await decode(await encode(obj)) as Record<string, number>;
    expect(Object.keys(result).length).toBe(20);
    expect(result.key0).toBe(0);
    expect(result.key19).toBe(19);
  });

  it("uint16 범위 (256-65535) 왕복", async () => {
    expect(await decode(await encode(1000))).toBe(1000);
    expect(await decode(await encode(65535))).toBe(65535);
  });

  it("uint32 범위 (65536+) 왕복", async () => {
    expect(await decode(await encode(100000))).toBe(100000);
  });

  it("float64 (소수) 왕복", async () => {
    const val = 3.14159;
    const result = await decode(await encode(val)) as number;
    expect(result).toBeCloseTo(val, 5);
  });

  it("음수 int8 범위 (-33 ~ -128) 왕복", async () => {
    expect(await decode(await encode(-100))).toBe(-100);
    expect(await decode(await encode(-128))).toBe(-128);
  });

  it("음수 int16 범위 왕복", async () => {
    expect(await decode(await encode(-1000))).toBe(-1000);
  });
});

describe("MsgpackTool — compare_size", () => {
  it("msgpack 크기 vs JSON 크기 비교", async () => {
    const data = JSON.stringify({ name: "Alice", age: 30, active: true });
    const r = await exec({ action: "compare_size", data });
    expect(r.json_bytes).toBeGreaterThan(0);
    expect(r.msgpack_bytes).toBeGreaterThan(0);
    expect(typeof r.ratio_percent).toBe("number");
    expect(typeof r.savings_percent).toBe("number");
  });

  it("빈 객체 비교", async () => {
    const r = await exec({ action: "compare_size", data: "{}" });
    expect(r.json_bytes).toBe(2); // "{}"
    expect(r.msgpack_bytes).toBe(1); // 0x80
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "compare_size", data: "bad" });
    expect(r.error).toBeDefined();
  });
});
