/** Email 도구 — SMTP 전송 (Node.js net/tls 기반 경량 구현). */

import { createConnection } from "node:net";
import { connect as tls_connect } from "node:tls";
import { Tool } from "./base.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export class EmailTool extends Tool {
  readonly name = "email";
  readonly category = "messaging" as const;
  readonly policy_flags = { network: true, write: true } as const;
  readonly description = "Send emails via SMTP. Actions: send.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["send"], description: "Operation" },
      to: { type: "string", description: "Recipient email (comma-separated for multiple)" },
      from: { type: "string", description: "Sender email" },
      subject: { type: "string", description: "Email subject" },
      body: { type: "string", description: "Email body (plain text)" },
      smtp_host: { type: "string", description: "SMTP server hostname" },
      smtp_port: { type: "integer", description: "SMTP port (default: 587)" },
      smtp_user: { type: "string", description: "SMTP username" },
      smtp_pass: { type: "string", description: "SMTP password" },
      html: { type: "boolean", description: "Send as HTML (default: false)" },
    },
    required: ["action", "to", "from", "subject", "body", "smtp_host"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "send");
    if (action !== "send") return `Error: unsupported action "${action}"`;

    const to = String(params.to || "").trim();
    const from = String(params.from || "").trim();
    const subject = String(params.subject || "").trim();
    const body = String(params.body || "");
    const host = String(params.smtp_host || "").trim();
    const port = Number(params.smtp_port || 587);
    const user = String(params.smtp_user || "").trim();
    const pass = String(params.smtp_pass || "");
    const is_html = Boolean(params.html);

    if (!to || !from || !host) return "Error: to, from, and smtp_host are required";

    try {
      const result = await this.send_smtp({ to, from, subject, body, host, port, user, pass, is_html }, context?.signal);
      return JSON.stringify({ ok: true, ...result });
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private send_smtp(opts: {
    to: string; from: string; subject: string; body: string;
    host: string; port: number; user: string; pass: string; is_html: boolean;
  }, signal?: AbortSignal): Promise<{ message_id: string; recipients: string[] }> {
    return new Promise((resolve, reject) => {
      const recipients = opts.to.split(",").map((e) => e.trim()).filter(Boolean);
      const use_tls = opts.port === 465;
      const timeout = 30_000;

      const socket = use_tls
        ? tls_connect({ host: opts.host, port: opts.port, timeout })
        : createConnection({ host: opts.host, port: opts.port, timeout });

      let buffer = "";
      let step = 0;
      const message_id = `<${Date.now()}.${Math.random().toString(36).slice(2)}@local>`;

      const cleanup = () => { try { socket.destroy(); } catch { /* */ } };
      if (signal) signal.addEventListener("abort", cleanup, { once: true });

      const send = (cmd: string) => socket.write(cmd + "\r\n");

      const content_type = opts.is_html ? "text/html" : "text/plain";
      const mail_data = [
        `From: ${opts.from}`,
        `To: ${recipients.join(", ")}`,
        `Subject: ${opts.subject}`,
        `Message-ID: ${message_id}`,
        `Content-Type: ${content_type}; charset=UTF-8`,
        `Date: ${new Date().toUTCString()}`,
        "",
        opts.body,
      ].join("\r\n");

      let rcpt_idx = 0;

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\r\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          const code = parseInt(line.slice(0, 3), 10);
          if (code >= 400) { cleanup(); reject(new Error(line)); return; }

          switch (step) {
            case 0: send(`EHLO local`); step++; break;
            case 1:
              if (line.startsWith("250 ") || (line.startsWith("250-") && !line.includes("250-"))) {
                if (opts.user && !use_tls && opts.port === 587) { send("STARTTLS"); step = 10; }
                else if (opts.user) { send("AUTH LOGIN"); step = 2; }
                else { send(`MAIL FROM:<${opts.from}>`); step = 4; }
              }
              break;
            case 2: send(Buffer.from(opts.user).toString("base64")); step++; break;
            case 3: send(Buffer.from(opts.pass).toString("base64")); step++; break;
            case 4: send(`MAIL FROM:<${opts.from}>`); step++; break;
            case 5:
              if (rcpt_idx < recipients.length) { send(`RCPT TO:<${recipients[rcpt_idx++]}>`); }
              else { send("DATA"); step++; }
              if (rcpt_idx < recipients.length) break;
              send("DATA"); step++;
              break;
            case 6:
              if (code === 354 || code === 250) { send(mail_data + "\r\n."); step++; }
              break;
            case 7: send("QUIT"); step++; cleanup(); resolve({ message_id, recipients }); break;
            case 10: step = 1; break;
          }
        }
      });

      socket.on("error", (err) => { cleanup(); reject(err); });
      socket.on("timeout", () => { cleanup(); reject(new Error("SMTP timeout")); });
    });
  }
}
