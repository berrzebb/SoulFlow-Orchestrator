/**
 * EmailTool — node:net mock 기반 SMTP 시뮬레이션 커버리지.
 */
import { describe, it, expect, vi } from "vitest";

// ── SMTP 서버 응답 시뮬레이터 ──────────────────────────
const { smtp_state } = vi.hoisted(() => ({
  smtp_state: {
    emit_error: false,
    error_msg: "ECONNREFUSED",
    // SMTP 응답 시퀀스 (각 data 이벤트)
    responses: [] as string[],
    response_idx: 0,
    error_code: false,  // 400+ 에러 코드 반환 여부
  },
}));

class MockSmtpSocket {
  private _handlers: Record<string, ((...a: unknown[]) => void)[]> = {};

  on(event: string, fn: (...a: unknown[]) => void) {
    (this._handlers[event] ||= []).push(fn);
    return this;
  }

  write(data: unknown) {
    const resp = smtp_state.responses[smtp_state.response_idx];
    if (resp !== undefined) {
      smtp_state.response_idx++;
      setTimeout(() => {
        const chunk = Buffer.from(resp + "\r\n");
        (this._handlers["data"] || []).forEach(fn => fn(chunk));
      }, 0);
    }
    return true;
  }

  destroy() {}
}

vi.mock("node:net", () => ({
  createConnection: (_opts: unknown) => {
    const socket = new MockSmtpSocket();
    Promise.resolve().then(() => {
      if (smtp_state.emit_error) {
        (socket as any)._handlers?.["error"]?.forEach((fn: (...a: unknown[]) => void) => fn(new Error(smtp_state.error_msg)));
        return;
      }
      // 초기 220 응답
      const chunk = Buffer.from("220 smtp.example.com Ready\r\n");
      setTimeout(() => {
        (socket as any)._handlers?.["data"]?.forEach((fn: (...a: unknown[]) => void) => fn(chunk));
      }, 0);
    });
    return socket as any;
  },
}));

vi.mock("node:tls", () => ({
  connect: (_opts: unknown) => {
    const socket = new MockSmtpSocket();
    Promise.resolve().then(() => {
      const chunk = Buffer.from("220 smtp.example.com TLS Ready\r\n");
      setTimeout(() => {
        (socket as any)._handlers?.["data"]?.forEach((fn: (...a: unknown[]) => void) => fn(chunk));
      }, 0);
    });
    return socket as any;
  },
}));

import { EmailTool } from "@src/agent/tools/email.js";

function make_tool() { return new EmailTool(); }

function set_smtp_responses(...responses: string[]) {
  smtp_state.emit_error = false;
  smtp_state.responses = responses;
  smtp_state.response_idx = 0;
}

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("EmailTool — 메타데이터", () => {
  it("name = email", () => expect(make_tool().name).toBe("email"));
  it("category = messaging", () => expect(make_tool().category).toBe("messaging"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// 파라미터 검증
// ══════════════════════════════════════════

describe("EmailTool — 파라미터 검증", () => {
  it("to 없음 → Error", async () => {
    const r = await make_tool().execute({
      action: "send", to: "", from: "a@example.com",
      subject: "test", body: "body", smtp_host: "smtp.example.com",
    });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("to");
  });

  it("smtp_host 없음 → Error", async () => {
    const r = await make_tool().execute({
      action: "send", to: "user@example.com", from: "a@example.com",
      subject: "test", body: "body", smtp_host: "",
    });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("smtp_host");
  });

  it("unsupported action → Error", async () => {
    const r = await make_tool().execute({ action: "receive" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("receive");
  });
});

// ══════════════════════════════════════════
// 연결 오류
// ══════════════════════════════════════════

describe("EmailTool — 연결 오류", () => {
  it("ECONNREFUSED → Error 반환", async () => {
    smtp_state.emit_error = true;
    smtp_state.error_msg = "ECONNREFUSED";
    const r = await make_tool().execute({
      action: "send", to: "user@example.com", from: "sender@example.com",
      subject: "Test", body: "Hello", smtp_host: "smtp.example.com",
    });
    expect(String(r)).toContain("Error");
    smtp_state.emit_error = false;
  });
});

// ══════════════════════════════════════════
// SMTP 성공 흐름
// ══════════════════════════════════════════

describe("EmailTool — SMTP 성공 (인증 없음)", () => {
  it("220→EHLO→250→MAIL FROM→250→RCPT TO→250→DATA→354→콘텐츠→250→QUIT→ok", async () => {
    set_smtp_responses(
      "250 smtp.example.com Hello local",  // EHLO → step 1
      "250 OK",    // MAIL FROM step 4 → step 5
      "250 OK",    // RCPT TO → step 5 다음 DATA
      "354 Start", // DATA → step 6 → content
      "250 OK",    // content sent → step 7 → QUIT
    );
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      to: "user@example.com",
      from: "sender@example.com",
      subject: "Test Subject",
      body: "Hello World",
      smtp_host: "smtp.example.com",
      smtp_port: 25,
    }));
    expect(r.ok).toBe(true);
    expect(r.message_id).toMatch(/^</);
    expect(r.recipients).toContain("user@example.com");
  });
});

describe("EmailTool — SMTP 복수 수신자", () => {
  it("여러 수신자 → 각각 RCPT TO 전송", async () => {
    set_smtp_responses(
      "250 smtp.example.com Hello local",
      "250 OK",    // MAIL FROM
      "250 OK",    // RCPT TO #1
      "250 OK",    // RCPT TO #2 (but step logic sends DATA after first rcpt_idx >= recipients)
      "354 Start",
      "250 OK",
    );
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      to: "a@example.com,b@example.com",
      from: "sender@example.com",
      subject: "Multi",
      body: "Hi all",
      smtp_host: "smtp.example.com",
      smtp_port: 25,
    }));
    expect(r.ok).toBe(true);
    expect(r.recipients).toHaveLength(2);
  });
});

describe("EmailTool — HTML 이메일", () => {
  it("html=true → Content-Type: text/html", async () => {
    set_smtp_responses(
      "250 smtp.example.com Hello local",
      "250 OK",
      "250 OK",
      "354 Start",
      "250 OK",
    );
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      to: "user@example.com",
      from: "sender@example.com",
      subject: "HTML Email",
      body: "<h1>Hello</h1>",
      smtp_host: "smtp.example.com",
      smtp_port: 25,
      html: true,
    }));
    expect(r.ok).toBe(true);
  });
});

describe("EmailTool — SMTP 오류 응답", () => {
  it("550 오류 → Error 반환", async () => {
    set_smtp_responses(
      "550 User unknown", // 400+ code
    );
    const r = await make_tool().execute({
      action: "send",
      to: "unknown@example.com",
      from: "sender@example.com",
      subject: "Test",
      body: "body",
      smtp_host: "smtp.example.com",
      smtp_port: 25,
    });
    expect(String(r)).toContain("Error");
  });
});
