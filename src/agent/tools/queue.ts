/** Queue 도구 — 인메모리 FIFO/LIFO/Priority 큐. 배치 처리·이벤트 버퍼링용. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const MAX_QUEUES = 50;
const MAX_QUEUE_SIZE = 10_000;
const MAX_VALUE_SIZE = 1024 * 64;

type QueueEntry = { value: string; priority: number; ts: number };

export class QueueTool extends Tool {
  readonly name = "queue";
  readonly category = "memory" as const;
  readonly description =
    "In-memory queue (FIFO, LIFO, Priority). Operations: enqueue, dequeue, peek, size, drain, list, clear, delete.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["enqueue", "dequeue", "peek", "size", "drain", "list", "clear", "delete"], description: "Queue operation" },
      queue: { type: "string", description: "Queue name" },
      value: { type: "string", description: "Value to enqueue" },
      priority: { type: "integer", minimum: 0, maximum: 100, description: "Priority (0=highest, for priority mode)" },
      mode: { type: "string", enum: ["fifo", "lifo", "priority"], description: "Queue mode (default: fifo)" },
      count: { type: "integer", minimum: 1, maximum: 1000, description: "Number of items to drain (for drain)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  private readonly queues = new Map<string, { mode: string; items: QueueEntry[] }>();

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "list");
    const name = String(params.queue || "default").trim();

    switch (op) {
      case "enqueue": {
        const value = String(params.value ?? "");
        if (value.length > MAX_VALUE_SIZE) return `Error: value exceeds ${MAX_VALUE_SIZE} bytes`;
        const mode = String(params.mode || "fifo");
        let q = this.queues.get(name);
        if (!q) {
          if (this.queues.size >= MAX_QUEUES) return `Error: max ${MAX_QUEUES} queues reached`;
          q = { mode, items: [] };
          this.queues.set(name, q);
        }
        if (q.items.length >= MAX_QUEUE_SIZE) return `Error: queue "${name}" full (max ${MAX_QUEUE_SIZE})`;
        const priority = Number(params.priority ?? 50);
        q.items.push({ value, priority, ts: Date.now() });
        if (q.mode === "priority") q.items.sort((a, b) => a.priority - b.priority);
        return `Enqueued to "${name}" (size: ${q.items.length})`;
      }

      case "dequeue": {
        const q = this.queues.get(name);
        if (!q || q.items.length === 0) return "Error: queue empty or not found";
        const entry = q.mode === "lifo" ? q.items.pop()! : q.items.shift()!;
        return entry.value;
      }

      case "peek": {
        const q = this.queues.get(name);
        if (!q || q.items.length === 0) return "Error: queue empty or not found";
        const entry = q.mode === "lifo" ? q.items[q.items.length - 1] : q.items[0];
        return entry.value;
      }

      case "size": {
        const q = this.queues.get(name);
        return JSON.stringify({ queue: name, size: q?.items.length ?? 0, mode: q?.mode ?? "none" });
      }

      case "drain": {
        const q = this.queues.get(name);
        if (!q || q.items.length === 0) return JSON.stringify({ queue: name, drained: [] });
        const count = Math.min(Number(params.count || q.items.length), q.items.length);
        const drained = q.mode === "lifo"
          ? q.items.splice(-count).reverse()
          : q.items.splice(0, count);
        return JSON.stringify({ queue: name, drained: drained.map((e) => e.value), remaining: q.items.length });
      }

      case "list":
        if (this.queues.size === 0) return "(no queues)";
        return JSON.stringify(
          [...this.queues.entries()].map(([k, v]) => ({ name: k, mode: v.mode, size: v.items.length })),
          null, 2,
        );

      case "clear": {
        const q = this.queues.get(name);
        if (!q) return `Queue "${name}" not found`;
        const count = q.items.length;
        q.items.length = 0;
        return `Cleared ${count} items from "${name}"`;
      }

      case "delete":
        return this.queues.delete(name) ? `Deleted queue "${name}"` : `Queue "${name}" not found`;

      default:
        return `Error: unsupported operation "${op}"`;
    }
  }
}
