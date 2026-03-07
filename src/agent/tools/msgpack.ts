/** MessagePack 도구 — MessagePack 바이너리 encode/decode. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class MsgpackTool extends Tool {
  readonly name = "msgpack";
  readonly category = "data" as const;
  readonly description = "MessagePack utilities: encode, decode, info, compare_size.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["encode", "decode", "info", "compare_size"], description: "Operation" },
      data: { type: "string", description: "JSON data to encode" },
      hex: { type: "string", description: "Hex-encoded msgpack bytes to decode" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "encode");

    switch (action) {
      case "encode": {
        let data: unknown;
        try { data = JSON.parse(String(params.data || "null")); } catch { return JSON.stringify({ error: "invalid JSON" }); }
        const bytes = this.encode(data);
        const hex = Buffer.from(bytes).toString("hex");
        return JSON.stringify({ hex, byte_length: bytes.length, json_length: String(params.data || "null").length });
      }
      case "decode": {
        const hex = String(params.hex || "");
        try {
          const bytes = Buffer.from(hex, "hex");
          const [value] = this.decode(bytes, 0);
          return JSON.stringify({ data: value });
        } catch (e) {
          return JSON.stringify({ error: `decode failed: ${e instanceof Error ? e.message : e}` });
        }
      }
      case "info": {
        const hex = String(params.hex || "");
        const bytes = Buffer.from(hex, "hex");
        const first = bytes[0];
        let type = "unknown";
        if (first <= 0x7f) type = "positive fixint";
        else if (first >= 0xe0) type = "negative fixint";
        else if ((first & 0xf0) === 0x80) type = "fixmap";
        else if ((first & 0xf0) === 0x90) type = "fixarray";
        else if ((first & 0xe0) === 0xa0) type = "fixstr";
        else if (first === 0xc0) type = "nil";
        else if (first === 0xc2 || first === 0xc3) type = "boolean";
        else if (first >= 0xca && first <= 0xcb) type = "float";
        else if (first >= 0xcc && first <= 0xd3) type = "int";
        else if (first >= 0xd9 && first <= 0xdb) type = "str";
        else if (first >= 0xdc && first <= 0xdd) type = "array";
        else if (first >= 0xde && first <= 0xdf) type = "map";
        return JSON.stringify({ byte_length: bytes.length, first_byte: `0x${first.toString(16)}`, type });
      }
      case "compare_size": {
        let data: unknown;
        try { data = JSON.parse(String(params.data || "null")); } catch { return JSON.stringify({ error: "invalid JSON" }); }
        const json_size = Buffer.byteLength(JSON.stringify(data));
        const msgpack_size = this.encode(data).length;
        const ratio = json_size > 0 ? Math.round((msgpack_size / json_size) * 1000) / 10 : 0;
        return JSON.stringify({ json_bytes: json_size, msgpack_bytes: msgpack_size, ratio_percent: ratio, savings_percent: Math.round((100 - ratio) * 10) / 10 });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private encode(val: unknown): Uint8Array {
    const parts: number[] = [];
    this.encode_value(val, parts);
    return new Uint8Array(parts);
  }

  private encode_value(val: unknown, out: number[]): void {
    if (val === null || val === undefined) { out.push(0xc0); return; }
    if (typeof val === "boolean") { out.push(val ? 0xc3 : 0xc2); return; }
    if (typeof val === "number") {
      if (Number.isInteger(val)) {
        if (val >= 0 && val <= 127) { out.push(val); }
        else if (val < 0 && val >= -32) { out.push(val & 0xff); }
        else if (val >= 0 && val <= 0xff) { out.push(0xcc, val); }
        else if (val >= 0 && val <= 0xffff) { out.push(0xcd, (val >> 8) & 0xff, val & 0xff); }
        else if (val >= 0 && val <= 0xffffffff) { out.push(0xce, (val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff); }
        else if (val >= -128 && val < 0) { out.push(0xd0, val & 0xff); }
        else if (val >= -32768 && val < 0) { out.push(0xd1, (val >> 8) & 0xff, val & 0xff); }
        else { // fallback to float64
          out.push(0xcb);
          const buf = Buffer.alloc(8);
          buf.writeDoubleBE(val);
          for (let i = 0; i < 8; i++) out.push(buf[i]);
        }
      } else {
        out.push(0xcb);
        const buf = Buffer.alloc(8);
        buf.writeDoubleBE(val);
        for (let i = 0; i < 8; i++) out.push(buf[i]);
      }
      return;
    }
    if (typeof val === "string") {
      const bytes = Buffer.from(val, "utf-8");
      const len = bytes.length;
      if (len < 32) { out.push(0xa0 | len); }
      else if (len <= 0xff) { out.push(0xd9, len); }
      else if (len <= 0xffff) { out.push(0xda, (len >> 8) & 0xff, len & 0xff); }
      else { out.push(0xdb, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff); }
      for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
      return;
    }
    if (Array.isArray(val)) {
      const len = val.length;
      if (len < 16) { out.push(0x90 | len); }
      else if (len <= 0xffff) { out.push(0xdc, (len >> 8) & 0xff, len & 0xff); }
      else { out.push(0xdd, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff); }
      for (const item of val) this.encode_value(item, out);
      return;
    }
    if (typeof val === "object") {
      const entries = Object.entries(val as Record<string, unknown>);
      const len = entries.length;
      if (len < 16) { out.push(0x80 | len); }
      else if (len <= 0xffff) { out.push(0xde, (len >> 8) & 0xff, len & 0xff); }
      else { out.push(0xdf, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff); }
      for (const [k, v] of entries) {
        this.encode_value(k, out);
        this.encode_value(v, out);
      }
    }
  }

  private decode(buf: Buffer, offset: number): [unknown, number] {
    const b = buf[offset];
    if (b <= 0x7f) return [b, offset + 1];
    if (b >= 0xe0) return [b - 256, offset + 1];
    if ((b & 0xf0) === 0x80) return this.decode_map(buf, offset + 1, b & 0x0f);
    if ((b & 0xf0) === 0x90) return this.decode_array(buf, offset + 1, b & 0x0f);
    if ((b & 0xe0) === 0xa0) { const len = b & 0x1f; return [buf.subarray(offset + 1, offset + 1 + len).toString("utf-8"), offset + 1 + len]; }
    switch (b) {
      case 0xc0: return [null, offset + 1];
      case 0xc2: return [false, offset + 1];
      case 0xc3: return [true, offset + 1];
      case 0xcc: return [buf[offset + 1], offset + 2];
      case 0xcd: return [buf.readUInt16BE(offset + 1), offset + 3];
      case 0xce: return [buf.readUInt32BE(offset + 1), offset + 5];
      case 0xd0: return [buf.readInt8(offset + 1), offset + 2];
      case 0xd1: return [buf.readInt16BE(offset + 1), offset + 3];
      case 0xcb: return [buf.readDoubleBE(offset + 1), offset + 9];
      case 0xd9: { const len = buf[offset + 1]; return [buf.subarray(offset + 2, offset + 2 + len).toString("utf-8"), offset + 2 + len]; }
      case 0xda: { const len = buf.readUInt16BE(offset + 1); return [buf.subarray(offset + 3, offset + 3 + len).toString("utf-8"), offset + 3 + len]; }
      case 0xdc: return this.decode_array(buf, offset + 3, buf.readUInt16BE(offset + 1));
      case 0xdd: return this.decode_array(buf, offset + 5, buf.readUInt32BE(offset + 1));
      case 0xde: return this.decode_map(buf, offset + 3, buf.readUInt16BE(offset + 1));
      case 0xdf: return this.decode_map(buf, offset + 5, buf.readUInt32BE(offset + 1));
      default: return [null, offset + 1];
    }
  }

  private decode_array(buf: Buffer, offset: number, count: number): [unknown[], number] {
    const arr: unknown[] = [];
    let pos = offset;
    for (let i = 0; i < count; i++) {
      const [val, next] = this.decode(buf, pos);
      arr.push(val);
      pos = next;
    }
    return [arr, pos];
  }

  private decode_map(buf: Buffer, offset: number, count: number): [Record<string, unknown>, number] {
    const obj: Record<string, unknown> = {};
    let pos = offset;
    for (let i = 0; i < count; i++) {
      const [key, next1] = this.decode(buf, pos);
      const [val, next2] = this.decode(buf, next1);
      obj[String(key)] = val;
      pos = next2;
    }
    return [obj, pos];
  }
}
