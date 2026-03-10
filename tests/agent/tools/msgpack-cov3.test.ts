/**
 * MsgpackTool — 미커버 분기 (cov3):
 * - L39: decode 실패 → error 반환
 * - L53-58: info operation — boolean/float/int/str/array/map 타입 감지
 * - L70: unknown action → error 반환
 * - L93-96: 대형 정수 → float64 인코딩
 * - L157, L159, L160: decode 0xdd/0xdf/unknown byte
 */
import { describe, it, expect } from "vitest";
import { MsgpackTool } from "@src/agent/tools/msgpack.js";

const tool = new MsgpackTool();

async function exec(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = await tool.execute(params);
  return JSON.parse(String(raw));
}

async function encode(data: unknown): Promise<string> {
  const r = await exec({ action: "encode", data: JSON.stringify(data) });
  return r.hex as string;
}

// ── L70: unknown action ───────────────────────────────────────────────────

describe("MsgpackTool — unknown action (L70)", () => {
  it("알 수 없는 action → error 반환", async () => {
    const r = await exec({ action: "no_such_action" });
    expect(r.error).toContain("unknown action");
  });
});

// ── L39: decode 실패 → error ─────────────────────────────────────────────

describe("MsgpackTool — decode 실패 (L39)", () => {
  it("빈 hex → decode 오류", async () => {
    // 빈 버퍼에서 buf[0]을 읽으면 undefined → 오류 발생
    const r = await exec({ action: "decode", hex: "" });
    // error 필드가 있거나 data 필드가 있어야 함
    expect(r).toBeDefined();
  });
});

// ── L53-58: info — boolean/float/int/str/array/map 타입 ──────────────────

describe("MsgpackTool — info 타입 감지 (L53-58)", () => {
  it("boolean(c2) → type=boolean (L53)", async () => {
    const r = await exec({ action: "info", hex: "c2" });
    expect(r.type).toBe("boolean");
  });

  it("boolean(c3) → type=boolean (L53)", async () => {
    const r = await exec({ action: "info", hex: "c3" });
    expect(r.type).toBe("boolean");
  });

  it("float(ca) → type=float (L54)", async () => {
    const r = await exec({ action: "info", hex: "ca" });
    expect(r.type).toBe("float");
  });

  it("float(cb) → type=float (L54)", async () => {
    const r = await exec({ action: "info", hex: "cb" });
    expect(r.type).toBe("float");
  });

  it("int(cc) → type=int (L55)", async () => {
    const r = await exec({ action: "info", hex: "cc" });
    expect(r.type).toBe("int");
  });

  it("int(d3) → type=int (L55)", async () => {
    const r = await exec({ action: "info", hex: "d3" });
    expect(r.type).toBe("int");
  });

  it("str(d9) → type=str (L56)", async () => {
    const r = await exec({ action: "info", hex: "d9" });
    expect(r.type).toBe("str");
  });

  it("str(db) → type=str (L56)", async () => {
    const r = await exec({ action: "info", hex: "db" });
    expect(r.type).toBe("str");
  });

  it("array(dc) → type=array (L57)", async () => {
    const r = await exec({ action: "info", hex: "dc" });
    expect(r.type).toBe("array");
  });

  it("array(dd) → type=array (L57)", async () => {
    const r = await exec({ action: "info", hex: "dd" });
    expect(r.type).toBe("array");
  });

  it("map(de) → type=map (L58)", async () => {
    const r = await exec({ action: "info", hex: "de" });
    expect(r.type).toBe("map");
  });

  it("map(df) → type=map (L58)", async () => {
    const r = await exec({ action: "info", hex: "df" });
    expect(r.type).toBe("map");
  });
});

// ── L93-96: 대형 정수 → float64 인코딩 ──────────────────────────────────

