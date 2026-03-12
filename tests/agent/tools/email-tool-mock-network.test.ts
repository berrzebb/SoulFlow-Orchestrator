/**
 * EmailTool — 미커버 분기: socket timeout (L129).
 */
import { describe, it, expect, vi } from "vitest";

const { cov2_state } = vi.hoisted(() => ({
  cov2_state: { emit_timeout: false },
}));

class TimeoutSocket {
  _handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  on(event: string, fn: (...a: unknown[]) => void) { (this._handlers[event] ||= []).push(fn); return this; }
  write(_d: unknown) {
    if (cov2_state.emit_timeout) {
      setTimeout(() => (this._handlers["timeout"] || []).forEach(fn => fn()), 0);
    }
    return true;
  }
  destroy() {}
}

vi.mock("node:net", () => ({
  createConnection: (_opts: unknown) => {
    const socket = new TimeoutSocket();
    Promise.resolve().then(() => {
      const chunk = Buffer.from("220 smtp.example.com Ready\r\n");
      setTimeout(() => (socket._handlers["data"] || []).forEach(fn => fn(chunk)), 0);
    });
    return socket as unknown as ReturnType<typeof import("node:net").createConnection>;
  },
}));

vi.mock("node:tls", () => ({
  connect: () => new TimeoutSocket() as unknown as ReturnType<typeof import("node:tls").connect>,
}));

const { EmailTool } = await import("../../../src/agent/tools/email.js");

describe("EmailTool — socket timeout (L129)", () => {
  it("socket timeout 이벤트 → SMTP timeout error (L129)", async () => {
    cov2_state.emit_timeout = true;
    const tool = new EmailTool();
    const result = await tool.execute({
      action: "send",
      to: "user@example.com",
      from: "sender@example.com",
      subject: "Test",
      body: "Hello",
      smtp_host: "smtp.example.com",
      smtp_port: 25,
    });
    cov2_state.emit_timeout = false;
    const r_str = String(result);
    expect(r_str).toContain("Error");
    expect(r_str).toContain("timeout");
  });
});
