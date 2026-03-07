/** Barcode 도구 — 바코드 생성 (Code128/EAN-13/Code39) SVG 출력. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class BarcodeTool extends Tool {
  readonly name = "barcode";
  readonly category = "data" as const;
  readonly description = "Barcode utilities: generate (Code128/EAN-13/Code39 as SVG), validate_ean, parse_ean.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "validate_ean", "parse_ean", "checksum_ean"], description: "Operation" },
      data: { type: "string", description: "Data to encode" },
      format: { type: "string", enum: ["code128", "ean13", "code39"], description: "Barcode format (default: code128)" },
      width: { type: "number", description: "Bar width multiplier (default: 2)" },
      height: { type: "number", description: "Bar height (default: 80)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "generate");
    const data = String(params.data || "");

    switch (action) {
      case "generate": {
        const format = String(params.format || "code128");
        const w = Number(params.width) || 2;
        const h = Number(params.height) || 80;
        switch (format) {
          case "code128": return this.generate_code128(data, w, h);
          case "ean13": return this.generate_ean13(data, w, h);
          case "code39": return this.generate_code39(data, w, h);
          default: return JSON.stringify({ error: `unsupported format: ${format}` });
        }
      }
      case "validate_ean": {
        const valid = this.validate_ean(data);
        return JSON.stringify({ data, valid });
      }
      case "parse_ean": {
        if (data.length !== 13) return JSON.stringify({ error: "EAN-13 must be 13 digits" });
        return JSON.stringify({ prefix: data.slice(0, 3), manufacturer: data.slice(3, 8), product: data.slice(8, 12), check_digit: data[12] });
      }
      case "checksum_ean": {
        if (data.length < 12) return JSON.stringify({ error: "need at least 12 digits" });
        const digits = data.slice(0, 12);
        const check = this.ean13_checksum(digits);
        return JSON.stringify({ digits, check_digit: check, ean13: digits + check });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private validate_ean(data: string): boolean {
    if (!/^\d{13}$/.test(data)) return false;
    const expected = this.ean13_checksum(data.slice(0, 12));
    return data[12] === String(expected);
  }

  private ean13_checksum(digits: string): number {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
  }

  // Code 128B 인코딩
  private generate_code128(data: string, w: number, h: number): string {
    const CODE128B_START = 104;
    const STOP = [2, 3, 3, 1, 1, 1, 2];
    const PATTERNS: number[][] = [
      [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
      [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
      [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
      [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
      [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
      [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
      [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
      [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
      [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
      [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
      [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
      [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
      [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
      [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
      [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
      [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
      [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
      [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
      [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
      [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
      [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
      [2,1,1,2,3,2],
    ];

    const values: number[] = [CODE128B_START];
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i) - 32;
      if (code < 0 || code > 95) continue;
      values.push(code);
    }
    let checksum = values[0];
    for (let i = 1; i < values.length; i++) checksum += values[i] * i;
    values.push(checksum % 103);

    const bars: number[][] = [];
    for (const v of values) {
      if (v < PATTERNS.length) bars.push(PATTERNS[v]);
    }
    bars.push(STOP);

    return this.bars_to_svg(bars, w, h);
  }

  private generate_code39(data: string, w: number, h: number): string {
    const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*";
    const PATTERNS = [
      "nnnwwnwnn","wnnwnnnnw","nnwwnnnnw","wnwwnnnn","nnnwwnnnw","wnnwwnnnn","nnwwwnnnn",
      "nnnwnnwnw","wnnwnnwnn","nnwwnnwnn","wnnnnwnnw","nnwnnwnnw","wnwnnwnnn","nnnwnwnnw",
      "wnnwnwnnn","nnwwnwnnn","nnnnnwwnw","wnnnnwwnn","nnwnnwwnn","nnnwnwwnn","wnnnnnnww",
      "nnwnnnnww","wnwnnnnwn","nnnwnnnww","wnnwnnnwn","nnwwnnnwn","nnnnnwnww","wnnnnwnwn",
      "nnwnnwnwn","nnnwnwnwn","wnnnnnnww","nnwnnnnww","wnwnnnnwn","nnnwnnnww","wnnwnnnwn",
      "nnwwnnnwn","nnnnnwnww","wnnnnwnwn","nnwnnwnwn","nnnnnnnnw","nwnwnnwnn","nwnwnnnnw",
      "nwnnnwnwn","nwnnnnnnw",
    ];

    const input = `*${data.toUpperCase()}*`;
    const all_bars: string[] = [];
    for (const ch of input) {
      const idx = CHARS.indexOf(ch);
      if (idx >= 0 && idx < PATTERNS.length) all_bars.push(PATTERNS[idx]);
    }

    const bars: number[][] = [];
    for (const pattern of all_bars) {
      const modules: number[] = [];
      for (let i = 0; i < pattern.length; i++) {
        modules.push(pattern[i] === "w" ? 3 : 1);
      }
      bars.push(modules);
    }

    let x = 10;
    let svg_bars = "";
    for (const modules of bars) {
      for (let i = 0; i < modules.length; i++) {
        const bw = modules[i] * w;
        if (i % 2 === 0) svg_bars += `<rect x="${x}" y="10" width="${bw}" height="${h}" fill="black"/>`;
        x += bw;
      }
      x += w;
    }
    const total_w = x + 10;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${total_w}" height="${h + 30}"><rect width="100%" height="100%" fill="white"/>${svg_bars}<text x="${total_w / 2}" y="${h + 25}" text-anchor="middle" font-size="12" font-family="monospace">${data}</text></svg>`;
  }

  private generate_ean13(data: string, w: number, h: number): string {
    let digits = data.replace(/\D/g, "");
    if (digits.length < 12) return JSON.stringify({ error: "EAN-13 needs at least 12 digits" });
    if (digits.length === 12) digits += this.ean13_checksum(digits);
    if (digits.length !== 13) return JSON.stringify({ error: "EAN-13 must be exactly 13 digits" });

    const L_PATTERNS = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
    const R_PATTERNS = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
    const G_PATTERNS = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
    const PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

    const parity = PARITY[Number(digits[0])];
    let binary = "101"; // start guard
    for (let i = 1; i <= 6; i++) {
      const d = Number(digits[i]);
      binary += parity[i - 1] === "L" ? L_PATTERNS[d] : G_PATTERNS[d];
    }
    binary += "01010"; // center guard
    for (let i = 7; i <= 12; i++) binary += R_PATTERNS[Number(digits[i])];
    binary += "101"; // end guard

    let x = 10;
    let svg = "";
    for (const bit of binary) {
      if (bit === "1") svg += `<rect x="${x}" y="10" width="${w}" height="${h}" fill="black"/>`;
      x += w;
    }
    const total_w = x + 10;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${total_w}" height="${h + 30}"><rect width="100%" height="100%" fill="white"/>${svg}<text x="${total_w / 2}" y="${h + 25}" text-anchor="middle" font-size="12" font-family="monospace">${digits}</text></svg>`;
  }

  private bars_to_svg(bars: number[][], w: number, h: number): string {
    let x = 10;
    let svg = "";
    for (const modules of bars) {
      for (let i = 0; i < modules.length; i++) {
        const bw = modules[i] * w;
        if (i % 2 === 0) svg += `<rect x="${x}" y="10" width="${bw}" height="${h}" fill="black"/>`;
        x += bw;
      }
    }
    const total_w = x + 10;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${total_w}" height="${h + 20}"><rect width="100%" height="100%" fill="white"/>${svg}</svg>`;
  }
}