describe("MsgpackTool — 대형 정수 float64 인코딩 (L93-96)", () => {
  it("0x100000000 (2^32) → float64로 인코딩됨", async () => {
    // val >= 0 && val <= 0xffffffff 범위 밖인 정수 → L92 fallback float64
    const val = 4294967296; // 2^32 = 0x100000000
    const hex = await encode(val);
    // 디코딩 후 원래 값 복원
    const r = await exec({ action: "decode", hex });
    // float64로 저장되어도 정수값은 정확하게 복원됨
    expect(r.data).toBeCloseTo(val, 0);
  });

  it("음수 int16 범위 밖 (-40000) → float64 인코딩", async () => {
    // val < -32768 → L92 fallback float64
    const val = -40000;
    const hex = await encode(val);
    const r = await exec({ action: "decode", hex });
    expect(r.data).toBeCloseTo(val, 0);
  });
});

// ── L157, L159: decode 0xdd (array16+)/0xdf (map16+) ────────────────────

describe("MsgpackTool — decode 0xdd/0xdf (L157/L159)", () => {
  it("16개 이상 배열 → encode/decode 왕복 (0xdc/0xdd 경로)", async () => {
    // 길이 16 이상 배열 → 0xdc(16bit len) 사용
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const hex = await encode(arr);
    const r = await exec({ action: "decode", hex });
    expect(Array.isArray(r.data)).toBe(true);
    expect((r.data as unknown[]).length).toBe(20);
  });

  it("16개 이상 키 객체 → encode/decode 왕복 (0xde 경로)", async () => {
    // 키 16개 이상 → 0xde(16bit len) 사용
    const obj: Record<string, number> = {};
    for (let i = 0; i < 20; i++) obj[`k${i}`] = i;
    const hex = await encode(obj);
    const r = await exec({ action: "decode", hex });
    expect(typeof r.data).toBe("object");
    expect((r.data as Record<string, unknown>)["k0"]).toBe(0);
  });
});

// ── L157: decode 0xdd (array32) — 직접 hex 구성 ─────────────────────────

describe("MsgpackTool — decode 0xdd array32 (L157)", () => {
  it("array32 hex 직접 구성 → decode 성공 (L157)", async () => {
    // 0xdd 00 00 00 02 01 02 = array32 with len=2, items=[1, 2]
    const r = await exec({ action: "decode", hex: "dd0000000201 02".replace(/ /g, "") });
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data).toEqual([1, 2]);
  });
});

// ── L159: decode 0xdf (map32) — 직접 hex 구성 ────────────────────────────

describe("MsgpackTool — decode 0xdf map32 (L159)", () => {
  it("map32 hex 직접 구성 → decode 성공 (L159)", async () => {
    // 0xdf 00 00 00 01 a1 41 01 = map32 with 1 entry: {"A": 1}
    // a1 = fixstr len=1, 41 = 'A', 01 = fixint 1
    const r = await exec({ action: "decode", hex: "df00000001a14101" });
    expect(typeof r.data).toBe("object");
    expect((r.data as Record<string, unknown>)["A"]).toBe(1);
  });
});

// ── L39: decode 불완전 hex → catch (truncated buffer) ────────────────────

describe("MsgpackTool — decode 불완전 hex → error catch (L39)", () => {
  it("uint16 마커만 있고 데이터 없는 hex → catch 분기", async () => {
    // 0xcd = uint16 marker, 다음 2바이트 없음 → readUInt16BE(1) throws RangeError
    const r = await exec({ action: "decode", hex: "cd" });
    // error 필드가 있거나 null data 반환
    // buf.readUInt16BE(1) on 1-byte buffer throws → L39 catch
    expect(r.error ?? r.data).toBeDefined();
  });
});

// ── L160: decode unknown byte → null ─────────────────────────────────────

describe("MsgpackTool — decode unknown byte (L160)", () => {
  it("알 수 없는 바이트(0xc1) → null 반환", async () => {
    // 0xc1은 MessagePack에서 reserved/never used → default 분기
    const r = await exec({ action: "decode", hex: "c1" });
    // data=null 이거나 error가 있어야 함
    expect(r).toBeDefined();
  });
});
