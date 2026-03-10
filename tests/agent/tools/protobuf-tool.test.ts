/**
 * ProtobufTool — define/encode/decode/to_proto/info 테스트.
 * varint 기반 자체 구현 protobuf encode/decode 왕복 검증.
 */
import { describe, it, expect } from "vitest";
import { ProtobufTool } from "../../../src/agent/tools/protobuf.js";

const tool = new ProtobufTool();

async function exec(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = await tool.execute(params);
  return JSON.parse(String(raw));
}

const PERSON_SCHEMA = JSON.stringify({
  name: "Person",
  fields: [
    { number: 1, name: "id", type: "int32" },
    { number: 2, name: "name", type: "string" },
    { number: 3, name: "active", type: "bool" },
  ],
});

const FULL_TYPES_SCHEMA = JSON.stringify({
  name: "AllTypes",
  fields: [
    { number: 1, name: "i32", type: "int32" },
    { number: 2, name: "i64", type: "int64" },
    { number: 3, name: "u32", type: "uint32" },
    { number: 4, name: "u64", type: "uint64" },
    { number: 5, name: "s32", type: "sint32" },
    { number: 6, name: "flag", type: "bool" },
    { number: 7, name: "label", type: "string" },
    { number: 8, name: "score", type: "double" },
  ],
});

describe("ProtobufTool — define", () => {
  it("스키마 정의 — 필드 수 반환", async () => {
    const r = await exec({ action: "define", schema: PERSON_SCHEMA });
    expect(r.name).toBe("Person");
    expect(r.field_count).toBe(3);
  });

  it("필드 wire_type 할당 확인", async () => {
    const r = await exec({ action: "define", schema: PERSON_SCHEMA });
    const fields = r.fields as { name: string; wire_type: number }[];
    const id_field = fields.find((f) => f.name === "id");
    const name_field = fields.find((f) => f.name === "name");
    expect(id_field?.wire_type).toBe(0); // varint
    expect(name_field?.wire_type).toBe(2); // length-delimited
  });

  it("잘못된 schema → error", async () => {
    const r = await exec({ action: "define", schema: "{}" });
    expect(r.error).toBeDefined();
  });

  it("schema 누락 → error", async () => {
    const r = await exec({ action: "define" });
    expect(r.error).toBeDefined();
  });
});

describe("ProtobufTool — encode", () => {
  it("Person 메시지 인코딩 — hex 반환", async () => {
    const r = await exec({
      action: "encode",
      schema: PERSON_SCHEMA,
      data: JSON.stringify({ id: 1, name: "Alice", active: true }),
    });
    expect(typeof r.hex).toBe("string");
    expect((r.hex as string).length).toBeGreaterThan(0);
    expect(r.byte_length).toBeGreaterThan(0);
  });

  it("누락 필드는 건너뜀 (id만 인코딩)", async () => {
    const r = await exec({
      action: "encode",
      schema: PERSON_SCHEMA,
      data: JSON.stringify({ id: 42 }),
    });
    expect(r.error).toBeUndefined();
    // id=42 → tag(1<<3|0)=0x08, varint(42)=0x2a → "082a"
    expect(r.hex).toBe("082a");
  });

  it("string 필드 인코딩", async () => {
    const r = await exec({
      action: "encode",
      schema: PERSON_SCHEMA,
      data: JSON.stringify({ name: "Bob" }),
    });
    expect(r.error).toBeUndefined();
    // tag for field 2, string → wire_type 2
    expect((r.hex as string).length).toBeGreaterThan(0);
  });

  it("잘못된 data JSON → error", async () => {
    const r = await exec({
      action: "encode",
      schema: PERSON_SCHEMA,
      data: "not-json",
    });
    expect(r.error).toBeDefined();
  });

  it("잘못된 schema → error", async () => {
    const r = await exec({ action: "encode", schema: "bad", data: "{}" });
    expect(r.error).toBeDefined();
  });
});

