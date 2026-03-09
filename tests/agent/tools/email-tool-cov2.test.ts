/**
 * EmailTool — 미커버 SMTP 분기 보충.
 * AUTH LOGIN (port=25 + user), STARTTLS 플로우 (port=587 + user),
 * TLS+AUTH LOGIN (port=465), AbortSignal cleanup.
 */
import { describe, it, expect, vi } from "vitest";

const { smtp_cov2 } = vi.hoisted(() => ({
  smtp_cov2: { responses: [] as string[], idx: 0, emit_error: false },
}));

class StarttlsSocket {
  _handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  on(ev: string, fn: (...a: unknown[]) => void) { (this._handlers[ev] ||= []).push(fn); return this; }
  _emit() {
    const r = smtp_cov2.responses[smtp_cov2.idx++];
    if (r !== undefined) setTimeout(() => { const c = Buffer.from(r+"\r\n"); (this._handlers["data"]||[]).forEach(f=>f(c)); }, 0);
  }
  write(data: unknown) {
    this._emit();
    if (String(data).trim().startsWith("STARTTLS")) setTimeout(() => this._emit(), 25);
    return true;
  }
  destroy() {}
}

vi.mock("node:net", () => ({
  createConnection: (_opts: unknown) => {
    const s = new StarttlsSocket();
    setTimeout(() => { const c = Buffer.from("220 smtp.example.com Ready\r\n"); (s._handlers["data"]||[]).forEach(f=>f(c)); }, 0);
    return s as any;
  },
}));

vi.mock("node:tls", () => ({
  connect: (_opts: unknown) => {
    const s = new StarttlsSocket();
    setTimeout(() => { const c = Buffer.from("220 smtp.example.com TLS Ready\r\n"); (s._handlers["data"]||[]).forEach(f=>f(c)); }, 0);
    return s as any;
  },
}));

import { EmailTool } from "@src/agent/tools/email.js";

function set_smtp(...rs: string[]) { smtp_cov2.responses = rs; smtp_cov2.idx = 0; smtp_cov2.emit_error = false; }

describe("EmailTool — AUTH LOGIN 플로우 (port=25 + user)", () => {
  it("EHLO→AUTH LOGIN→username base64→password base64→MAIL→RCPT→DATA→ok", async () => {
    set_smtp(
      "250 smtp.example.com Hello",
      "334 Username:", "334 Password:", "235 OK",
      "250 OK", "250 OK", "354 Start", "250 OK",
    );
    const r = JSON.parse(await new EmailTool().execute({ action:"send", to:"u@e.com", from:"s@e.com", subject:"T", body:"B", smtp_host:"h", smtp_port:25, smtp_user:"user", smtp_pass:"pass" }));
    expect(r.ok).toBe(true);
  }, 10000);
});

describe("EmailTool — STARTTLS 플로우 (port=587 + user)", () => {
  it("EHLO→STARTTLS→step10→post-TLS EHLO→AUTH LOGIN→ok", async () => {
    set_smtp(
      "250 smtp.example.com Hello",  // EHLO → STARTTLS
      "220 Go ahead",                 // STARTTLS resp → step10 → step=1; then extra emit fires:
      "250 smtp.example.com Hello TLS", // post-TLS greeting → AUTH LOGIN
      "334 Username:", "334 Password:", "235 OK",
      "250 OK", "250 OK", "354 Start", "250 OK",
    );
    const r = JSON.parse(await new EmailTool().execute({ action:"send", to:"u@e.com", from:"s@e.com", subject:"T", body:"B", smtp_host:"h", smtp_port:587, smtp_user:"user", smtp_pass:"pass" }));
    expect(r.ok).toBe(true);
  }, 10000);
});

describe("EmailTool — TLS AUTH LOGIN (port=465)", () => {
  it("TLS 연결 후 AUTH LOGIN → ok", async () => {
    set_smtp(
      "250 smtp.example.com Hello TLS",
      "334 Username:", "334 Password:", "235 OK",
      "250 OK", "250 OK", "354 Start", "250 OK",
    );
    const r = JSON.parse(await new EmailTool().execute({ action:"send", to:"u@e.com", from:"s@e.com", subject:"T", body:"B", smtp_host:"h", smtp_port:465, smtp_user:"user", smtp_pass:"pass" }));
    expect(r.ok).toBe(true);
  }, 10000);
});

describe("EmailTool — AbortSignal cleanup", () => {
  it("AbortSignal 제공 → signal listener 등록됨 (전송 성공)", async () => {
    set_smtp("250 Hello", "250 OK", "250 OK", "354 Start", "250 OK");
    const ctrl = new AbortController();
    const tool = new EmailTool();
    const r = JSON.parse(await (tool as any).run({ action:"send", to:"u@e.com", from:"s@e.com", subject:"T", body:"B", smtp_host:"h", smtp_port:25 }, { signal: ctrl.signal }));
    expect(r.ok).toBe(true);
  }, 10000);
});
