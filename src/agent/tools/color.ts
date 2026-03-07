/** Color 도구 — 색상 변환/블렌드/팔레트/대비/밝기 계산. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class ColorTool extends Tool {
  readonly name = "color";
  readonly category = "data" as const;
  readonly description = "Color utilities: parse, convert, blend, contrast, lighten, darken, palette, complement.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "convert", "blend", "contrast", "lighten", "darken", "palette", "complement"], description: "Color operation" },
      color: { type: "string", description: "Color value (hex, rgb, hsl)" },
      color2: { type: "string", description: "Second color (blend/contrast)" },
      format: { type: "string", enum: ["hex", "rgb", "hsl"], description: "Target format (default: hex)" },
      amount: { type: "number", description: "Amount for lighten/darken/blend (0-1, default: 0.5)" },
      count: { type: "integer", description: "Number of colors for palette (default: 5)" },
    },
    required: ["action", "color"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");
    const color_str = String(params.color || "");

    const rgb = this.parse_color(color_str);
    if (!rgb) return `Error: cannot parse color "${color_str}"`;

    switch (action) {
      case "parse":
        return JSON.stringify({ hex: this.to_hex(rgb), rgb, hsl: this.to_hsl(rgb) });
      case "convert": {
        const fmt = String(params.format || "hex");
        if (fmt === "hex") return JSON.stringify({ result: this.to_hex(rgb) });
        if (fmt === "rgb") return JSON.stringify({ result: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` });
        if (fmt === "hsl") { const hsl = this.to_hsl(rgb); return JSON.stringify({ result: `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)` }); }
        return "Error: format must be hex, rgb, or hsl";
      }
      case "blend": {
        const rgb2 = this.parse_color(String(params.color2 || ""));
        if (!rgb2) return "Error: invalid color2";
        const t = Number(params.amount) || 0.5;
        const blended: [number, number, number] = [
          Math.round(rgb[0] + (rgb2[0] - rgb[0]) * t),
          Math.round(rgb[1] + (rgb2[1] - rgb[1]) * t),
          Math.round(rgb[2] + (rgb2[2] - rgb[2]) * t),
        ];
        return JSON.stringify({ result: this.to_hex(blended), rgb: blended });
      }
      case "contrast": {
        const rgb2 = this.parse_color(String(params.color2 || ""));
        if (!rgb2) return "Error: invalid color2";
        const l1 = this.luminance(rgb);
        const l2 = this.luminance(rgb2);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return JSON.stringify({ ratio: Math.round(ratio * 100) / 100, aa_normal: ratio >= 4.5, aa_large: ratio >= 3, aaa_normal: ratio >= 7 });
      }
      case "lighten": {
        const amount = Number(params.amount) || 0.2;
        const hsl = this.to_hsl(rgb);
        hsl[2] = Math.min(100, hsl[2] + amount * 100);
        const result = this.hsl_to_rgb(hsl);
        return JSON.stringify({ result: this.to_hex(result), rgb: result });
      }
      case "darken": {
        const amount = Number(params.amount) || 0.2;
        const hsl = this.to_hsl(rgb);
        hsl[2] = Math.max(0, hsl[2] - amount * 100);
        const result = this.hsl_to_rgb(hsl);
        return JSON.stringify({ result: this.to_hex(result), rgb: result });
      }
      case "palette": {
        const count = Math.max(2, Math.min(Number(params.count) || 5, 12));
        const hsl = this.to_hsl(rgb);
        const colors: string[] = [];
        for (let i = 0; i < count; i++) {
          const h = (hsl[0] + (360 / count) * i) % 360;
          colors.push(this.to_hex(this.hsl_to_rgb([h, hsl[1], hsl[2]])));
        }
        return JSON.stringify({ palette: colors, count });
      }
      case "complement": {
        const hsl = this.to_hsl(rgb);
        const comp = this.hsl_to_rgb([(hsl[0] + 180) % 360, hsl[1], hsl[2]]);
        return JSON.stringify({ original: this.to_hex(rgb), complement: this.to_hex(comp) });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private parse_color(str: string): [number, number, number] | null {
    str = str.trim();
    const hex_match = str.match(/^#?([0-9a-f]{3,8})$/i);
    if (hex_match) {
      let hex = hex_match[1]!;
      if (hex.length === 3) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    const rgb_match = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
    if (rgb_match) return [Number(rgb_match[1]), Number(rgb_match[2]), Number(rgb_match[3])];
    const hsl_match = str.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/i);
    if (hsl_match) return this.hsl_to_rgb([Number(hsl_match[1]), Number(hsl_match[2]), Number(hsl_match[3])]);
    return null;
  }

  private to_hex(rgb: [number, number, number]): string {
    return "#" + rgb.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
  }

  private to_hsl(rgb: [number, number, number]): [number, number, number] {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, Math.round(l * 100)];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }

  private hsl_to_rgb(hsl: [number, number, number]): [number, number, number] {
    const h = hsl[0] / 360, s = hsl[1] / 100, l = hsl[2] / 100;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255)];
  }

  private luminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }
}