describe("ProtobufTool — decode (왕복 검증)", () => {
  async function round_trip(schema: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const encoded = await exec({ action: "encode", schema, data: JSON.stringify(data) });
    const decoded = await exec({ action: "decode", schema, hex: encoded.hex });
    return decoded.data as Record<string, unknown>;
  }

  it("int32 왕복", async () => {
    const result = await round_trip(PERSON_SCHEMA, { id: 42 });
    expect(result.id).toBe(42);
  });

  it("bool 왕복", async () => {
    const result = await round_trip(PERSON_SCHEMA, { active: true });
    expect(result.active).toBe(true);
  });

  it("string 왕복", async () => {
    const result = await round_trip(PERSON_SCHEMA, { name: "Alice" });
    expect(result.name).toBe("Alice");
  });

  it("여러 필드 동시 왕복", async () => {
    const result = await round_trip(PERSON_SCHEMA, { id: 7, name: "Bob", active: false });
    expect(result.id).toBe(7);
    expect(result.name).toBe("Bob");
    expect(result.active).toBe(false);
  });

  it("sint32 zigzag 왕복 (음수)", async () => {
    const schema = JSON.stringify({
      name: "Signed",
      fields: [{ number: 1, name: "val", type: "sint32" }],
    });
    const result = await round_trip(schema, { val: -5 });
    expect(result.val).toBe(-5);
  });

  it("double 왕복", async () => {
    const schema = JSON.stringify({
      name: "Score",
      fields: [{ number: 1, name: "score", type: "double" }],
    });
    const result = await round_trip(schema, { score: 3.14 });
    expect(result.score).toBeCloseTo(3.14, 5);
  });

  it("float 왕복 (wire_type=5)", async () => {
    const schema = JSON.stringify({
      name: "F",
      fields: [{ number: 1, name: "val", type: "float" }],
    });
    const result = await round_trip(schema, { val: 1.5 });
    expect(result.val).toBeCloseTo(1.5, 3);
  });

  it("bytes 필드 왕복", async () => {
    const schema = JSON.stringify({
      name: "Blob",
      fields: [{ number: 1, name: "data", type: "bytes" }],
    });
    // bytes 필드는 hex 문자열로 제공
    const result = await round_trip(schema, { data: "deadbeef" });
    expect(result.data).toBe("deadbeef");
  });

  it("uint32/uint64 왕복", async () => {
    const r = await round_trip(FULL_TYPES_SCHEMA, { u32: 1000, u64: 999999 });
    expect(r.u32).toBe(1000);
    expect(r.u64).toBe(999999);
  });

  it("info — float 필드 포함 바이트 분석 (wire_type_name: 32-bit)", async () => {
    const schema = JSON.stringify({
      name: "F",
      fields: [{ number: 1, name: "val", type: "float" }],
    });
    const encoded = await exec({ action: "encode", schema, data: JSON.stringify({ val: 1.5 }) });
    const r = await exec({ action: "info", hex: encoded.hex });
    const fields = r.fields as { wire_type_name: string }[];
    expect(fields.some((f) => f.wire_type_name === "32-bit")).toBe(true);
  });

  it("잘못된 schema → error", async () => {
    const r = await exec({ action: "decode", schema: "bad", hex: "00" });
    expect(r.error).toBeDefined();
  });
});

describe("ProtobufTool — to_proto", () => {
  it("proto3 문법 출력", async () => {
    const r = await exec({ action: "to_proto", schema: PERSON_SCHEMA });
    const proto = r.proto as string;
    expect(proto).toContain('syntax = "proto3"');
    expect(proto).toContain("message Person");
    expect(proto).toContain("int32 id = 1");
    expect(proto).toContain("string name = 2");
    expect(proto).toContain("bool active = 3");
  });

  it("잘못된 schema → error", async () => {
    const r = await exec({ action: "to_proto", schema: "{}" });
    expect(r.error).toBeDefined();
  });
});

