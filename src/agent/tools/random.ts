/** Random 도구 — 난수/무작위 선택/셔플/비밀번호 생성. */

import { randomBytes, randomInt } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class RandomTool extends Tool {
  readonly name = "random";
  readonly category = "data" as const;
  readonly description = "Random utilities: integer, float, choice, shuffle, sample, password, bytes, coin, dice.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["integer", "float", "choice", "shuffle", "sample", "password", "bytes", "coin", "dice"], description: "Random operation" },
      min: { type: "integer", description: "Minimum value (integer/float, default: 0)" },
      max: { type: "integer", description: "Maximum value (integer: 100, float: 1.0)" },
      items: { type: "string", description: "JSON array or comma-separated items (choice/shuffle/sample)" },
      count: { type: "integer", description: "Number of results (sample/bytes/dice, default: 1)" },
      length: { type: "integer", description: "Password length (default: 16)" },
      charset: { type: "string", description: "Password charset: alphanumeric / symbols / hex / numeric (default: symbols)" },
      sides: { type: "integer", description: "Dice sides (default: 6)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "integer");

    switch (action) {
      case "integer": {
        const min = Number(params.min) || 0;
        const max = Number(params.max) || 100;
        return JSON.stringify({ value: randomInt(min, max + 1) });
      }
      case "float": {
        const min = Number(params.min) || 0;
        const max = Number(params.max) || 1;
        const bytes = randomBytes(8);
        const rand = bytes.readUInt32BE(0) / 0xFFFFFFFF;
        return JSON.stringify({ value: min + rand * (max - min) });
      }
      case "choice": {
        const items = this.parse_items(String(params.items || "[]"));
        if (items.length === 0) return "Error: items is required";
        return JSON.stringify({ value: items[randomInt(0, items.length)] });
      }
      case "shuffle": {
        const items = this.parse_items(String(params.items || "[]"));
        for (let i = items.length - 1; i > 0; i--) {
          const j = randomInt(0, i + 1);
          [items[i], items[j]] = [items[j]!, items[i]!];
        }
        return JSON.stringify({ result: items });
      }
      case "sample": {
        const items = this.parse_items(String(params.items || "[]"));
        const count = Math.min(Number(params.count) || 1, items.length);
        const copy = [...items];
        const result: unknown[] = [];
        for (let i = 0; i < count; i++) {
          const idx = randomInt(0, copy.length);
          result.push(copy.splice(idx, 1)[0]);
        }
        return JSON.stringify({ result, count: result.length });
      }
      case "password": {
        const length = Math.max(4, Math.min(Number(params.length) || 16, 128));
        const charset_name = String(params.charset || "symbols");
        const charsets: Record<string, string> = {
          alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
          symbols: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+",
          hex: "0123456789abcdef",
          numeric: "0123456789",
        };
        const chars = charsets[charset_name] || charsets.symbols!;
        const bytes = randomBytes(length);
        let password = "";
        for (let i = 0; i < length; i++) password += chars[bytes[i]! % chars.length];
        return JSON.stringify({ password, length });
      }
      case "bytes": {
        const count = Math.max(1, Math.min(Number(params.count) || 16, 1024));
        return JSON.stringify({ hex: randomBytes(count).toString("hex"), bytes: count });
      }
      case "coin":
        return JSON.stringify({ value: randomInt(0, 2) === 0 ? "heads" : "tails" });
      case "dice": {
        const sides = Math.max(2, Number(params.sides) || 6);
        const count = Math.max(1, Math.min(Number(params.count) || 1, 100));
        const rolls: number[] = [];
        for (let i = 0; i < count; i++) rolls.push(randomInt(1, sides + 1));
        return JSON.stringify({ rolls, sum: rolls.reduce((a, b) => a + b, 0) });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private parse_items(input: string): unknown[] {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fallthrough */ }
    return input.split(",").map((s) => s.trim()).filter(Boolean);
  }
}
