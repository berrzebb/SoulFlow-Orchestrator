/** Math 도구 — 산술, 단위 변환, 금융 계산, 수식 파서. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { error_message } from "../../utils/common.js";

const UNIT_TABLE: Record<string, Record<string, number>> = {
  length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  weight: { mg: 0.001, g: 1, kg: 1000, oz: 28.3495, lb: 453.592, ton: 1_000_000 },
  temperature: {},
  time: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, week: 604800, month: 2_592_000, year: 31_536_000 },
  data: { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 },
  area: { mm2: 1e-6, cm2: 1e-4, m2: 1, km2: 1e6, ha: 1e4, acre: 4046.856, ft2: 0.092903, sqft: 0.092903 },
  volume: { ml: 0.001, l: 1, gal: 3.78541, qt: 0.946353, pt: 0.473176, cup: 0.236588, fl_oz: 0.0295735 },
  speed: { "m/s": 1, "km/h": 0.277778, mph: 0.44704, knot: 0.514444 },
};

export class MathTool extends Tool {
  readonly name = "math";
  readonly category = "memory" as const;
  readonly description =
    "Math operations: evaluate expressions, unit conversion, financial calculations (compound interest, loan payment, ROI), rounding, percentage, gcd/lcm, factorial.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["eval", "convert", "compound_interest", "loan_payment", "roi", "percentage", "round", "gcd", "lcm", "factorial", "fibonacci"], description: "Math operation" },
      expression: { type: "string", description: "Math expression to evaluate (for eval)" },
      value: { type: "number", description: "Input numeric value" },
      from: { type: "string", description: "Source unit (for convert)" },
      to: { type: "string", description: "Target unit (for convert)" },
      principal: { type: "number", description: "Principal amount (financial)" },
      rate: { type: "number", description: "Annual interest rate as decimal (e.g. 0.05 for 5%)" },
      periods: { type: "number", description: "Number of periods" },
      cost: { type: "number", description: "Cost for ROI" },
      gain: { type: "number", description: "Gain for ROI" },
      decimals: { type: "integer", description: "Decimal places for rounding (default: 2)" },
      a: { type: "number", description: "First number (gcd/lcm)" },
      b: { type: "number", description: "Second number (gcd/lcm)" },
      n: { type: "integer", description: "Integer input (factorial/fibonacci)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "eval");
    switch (op) {
      case "eval": return this.safe_eval(String(params.expression || ""));
      case "convert": return this.convert(Number(params.value ?? 0), String(params.from || ""), String(params.to || ""));
      case "compound_interest": return this.compound_interest(Number(params.principal ?? 0), Number(params.rate ?? 0), Number(params.periods ?? 0));
      case "loan_payment": return this.loan_payment(Number(params.principal ?? 0), Number(params.rate ?? 0), Number(params.periods ?? 0));
      case "roi": return this.roi(Number(params.cost ?? 0), Number(params.gain ?? 0));
      case "percentage": return this.percentage(Number(params.value ?? 0), Number(params.a ?? 100));
      case "round": return this.round_val(Number(params.value ?? 0), Number(params.decimals ?? 2));
      case "gcd": return String(this.gcd(Math.abs(Math.trunc(Number(params.a ?? 0))), Math.abs(Math.trunc(Number(params.b ?? 0)))));
      case "lcm": return String(this.lcm(Math.abs(Math.trunc(Number(params.a ?? 0))), Math.abs(Math.trunc(Number(params.b ?? 0)))));
      case "factorial": return this.factorial(Number(params.n ?? 0));
      case "fibonacci": return this.fibonacci(Number(params.n ?? 0));
      default: return `Error: unsupported operation "${op}"`;
    }
  }

  private safe_eval(expr: string): string {
    if (!expr.trim()) return "Error: empty expression";
    if (/[a-zA-Z_$]/.test(expr.replace(/\b(Math|PI|E|abs|ceil|floor|round|sqrt|pow|log|log2|log10|sin|cos|tan|min|max|random|trunc|sign|cbrt|exp|hypot)\b/g, ""))) {
      return "Error: expression contains invalid identifiers";
    }
    try {
      const fn = new Function("Math", `"use strict"; return (${expr});`);
      const result = fn(Math);
      if (typeof result !== "number" || !isFinite(result)) return `Error: result is ${result}`;
      return String(result);
    } catch (e) {
      return `Error: ${error_message(e)}`;
    }
  }

  private convert(value: number, from: string, to: string): string {
    const fl = from.toLowerCase();
    const tl = to.toLowerCase();
    if (fl === tl) return String(value);
    if ((fl === "c" || fl === "f" || fl === "k") && (tl === "c" || tl === "f" || tl === "k")) {
      return String(this.temp_convert(value, fl, tl));
    }
    for (const group of Object.values(UNIT_TABLE)) {
      if (fl in group && tl in group) {
        return String(this.rnd(value * group[fl] / group[tl]));
      }
    }
    return `Error: cannot convert "${from}" to "${to}"`;
  }

  private temp_convert(v: number, from: string, to: string): number {
    const celsius = from === "c" ? v : from === "f" ? (v - 32) * 5 / 9 : v - 273.15;
    if (to === "c") return this.rnd(celsius);
    if (to === "f") return this.rnd(celsius * 9 / 5 + 32);
    return this.rnd(celsius + 273.15);
  }

  private compound_interest(p: number, r: number, n: number): string {
    const amount = p * Math.pow(1 + r, n);
    return JSON.stringify({ principal: p, rate: r, periods: n, amount: this.rnd(amount), interest: this.rnd(amount - p) });
  }

  private loan_payment(p: number, r: number, n: number): string {
    if (r === 0) return JSON.stringify({ payment: this.rnd(p / n), total: p, interest: 0 });
    const monthly_rate = r / 12;
    const payment = p * monthly_rate * Math.pow(1 + monthly_rate, n) / (Math.pow(1 + monthly_rate, n) - 1);
    return JSON.stringify({ payment: this.rnd(payment), total: this.rnd(payment * n), interest: this.rnd(payment * n - p) });
  }

  private roi(cost: number, gain: number): string {
    if (cost === 0) return "Error: cost cannot be zero";
    const roi = ((gain - cost) / cost) * 100;
    return JSON.stringify({ roi_percent: this.rnd(roi), net_profit: this.rnd(gain - cost) });
  }

  private percentage(value: number, base: number): string {
    if (base === 0) return "Error: base cannot be zero";
    return String(this.rnd((value / base) * 100));
  }

  private round_val(value: number, decimals: number): string {
    const f = 10 ** decimals;
    return String(Math.round(value * f) / f);
  }

  private gcd(a: number, b: number): number {
    while (b) { [a, b] = [b, a % b]; }
    return a;
  }

  private lcm(a: number, b: number): number {
    return a && b ? Math.abs(a * b) / this.gcd(a, b) : 0;
  }

  private factorial(n: number): string {
    if (n < 0 || !Number.isInteger(n)) return "Error: factorial requires non-negative integer";
    if (n > 170) return "Error: factorial too large (max 170)";
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return String(result);
  }

  private fibonacci(n: number): string {
    if (n < 0 || !Number.isInteger(n)) return "Error: fibonacci requires non-negative integer";
    if (n > 1000) return "Error: fibonacci index too large (max 1000)";
    if (n === 0) return "0";
    let a = 0n, b = 1n;
    for (let i = 2; i <= n; i++) [a, b] = [b, a + b];
    return String(b);
  }

  private rnd(n: number, d = 6): number {
    const f = 10 ** d;
    return Math.round(n * f) / f;
  }
}