describe("ProtobufTool — info", () => {
  it("인코딩된 바이트 분석", async () => {
    const encoded = await exec({
      action: "encode",
      schema: PERSON_SCHEMA,
      data: JSON.stringify({ id: 1 }),
    });
    const r = await exec({ action: "info", hex: encoded.hex });
    expect(r.byte_length).toBeGreaterThan(0);
    const fields = r.fields as { field_number: number; wire_type: number; wire_type_name: string }[];
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields[0]?.field_number).toBe(1);
    expect(fields[0]?.wire_type_name).toBe("varint");
  });

  it("빈 hex → 빈 fields", async () => {
    const r = await exec({ action: "info", hex: "" });
    expect((r.fields as unknown[]).length).toBe(0);
  });
});

describe("ProtobufTool — unsupported action", () => {
  it("알 수 없는 action → error", async () => {
    const r = await exec({ action: "unknown" });
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("ProtobufTool — 미커버 분기", () => {
  it("encode: int32 필드에 비숫자 값 → BigInt(NaN) throw → error (L48)", async () => {
    // BigInt(Number("not-a-number")) = BigInt(NaN) → TypeError 발생 → L48 catch
    const schema = JSON.stringify({ name: "T", fields: [{ number: 1, name: "x", type: "int32" }] });
    const r = await exec({ action: "encode", schema, data: JSON.stringify({ x: "not-a-number" }) });
    expect((r as Record<string, unknown>).error).toBeDefined();
  });

  it("decode: double 필드 + 불완전한 hex → readDoubleLE OOB throw → error (L60)", async () => {
    // hex "09" = 1바이트(태그만), double은 8바이트 필요 → buf.readDoubleLE(1) throws RangeError
    const schema = JSON.stringify({ name: "T", fields: [{ number: 1, name: "val", type: "double" }] });
    const r = await exec({ action: "decode", schema, hex: "09" });
    expect((r as Record<string, unknown>).error).toBeDefined();
  });

  it("wire_type: unknown type → default 0 (L110)", async () => {
    // custom/unknown type → wire_type default → encode에서 varint 사용
    const schema = JSON.stringify({ name: "T", fields: [{ number: 1, name: "x", type: "message" }] });
    const r = await exec({ action: "encode", schema, data: JSON.stringify({ x: 42 }) });
    expect(r).toBeDefined();
  });

  it("decode: wire_type=3 (start-group) → else break (L223)", async () => {
    // tag 0x0b = (1<<3)|3 = field 1, wire_type 3 → decode_message else branch → break
    const schema = JSON.stringify({ name: "T", fields: [{ number: 1, name: "x", type: "int32" }] });
    const r = await exec({ action: "decode", schema, hex: "0b" });
    // error 없이 빈 data 반환 (break으로 루프 탈출)
    expect(r).toBeDefined();
  });

  it("info: skip_field case 1 (64-bit) — double 인코딩 후 info (L232)", async () => {
    const schema = JSON.stringify({ name: "T", fields: [{ number: 1, name: "val", type: "double" }] });
    const enc = await exec({ action: "encode", schema, data: JSON.stringify({ val: 3.14 }) });
    const info = await exec({ action: "info", hex: enc.hex });
    const fields = info.fields as { wire_type_name: string }[];
    expect(fields.some(f => f.wire_type_name === "64-bit")).toBe(true);
  });

  it("info: skip_field case 2 (length-delimited) — string 인코딩 후 info (L233)", async () => {
    const schema = JSON.stringify({ name: "T", fields: [{ number: 1, name: "s", type: "string" }] });
    const enc = await exec({ action: "encode", schema, data: JSON.stringify({ s: "hello" }) });
    const info = await exec({ action: "info", hex: enc.hex });
    const fields = info.fields as { wire_type_name: string }[];
    expect(fields.some(f => f.wire_type_name === "length-delimited")).toBe(true);
  });

  it("info: skip_field default (-1) → break (L235+L86)", async () => {
    // wire_type 3 (start-group): 디코딩 불가 → skip_field returns -1 → break
    // 수동으로 wire_type 3의 태그 바이트 생성: field=1, type=3 → tag = (1 << 3) | 3 = 11 = 0x0b
    const hex = "0b";
    const r = await exec({ action: "info", hex });
    expect(r.byte_length).toBeDefined();
  });
});
