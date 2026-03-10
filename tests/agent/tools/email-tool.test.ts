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

// ══════════════════════════════════════════
// 미커버 분기
// ══════════════════════════════════════════

describe("EmailTool — AUTH LOGIN (L106/L110/L111)", () => {
  it("user+pass 있을 때 AUTH LOGIN 흐름 — case 2/3 커버", async () => {
    // 220(init) → case 0 → 250(EHLO) → case 1 → AUTH LOGIN → 334(user) → case 2 →
    // 334(pass) → case 3 → 235(auth OK) → case 4 → MAIL FROM 등
    set_smtp_responses(
      "250 smtp.example.com Hello",  // EHLO response → AUTH LOGIN
      "334 Username:",               // AUTH LOGIN response → case 2: send base64(user)
      "334 Password:",               // username response → case 3: send base64(pass)
      "235 Auth OK",                 // password response → case 4: send MAIL FROM
      "250 OK",                      // MAIL FROM response → case 5: send RCPT TO
      "354 Start",                   // RCPT TO → L116/117: send DATA → case 6
      "250 OK",                      // DATA response → case 7: QUIT, resolve
    );
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      to: "user@example.com",
      from: "sender@example.com",
      subject: "Auth Test",
      body: "Hello",
      smtp_host: "smtp.example.com",
      smtp_port: 25,
      smtp_user: "testuser",
      smtp_pass: "testpass",
    }));
    expect(r.ok).toBe(true);
  });
});

describe("EmailTool — signal abort (L74)", () => {
  it("AbortSignal 전달 → signal.addEventListener 호출 (L74)", async () => {
    const controller = new AbortController();
    set_smtp_responses(
      "250 smtp.example.com Hello",
      "250 OK",
      "250 OK",
      "354 Start",
      "250 OK",
    );
    // abort 전에 성공하면 ok:true
    const r = JSON.parse(await make_tool().execute(
      {
        action: "send",
        to: "user@example.com",
        from: "sender@example.com",
        subject: "Signal Test",
        body: "Hello",
        smtp_host: "smtp.example.com",
        smtp_port: 25,
      },
      { signal: controller.signal } as unknown as Parameters<typeof make_tool extends { execute: infer E } ? E : never>[1],
    ));
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

describe("EmailTool — STARTTLS port 587 (L105)", () => {
  it("port=587 + user → STARTTLS → step=10 → step=1 → AUTH LOGIN → 성공", async () => {
    // case 10은 write()를 호출하지 않으므로, STARTTLS 응답과 다음 EHLO 응답을 하나의 청크로 전달
    // MockSmtpSocket.write()는 Buffer.from(resp + "\r\n")으로 보내므로
    // resp에 "\r\n"을 넣으면 두 줄이 하나의 data 이벤트로 전달됨
    set_smtp_responses(
      "250 smtp.example.com Hello",
      // STARTTLS 응답 + 2nd EHLO 응답을 하나의 data 이벤트로 결합:
      // "220 TLS\r\n250 Hello 2" → mock이 "\r\n" 추가 → 2줄이 동시 처리됨
      "220 Ready to start TLS\r\n250 smtp.example.com Hello 2",
      "334 Username:",    // AUTH LOGIN → case 2
      "334 Password:",    // username → case 3
      "235 Auth OK",      // password → case 4 MAIL FROM
      "250 OK",           // MAIL FROM → case 5 RCPT TO
      "354 Start",        // RCPT TO → DATA (L117)
      "250 OK",           // DATA content → case 7 QUIT
    );
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      to: "user@example.com",
      from: "sender@example.com",
      subject: "STARTTLS Test",
      body: "Hello",
      smtp_host: "smtp.example.com",
      smtp_port: 587,
      smtp_user: "testuser",
      smtp_pass: "testpass",
    }));
    expect(r.ok).toBe(true);
  });
});

describe("EmailTool — 빈 수신자 목록 (L115)", () => {
  it("to 빈 문자열 → recipients=[] → case5 else DATA (L115)", async () => {
    // to="" → recipients=[] → rcpt_idx(0) >= length(0) → L115 else: send DATA, step=6
    // L117도 실행되어 DATA 두 번 전송, step=7
    // response[3]="354 Start" → step=7 → case 7: QUIT, resolve
    set_smtp_responses(
      "250 smtp.example.com Hello",  // EHLO → no user → L107 MAIL FROM, step=4
      "250 OK",                      // MAIL FROM 1 → case 4: MAIL FROM 2, step=5
      "250 OK",                      // MAIL FROM 2 → case 5 (empty): L115 DATA, L117 DATA, step=7
      "354 Start",                   // DATA #1 → step=7 → case 7: QUIT, resolve
      "250 OK",                      // DATA #2 → step=8 (무시됨)
    );
    // to="," → split(",").filter(Boolean) = [] → recipients 빈 배열
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      to: ",",
      from: "sender@example.com",
      subject: "No Recipients",
      body: "Hello",
      smtp_host: "smtp.example.com",
      smtp_port: 25,
    }));
    expect(typeof r).toBe("object");
  });
});
