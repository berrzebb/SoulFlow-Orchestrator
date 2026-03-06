/** Clipboard 도구 — 워크플로우 메모리 기반 임시 키-값 저장소. */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

const MAX_ENTRIES = 100;
const MAX_VALUE_SIZE = 1024 * 256;

export class ClipboardTool extends Tool {
  readonly name = "clipboard";
  readonly category = "memory" as const;
  readonly description = "Temporary key-value clipboard for storing and retrieving data within a session.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["set", "get", "list", "delete", "clear"], description: "Clipboard operation" },
      key: { type: "string", description: "Clipboard key" },
      value: { type: "string", description: "Value to store (for 'set' operation)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  private readonly store = new Map<string, string>();

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "list");
    const key = String(params.key || "").trim();

    switch (op) {
      case "set": {
        if (!key) return "Error: key is required";
        const value = String(params.value ?? "");
        if (value.length > MAX_VALUE_SIZE) return `Error: value exceeds ${MAX_VALUE_SIZE} bytes`;
        if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) return `Error: clipboard full (max ${MAX_ENTRIES} entries)`;
        this.store.set(key, value);
        return `Stored "${key}" (${value.length} chars)`;
      }
      case "get": {
        if (!key) return "Error: key is required";
        const val = this.store.get(key);
        return val !== undefined ? val : `Error: key "${key}" not found`;
      }
      case "list": {
        if (this.store.size === 0) return "(empty clipboard)";
        const entries = [...this.store.entries()].map(([k, v]) => `${k}: ${v.length} chars`);
        return entries.join("\n");
      }
      case "delete": {
        if (!key) return "Error: key is required";
        return this.store.delete(key) ? `Deleted "${key}"` : `Key "${key}" not found`;
      }
      case "clear": {
        const count = this.store.size;
        this.store.clear();
        return `Cleared ${count} entries`;
      }
      default:
        return `Error: unsupported operation "${op}"`;
    }
  }
}
