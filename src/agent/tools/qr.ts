/** QR 도구 — QR코드 생성 (SVG/텍스트 기반, 외부 의존성 없음). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class QrTool extends Tool {
  readonly name = "qr";
  readonly category = "data" as const;
  readonly description = "QR code generation: generate (SVG/text), encode data into QR codes.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "text"], description: "QR operation" },
      data: { type: "string", description: "Data to encode" },
      size: { type: "integer", description: "Module size in pixels for SVG (default: 10)" },
      format: { type: "string", enum: ["svg", "text"], description: "Output format (default: svg)" },
    },
    required: ["action", "data"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "generate");
    const data = String(params.data || "");
    if (!data) return "Error: data is required";

    const format = String(params.format || (action === "text" ? "text" : "svg"));

    const modules = this.encode(data);
    if (!modules) return "Error: data too long for QR encoding (max ~60 chars in simple mode)";

    if (format === "text") {
      const text = modules.map((row) => row.map((m) => m ? "\u2588\u2588" : "  ").join("")).join("\n");
      return JSON.stringify({ text, size: modules.length });
    }

    const mod_size = Math.max(1, Number(params.size) || 10);
    const total = modules.length * mod_size;
    const quiet = mod_size * 4;
    const svg_size = total + quiet * 2;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svg_size} ${svg_size}" width="${svg_size}" height="${svg_size}">`;
    svg += `<rect width="${svg_size}" height="${svg_size}" fill="white"/>`;
    for (let y = 0; y < modules.length; y++) {
      for (let x = 0; x < modules[y]!.length; x++) {
        if (modules[y]![x]) {
          svg += `<rect x="${quiet + x * mod_size}" y="${quiet + y * mod_size}" width="${mod_size}" height="${mod_size}" fill="black"/>`;
        }
      }
    }
    svg += "</svg>";
    return JSON.stringify({ svg, size: modules.length, pixel_size: svg_size });
  }

  /** 간소화된 QR 인코더 — Version 1-4 byte mode. */
  private encode(data: string): boolean[][] | null {
    const bytes = Buffer.from(data, "utf-8");
    if (bytes.length > 60) return null;

    const version = bytes.length <= 17 ? 1 : bytes.length <= 32 ? 2 : bytes.length <= 49 ? 3 : 4;
    const size = 17 + version * 4;
    const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
    const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

    this.place_finder(modules, reserved, 0, 0);
    this.place_finder(modules, reserved, size - 7, 0);
    this.place_finder(modules, reserved, 0, size - 7);

    for (let i = 8; i < size - 8; i++) {
      modules[6]![i] = i % 2 === 0;
      reserved[6]![i] = true;
      modules[i]![6] = i % 2 === 0;
      reserved[i]![6] = true;
    }

    if (version >= 2) {
      const pos = size - 7 - 2;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          modules[pos + dy]![pos + dx] = Math.abs(dy) === 2 || Math.abs(dx) === 2 || (dy === 0 && dx === 0);
          reserved[pos + dy]![pos + dx] = true;
        }
      }
    }

    for (let i = 0; i < 8; i++) {
      reserved[8]![i] = true; reserved[i]![8] = true;
      reserved[8]![size - 1 - i] = true; reserved[size - 1 - i]![8] = true;
    }
    reserved[8]![8] = true;
    modules[size - 8]![8] = true;

    const bit_stream = this.build_data_bits(bytes, version);
    let bit_idx = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const rows = upward ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);
      for (const row of rows) {
        for (const col of [right, right - 1]) {
          if (!reserved[row]![col]) {
            modules[row]![col] = bit_idx < bit_stream.length ? bit_stream[bit_idx]! : false;
            bit_idx++;
          }
        }
      }
      upward = !upward;
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y]![x]) modules[y]![x] = modules[y]![x] !== ((x + y) % 2 === 0);
      }
    }

    return modules;
  }

  private place_finder(modules: boolean[][], reserved: boolean[][], row: number, col: number): void {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const r = row + dy, c = col + dx;
        if (r < 0 || c < 0 || r >= modules.length || c >= modules.length) continue;
        reserved[r]![c] = true;
        if (dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6) {
          modules[r]![c] = dy === 0 || dy === 6 || dx === 0 || dx === 6 || (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4);
        }
      }
    }
  }

  private build_data_bits(bytes: Buffer, version: number): boolean[] {
    const total_codewords = [0, 26, 44, 70, 100][version]!;
    const ec_codewords = [0, 7, 10, 15, 20][version]!;
    const data_codewords = total_codewords - ec_codewords;

    const bits: boolean[] = [];
    const push_bits = (val: number, count: number): void => {
      for (let i = count - 1; i >= 0; i--) bits.push(((val >> i) & 1) === 1);
    };

    push_bits(0b0100, 4);
    push_bits(bytes.length, version >= 10 ? 16 : 8);
    for (const b of bytes) push_bits(b, 8);
    push_bits(0, Math.min(4, data_codewords * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(false);
    let pad = 0;
    while (bits.length < data_codewords * 8) {
      push_bits(pad % 2 === 0 ? 0xEC : 0x11, 8);
      pad++;
    }

    while (bits.length < total_codewords * 8) bits.push(false);
    return bits;
  }
}
