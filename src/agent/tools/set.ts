/** Set 도구 — 집합 연산 (union, intersection, difference, symmetric_difference, subset). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const MAX_ELEMENTS = 100_000;

export class SetTool extends Tool {
  readonly name = "set_ops";
  readonly category = "memory" as const;
  readonly description =
    "Set operations on arrays: union, intersection, difference, symmetric_difference, is_subset, is_superset, equals, power_set, cartesian_product.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["union", "intersection", "difference", "symmetric_difference", "is_subset", "is_superset", "equals", "power_set", "cartesian_product"], description: "Set operation" },
      a: { type: "string", description: "First set as JSON array" },
      b: { type: "string", description: "Second set as JSON array" },
    },
    required: ["operation", "a"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "union");
    const a = this.parse_set(String(params.a || "[]"));
    if (!a) return "Error: invalid JSON array for 'a'";
    if (a.length > MAX_ELEMENTS) return `Error: set 'a' exceeds ${MAX_ELEMENTS} elements`;

    const needs_b = !["power_set"].includes(op);
    let b: unknown[] = [];
    if (needs_b) {
      const parsed = this.parse_set(String(params.b || "[]"));
      if (!parsed) return "Error: invalid JSON array for 'b'";
      if (parsed.length > MAX_ELEMENTS) return `Error: set 'b' exceeds ${MAX_ELEMENTS} elements`;
      b = parsed;
    }

    switch (op) {
      case "union": return JSON.stringify([...new Set([...a, ...b].map(String))].map((s) => this.restore(s, a, b)));
      case "intersection": {
        const sb = new Set(b.map(String));
        return JSON.stringify(a.filter((v) => sb.has(String(v))));
      }
      case "difference": {
        const sb = new Set(b.map(String));
        return JSON.stringify(a.filter((v) => !sb.has(String(v))));
      }
      case "symmetric_difference": {
        const sa = new Set(a.map(String));
        const sb = new Set(b.map(String));
        const result = [
          ...a.filter((v) => !sb.has(String(v))),
          ...b.filter((v) => !sa.has(String(v))),
        ];
        return JSON.stringify(result);
      }
      case "is_subset": {
        const sb = new Set(b.map(String));
        return String(a.every((v) => sb.has(String(v))));
      }
      case "is_superset": {
        const sa = new Set(a.map(String));
        return String(b.every((v) => sa.has(String(v))));
      }
      case "equals": {
        if (a.length !== b.length) return "false";
        const sa = new Set(a.map(String));
        return String(b.every((v) => sa.has(String(v))));
      }
      case "power_set": {
        if (a.length > 20) return "Error: power_set limited to 20 elements";
        return JSON.stringify(this.power_set(a));
      }
      case "cartesian_product": {
        if (a.length * b.length > MAX_ELEMENTS) return "Error: cartesian product too large";
        const result: unknown[][] = [];
        for (const x of a) for (const y of b) result.push([x, y]);
        return JSON.stringify(result);
      }
      default: return `Error: unsupported operation "${op}"`;
    }
  }

  private parse_set(input: string): unknown[] | null {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      const items = input.split(",").map((s) => s.trim()).filter(Boolean);
      return items.length > 0 ? items : null;
    }
  }

  private restore(str: string, a: unknown[], b: unknown[]): unknown {
    for (const v of a) if (String(v) === str) return v;
    for (const v of b) if (String(v) === str) return v;
    return str;
  }

  private power_set(arr: unknown[]): unknown[][] {
    const result: unknown[][] = [[]];
    for (const item of arr) {
      const len = result.length;
      for (let i = 0; i < len; i++) {
        result.push([...result[i], item]);
      }
    }
    return result;
  }
}
