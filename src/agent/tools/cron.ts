import type { CronScheduler } from "../../cron/contracts.js";
import type { CronSchedule } from "../../cron/types.js";
import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

function parse_iso_date_ms(text: string): number | null {
  const t = Date.parse(text);
  return Number.isFinite(t) ? t : null;
}

export class CronTool extends Tool {
  readonly name = "cron";
  readonly description = "Manage scheduled jobs. action: add|list|remove|enable|disable|run|status";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "list", "remove", "enable", "disable", "run", "status"],
      },
      name: { type: "string" },
      message: { type: "string" },
      every_seconds: { type: "integer", minimum: 1 },
      cron_expr: { type: "string" },
      tz: { type: "string" },
      at: { type: "string", description: "ISO datetime for one-shot schedule" },
      job_id: { type: "string" },
      deliver: { type: "boolean" },
      channel: { type: "string" },
      to: { type: "string" },
      delete_after_run: { type: "boolean" },
      include_disabled: { type: "boolean" },
      force: { type: "boolean" },
    },
    required: ["action"],
    additionalProperties: false,
  };
  private readonly cron: CronScheduler;

  constructor(cron: CronScheduler) {
    super();
    this.cron = cron;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "");
    if (action === "status") {
      return JSON.stringify(await this.cron.status());
    }
    if (action === "list") {
      const rows = await this.cron.list_jobs(Boolean(params.include_disabled));
      return JSON.stringify(rows);
    }
    if (action === "remove") {
      const job_id = String(params.job_id || "");
      if (!job_id) return "Error: job_id is required";
      const removed = await this.cron.remove_job(job_id);
      return removed ? `removed:${job_id}` : `not_found:${job_id}`;
    }
    if (action === "enable" || action === "disable") {
      const job_id = String(params.job_id || "");
      if (!job_id) return "Error: job_id is required";
      const enabled = action === "enable";
      const row = await this.cron.enable_job(job_id, enabled);
      return row ? JSON.stringify(row) : `not_found:${job_id}`;
    }
    if (action === "run") {
      const job_id = String(params.job_id || "");
      if (!job_id) return "Error: job_id is required";
      const ok = await this.cron.run_job(job_id, Boolean(params.force));
      return ok ? `run:${job_id}` : `cannot_run:${job_id}`;
    }
    if (action !== "add") return `Error: unsupported action '${action}'`;

    const schedule = this._parse_schedule(params);
    if (typeof schedule === "string") return `Error: ${schedule}`;
    const message = String(params.message || "");
    if (!message) return "Error: message is required";
    const name = String(params.name || message.slice(0, 40));
    const deliver = this.resolve_deliver_mode(params, message);
    const channel = this.resolve_target_channel(params, context);
    const to = this.resolve_target_chat_id(params, context);
    const delete_after_run = this.resolve_delete_after_run(params, schedule);
    const job = await this.cron.add_job(
      name,
      schedule,
      message,
      deliver,
      channel,
      to,
      delete_after_run,
    );
    return JSON.stringify(job);
  }

  private _parse_schedule(params: Record<string, unknown>): CronSchedule | string {
    const every_seconds = Number(params.every_seconds || 0);
    const cron_expr = params.cron_expr ? String(params.cron_expr) : "";
    const at = params.at ? String(params.at) : "";
    const tz = params.tz ? String(params.tz) : null;
    if (every_seconds > 0) {
      return { kind: "every", every_ms: every_seconds * 1000 };
    }
    if (cron_expr) {
      return { kind: "cron", expr: cron_expr, tz };
    }
    if (at) {
      const at_ms = parse_iso_date_ms(at);
      if (!at_ms) return "invalid_at_datetime";
      return { kind: "at", at_ms };
    }
    return "one of every_seconds, cron_expr, at is required";
  }

  private resolve_target_channel(params: Record<string, unknown>, context?: ToolExecutionContext): string | null {
    const explicit = String(params.channel || "").trim();
    if (explicit) return explicit;
    const from_context = String(context?.channel || "").trim();
    return from_context || null;
  }

  private resolve_target_chat_id(params: Record<string, unknown>, context?: ToolExecutionContext): string | null {
    const explicit = String(params.to || "").trim();
    if (explicit) return explicit;
    const from_context = String(context?.chat_id || "").trim();
    return from_context || null;
  }

  private resolve_delete_after_run(params: Record<string, unknown>, schedule: CronSchedule): boolean {
    if (typeof params.delete_after_run === "boolean") return Boolean(params.delete_after_run);
    // One-shot jobs are auto-cleaned by default unless explicitly overridden.
    return schedule.kind === "at";
  }

  private resolve_deliver_mode(params: Record<string, unknown>, message: string): boolean {
    if (typeof params.deliver === "boolean") return Boolean(params.deliver);
    const text = String(message || "").toLowerCase();
    if (!text) return false;
    return /(remind|reminder|알림|리마인드|알려줘|깨워)/i.test(text);
  }
}
