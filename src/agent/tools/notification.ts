/** Notification 도구 — 시스템 알림 전송 (로컬 로그 + 선택적 외부 webhook). */

import { Tool } from "./base.js";
import { error_message, make_abort_signal, now_iso } from "../../utils/common.js";
import { HTTP_FETCH_QUICK_TIMEOUT_MS } from "../../utils/timeouts.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

type NotifyCallback = (payload: { level: string; title: string; body: string; metadata?: Record<string, unknown> }) => Promise<void>;

export class NotificationTool extends Tool {
  readonly name = "notification";
  readonly category = "messaging" as const;
  readonly policy_flags = { network: true } as const;
  readonly description = "Send system notifications with level, title, and body.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      level: { type: "string", enum: ["info", "warn", "error", "success"], description: "Notification level" },
      title: { type: "string", description: "Notification title" },
      body: { type: "string", description: "Notification body" },
      webhook_url: { type: "string", description: "Optional webhook URL for external delivery" },
    },
    required: ["title"],
    additionalProperties: false,
  };

  private readonly on_notify: NotifyCallback | null;

  constructor(options?: { on_notify?: NotifyCallback }) {
    super();
    this.on_notify = options?.on_notify ?? null;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const level = String(params.level || "info");
    const title = String(params.title || "").trim();
    const body = String(params.body || "").trim();
    const webhook_url = String(params.webhook_url || "").trim();

    if (!title) return "Error: title is required";

    const results: string[] = [];

    if (this.on_notify) {
      try {
        await this.on_notify({ level, title, body });
        results.push("internal: delivered");
      } catch (err) {
        results.push(`internal: failed — ${error_message(err)}`);
      }
    } else {
      results.push(`internal: logged [${level.toUpperCase()}] ${title}`);
    }

    if (webhook_url) {
      try {
        const url = new URL(webhook_url);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return "Error: webhook_url must be http or https";
        }
        const res = await fetch(webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level, title, body, timestamp: now_iso() }),
          signal: make_abort_signal(HTTP_FETCH_QUICK_TIMEOUT_MS, context?.signal),
        });
        results.push(`webhook: ${res.status} ${res.statusText}`);
      } catch (err) {
        results.push(`webhook: failed — ${error_message(err)}`);
      }
    }

    return results.join("\n");
  }
}
