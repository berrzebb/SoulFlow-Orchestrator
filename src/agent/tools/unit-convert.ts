/** Unit Convert 도구 — 단위 변환 (길이/무게/온도/속도/면적/부피/데이터). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

type ConversionTable = Record<string, number>;

const LENGTH: ConversionTable = {
  m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144,
  ft: 0.3048, in: 0.0254, nm: 1852, um: 1e-6,
};
const WEIGHT: ConversionTable = {
  kg: 1, g: 0.001, mg: 1e-6, lb: 0.453592, oz: 0.0283495,
  ton: 1000, st: 6.35029,
};
const SPEED: ConversionTable = {
  "m/s": 1, "km/h": 0.277778, "mi/h": 0.44704, "ft/s": 0.3048, knot: 0.514444,
};
const AREA: ConversionTable = {
  "m2": 1, "km2": 1e6, "cm2": 1e-4, "ha": 1e4, "ac": 4046.86,
  "ft2": 0.092903, "in2": 0.00064516, "mi2": 2.59e6, "pyeong": 3.30579,
};
const VOLUME: ConversionTable = {
  l: 1, ml: 0.001, "m3": 1000, gal: 3.78541, qt: 0.946353,
  pt: 0.473176, cup: 0.236588, "fl_oz": 0.0295735, "cm3": 0.001,
};
const DATA: ConversionTable = {
  b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4,
  pb: 1024 ** 5, bit: 0.125, kbit: 128, mbit: 128 * 1024,
};
const TIME: ConversionTable = {
  s: 1, ms: 0.001, us: 1e-6, ns: 1e-9, min: 60, h: 3600,
  d: 86400, w: 604800, mo: 2592000, y: 31536000,
};

const CATEGORIES: Record<string, ConversionTable> = {
  length: LENGTH, weight: WEIGHT, speed: SPEED, area: AREA,
  volume: VOLUME, data: DATA, time: TIME,
};

export class UnitConvertTool extends Tool {
  readonly name = "unit_convert";
  readonly category = "data" as const;
  readonly description = "Unit conversion: length, weight, temperature, speed, area, volume, data, time.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["convert", "list_units", "list_categories", "temperature"], description: "Operation" },
      value: { type: "number", description: "Value to convert" },
      from: { type: "string", description: "Source unit" },
      to: { type: "string", description: "Target unit" },
      category: { type: "string", description: "Unit category (auto-detect if omitted)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "convert");

    switch (action) {
      case "convert": {
        const value = Number(params.value ?? 0);
        const from = String(params.from || "").toLowerCase();
        const to = String(params.to || "").toLowerCase();

        // Temperature
        if (this.is_temp(from) || this.is_temp(to)) {
          return JSON.stringify({ value, from, to, result: this.convert_temp(value, from, to) });
        }

        const cat = params.category ? String(params.category).toLowerCase() : this.detect_category(from);
        if (!cat) return JSON.stringify({ error: `unknown unit: ${from}` });
        const table = CATEGORIES[cat];
        if (!table) return JSON.stringify({ error: `unknown category: ${cat}` });
        if (!(from in table)) return JSON.stringify({ error: `unknown unit '${from}' in ${cat}` });
        if (!(to in table)) return JSON.stringify({ error: `unknown unit '${to}' in ${cat}` });
        const result = value * table[from] / table[to];
        return JSON.stringify({ value, from, to, category: cat, result });
      }
      case "temperature": {
        const value = Number(params.value ?? 0);
        const from = String(params.from || "c").toLowerCase();
        const to = String(params.to || "f").toLowerCase();
        return JSON.stringify({ value, from, to, result: this.convert_temp(value, from, to) });
      }
      case "list_units": {
        const cat = String(params.category || "").toLowerCase();
        if (cat === "temperature") return JSON.stringify({ category: "temperature", units: ["c", "f", "k"] });
        const table = CATEGORIES[cat];
        if (!table) return JSON.stringify({ error: `unknown category: ${cat}`, available: [...Object.keys(CATEGORIES), "temperature"] });
        return JSON.stringify({ category: cat, units: Object.keys(table) });
      }
      case "list_categories": {
        return JSON.stringify({ categories: [...Object.keys(CATEGORIES), "temperature"] });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private is_temp(unit: string): boolean {
    return ["c", "f", "k", "celsius", "fahrenheit", "kelvin"].includes(unit.toLowerCase());
  }

  private convert_temp(value: number, from: string, to: string): number {
    const f = from[0].toLowerCase();
    const t = to[0].toLowerCase();
    let celsius: number;
    switch (f) {
      case "c": celsius = value; break;
      case "f": celsius = (value - 32) * 5 / 9; break;
      case "k": celsius = value - 273.15; break;
      default: return NaN;
    }
    switch (t) {
      case "c": return Math.round(celsius * 1e6) / 1e6;
      case "f": return Math.round((celsius * 9 / 5 + 32) * 1e6) / 1e6;
      case "k": return Math.round((celsius + 273.15) * 1e6) / 1e6;
      default: return NaN;
    }
  }

  private detect_category(unit: string): string | null {
    for (const [cat, table] of Object.entries(CATEGORIES)) {
      if (unit in table) return cat;
    }
    return null;
  }
}
