/** Protobuf 도구 — Protocol Buffers 스키마 정의/encode/decode (varint 기반). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface FieldDef { number: number; name: string; type: "int32" | "int64" | "uint32" | "uint64" | "sint32" | "sint64" | "bool" | "string" | "bytes" | "float" | "double"; }
interface MessageDef { name: string; fields: FieldDef[]; }

export class ProtobufTool extends Tool {
  readonly name = "protobuf";
  readonly category = "data" as const;
  readonly description = "Protocol Buffers utilities: define, encode, decode, to_proto, info.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["define", "encode", "decode", "to_proto", "info"], description: "Operation" },
      schema: { type: "string", description: "Message definition JSON ({name, fields})" },
      data: { type: "string", description: "JSON data to encode" },
      hex: { type: "string", description: "Hex-encoded protobuf bytes to decode" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "define");

    switch (action) {
      case "define": {
        const msg = this.parse_schema(params.schema);
        if (!msg) return JSON.stringify({ error: "invalid schema JSON" });
        return JSON.stringify({
          name: msg.name,
          field_count: msg.fields.length,
          fields: msg.fields.map((f) => ({ number: f.number, name: f.name, type: f.type, wire_type: this.wire_type(f.type) })),
        });
      }
      case "encode": {
        const msg = this.parse_schema(params.schema);
        if (!msg) return JSON.stringify({ error: "invalid schema JSON" });
        let data: Record<string, unknown>;
        try { data = JSON.parse(String(params.data || "{}")); } catch { return JSON.stringify({ error: "invalid data JSON" }); }
        try {
          const bytes = this.encode_message(msg, data);
          const hex = Buffer.from(bytes).toString("hex");
          return JSON.stringify({ hex, byte_length: bytes.length });
        } catch (e) {
          return JSON.stringify({ error: `encode failed: ${e instanceof Error ? e.message : e}` });
        }
      }
      case "decode": {
        const msg = this.parse_schema(params.schema);
        if (!msg) return JSON.stringify({ error: "invalid schema JSON" });
        const hex = String(params.hex || "");
        try {
          const bytes = Buffer.from(hex, "hex");
          const result = this.decode_message(msg, bytes);
          return JSON.stringify({ data: result });
        } catch (e) {
          return JSON.stringify({ error: `decode failed: ${e instanceof Error ? e.message : e}` });
        }
      }
      case "to_proto": {
        const msg = this.parse_schema(params.schema);
        if (!msg) return JSON.stringify({ error: "invalid schema JSON" });
        const lines: string[] = [`syntax = "proto3";`, "", `message ${msg.name} {`];
        for (const f of msg.fields) {
          lines.push(`  ${f.type} ${f.name} = ${f.number};`);
        }
        lines.push("}");
        return JSON.stringify({ proto: lines.join("\n") });
      }
      case "info": {
        const hex = String(params.hex || "");
        const bytes = Buffer.from(hex, "hex");
        const fields: { field_number: number; wire_type: number; wire_type_name: string }[] = [];
        let pos = 0;
        while (pos < bytes.length) {
          const [tag, next] = this.read_varint(bytes, pos);
          if (next > bytes.length) break;
          const field_number = Number(tag >> 3n);
          const wt = Number(tag & 7n);
          const wt_names = ["varint", "64-bit", "length-delimited", "start-group", "end-group", "32-bit"];
          fields.push({ field_number, wire_type: wt, wire_type_name: wt_names[wt] || "unknown" });
          pos = this.skip_field(bytes, next, wt);
          if (pos < 0) break;
        }
        return JSON.stringify({ byte_length: bytes.length, fields });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_schema(val: unknown): MessageDef | null {
    try {
      const m = JSON.parse(String(val || "{}"));
      if (!m.name || !Array.isArray(m.fields)) return null;
      return m as MessageDef;
    } catch { return null; }
  }

  private wire_type(type: string): number {
    switch (type) {
      case "int32": case "int64": case "uint32": case "uint64":
      case "sint32": case "sint64": case "bool": return 0;
      case "double": case "fixed64": case "sfixed64": return 1;
      case "string": case "bytes": return 2;
      case "float": case "fixed32": case "sfixed32": return 5;
      default: return 0;
    }
  }

  private encode_varint(value: bigint, out: number[]): void {
    let v = value < 0n ? (value + (1n << 64n)) : value;
    do {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v > 0n) byte |= 0x80;
      out.push(byte);
    } while (v > 0n);
  }

  private read_varint(buf: Buffer, offset: number): [bigint, number] {
    let result = 0n;
    let shift = 0n;
    let pos = offset;
    while (pos < buf.length) {
      const byte = buf[pos];
      result |= BigInt(byte & 0x7f) << shift;
      pos++;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
    }
    return [result, pos];
  }

  private encode_message(msg: MessageDef, data: Record<string, unknown>): Uint8Array {
    const out: number[] = [];
    for (const field of msg.fields) {
      const val = data[field.name];
      if (val === undefined || val === null) continue;
      const wt = this.wire_type(field.type);
      const tag = BigInt((field.number << 3) | wt);
      this.encode_varint(tag, out);

      switch (field.type) {
        case "int32": case "int64": case "uint32": case "uint64":
          this.encode_varint(BigInt(Number(val)), out);
          break;
        case "sint32": case "sint64": {
          const n = BigInt(Number(val));
          this.encode_varint((n << 1n) ^ (n >> 63n), out);
          break;
        }
        case "bool":
          this.encode_varint(val ? 1n : 0n, out);
          break;
        case "string": {
          const bytes = Buffer.from(String(val), "utf-8");
          this.encode_varint(BigInt(bytes.length), out);
          for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
          break;
        }
        case "bytes": {
          const bytes = Buffer.from(String(val), "hex");
          this.encode_varint(BigInt(bytes.length), out);
          for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
          break;
        }
        case "float": {
          const buf = Buffer.alloc(4);
          buf.writeFloatLE(Number(val));
          for (let i = 0; i < 4; i++) out.push(buf[i]);
          break;
        }
        case "double": {
          const buf = Buffer.alloc(8);
          buf.writeDoubleLE(Number(val));
          for (let i = 0; i < 8; i++) out.push(buf[i]);
          break;
        }
      }
    }
    return new Uint8Array(out);
  }

  private decode_message(msg: MessageDef, buf: Buffer): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let pos = 0;
    while (pos < buf.length) {
      const [tag, next] = this.read_varint(buf, pos);
      const field_number = Number(tag >> 3n);
      const wt = Number(tag & 7n);
      pos = next;
      const field = msg.fields.find((f) => f.number === field_number);

      if (wt === 0) {
        const [val, npos] = this.read_varint(buf, pos);
        pos = npos;
        if (field) {
          if (field.type === "bool") result[field.name] = val !== 0n;
          else if (field.type === "sint32" || field.type === "sint64") {
            result[field.name] = Number((val >> 1n) ^ -(val & 1n));
          } else result[field.name] = Number(val);
        }
      } else if (wt === 1) {
        if (field?.type === "double") result[field.name] = buf.readDoubleLE(pos);
        pos += 8;
      } else if (wt === 2) {
        const [len, npos] = this.read_varint(buf, pos);
        pos = npos;
        const end = pos + Number(len);
        if (field) {
          if (field.type === "string") result[field.name] = buf.subarray(pos, end).toString("utf-8");
          else if (field.type === "bytes") result[field.name] = buf.subarray(pos, end).toString("hex");
        }
        pos = end;
      } else if (wt === 5) {
        if (field?.type === "float") result[field.name] = buf.readFloatLE(pos);
        pos += 4;
      } else {
        break;
      }
    }
    return result;
  }

  private skip_field(buf: Buffer, pos: number, wire_type: number): number {
    switch (wire_type) {
      case 0: { const [, next] = this.read_varint(buf, pos); return next; }
      case 1: return pos + 8;
      case 2: { const [len, next] = this.read_varint(buf, pos); return next + Number(len); }
      case 5: return pos + 4;
      default: return -1;
    }
  }
}
