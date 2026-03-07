/** Cron Shell 도구 — 경량 쉘 명령 스케줄링 (인메모리, 크론 표현식 기반). */

import { Tool } from "./base.js";
import { run_shell_command } from "./shell-runtime.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

interface CronEntry {
  id: string;
  expression: string;
  command: string;
  last_run?: string;
  last_result?: string;
  last_error?: string;
  run_count: number;
  enabled: boolean;
}

const MAX_ENTRIES = 50;

export class CronShellTool extends Tool {
  readonly name = "cron_shell";
  readonly category = "scheduling" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "Schedule shell commands with cron expressions. List, register, remove, or trigger jobs.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["list", "register", "remove", "trigger", "status"],
        description: "Operation",
      },
      id: { type: "string", description: "Job ID (for register/remove/trigger)" },
      expression: { type: "string", description: "Cron expression (for register, e.g. '*/5 * * * *')" },
      command: { type: "string", description: "Shell command to schedule (for register)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  private readonly entries = new Map<string, CronEntry>();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly workspace: string;

  constructor(options: { workspace: string }) {
    super();
    this.workspace = options.workspace;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "list");

    switch (op) {
      case "list": {
        if (this.entries.size === 0) return "(no scheduled jobs)";
        const rows = [...this.entries.values()].map((e) =>
          `${e.id}: ${e.expression} | ${e.command.slice(0, 60)} | runs=${e.run_count} enabled=${e.enabled}`
        );
        return rows.join("\n");
      }
      case "register": {
        const id = String(params.id || "").trim();
        const expr = String(params.expression || "").trim();
        const command = String(params.command || "").trim();
        if (!id || !expr || !command) return "Error: id, expression, and command are required";
        if (this.entries.size >= MAX_ENTRIES && !this.entries.has(id)) return `Error: max ${MAX_ENTRIES} jobs`;
        const interval_ms = this.cron_to_interval_ms(expr);
        if (!interval_ms) return "Error: only simple cron intervals supported (e.g., */5 * * * *)";
        const entry: CronEntry = { id, expression: expr, command, run_count: 0, enabled: true };
        this.entries.set(id, entry);
        if (this.timers.has(id)) clearInterval(this.timers.get(id)!);
        this.timers.set(id, setInterval(() => this.execute_job(entry), interval_ms));
        return `Registered "${id}": every ${interval_ms / 1000}s — ${command.slice(0, 80)}`;
      }
      case "remove": {
        const id = String(params.id || "").trim();
        if (!id) return "Error: id is required";
        if (this.timers.has(id)) { clearInterval(this.timers.get(id)!); this.timers.delete(id); }
        return this.entries.delete(id) ? `Removed "${id}"` : `Job "${id}" not found`;
      }
      case "trigger": {
        const id = String(params.id || "").trim();
        const entry = this.entries.get(id);
        if (!entry) return `Error: job "${id}" not found`;
        await this.execute_job(entry);
        return `Triggered "${id}": ${entry.last_result || entry.last_error || "(no output)"}`;
      }
      case "status": {
        const id = String(params.id || "").trim();
        const entry = this.entries.get(id);
        if (!entry) return `Error: job "${id}" not found`;
        return JSON.stringify(entry, null, 2);
      }
      default:
        return `Error: unsupported operation "${op}"`;
    }
  }

  private async execute_job(entry: CronEntry): Promise<void> {
    if (!entry.enabled) return;
    try {
      const { stdout, stderr } = await run_shell_command(entry.command, {
        cwd: this.workspace,
        timeout_ms: 60_000,
        max_buffer_bytes: 1024 * 1024,
      });
      entry.last_result = (stdout || "").trim().slice(0, 500);
      entry.last_error = (stderr || "").trim().slice(0, 200) || undefined;
      entry.run_count++;
      entry.last_run = new Date().toISOString();
    } catch (err) {
      entry.last_error = error_message(err).slice(0, 500);
      entry.last_run = new Date().toISOString();
      entry.run_count++;
    }
  }

  /** 단순 cron 간격만 파싱. 복잡한 표현식은 미지원. */
  private cron_to_interval_ms(expr: string): number | null {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return null;
    const minute_match = parts[0].match(/^\*\/(\d+)$/);
    if (minute_match) return Number(minute_match[1]) * 60_000;
    const hour_match = parts[1].match(/^\*\/(\d+)$/);
    if (hour_match && parts[0] === "0") return Number(hour_match[1]) * 3600_000;
    if (parts[0] === "*" && parts[1] === "*") return 60_000;
    return null;
  }
}
