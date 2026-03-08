/**
 * FtpTool — FTP 프로토콜 경로 테스트 (vi.mock으로 node:net 대체).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock 상태 ─────────────────────────────────────────

const { ftp_state } = vi.hoisted(() => {
  const state = {
    emit_error: false,
    error_msg: "ECONNREFUSED",
    // FTP 응답 시퀀스: 각 write()에 대한 응답
    responses: [] as string[],
    response_idx: 0,
  };
  return { ftp_state: state };
});

// EventEmitter 기반 소켓 mock
class MockSocket {
  private _handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  public destroyed = false;

  on(event: string, fn: (...a: unknown[]) => void) {
    (this._handlers[event] ||= []).push(fn);
    return this;
  }

  once(event: string, fn: (...a: unknown[]) => void) {
    const wrap = (...a: unknown[]) => { fn(...a); this.off(event, wrap); };
    return this.on(event, wrap);
  }

  off(event: string, fn: (...a: unknown[]) => void) {
    this._handlers[event] = (this._handlers[event] || []).filter(f => f !== fn);
    return this;
  }

  removeListener = this.off.bind(this);

  emit(event: string, ...args: unknown[]) {
    (this._handlers[event] || []).forEach(fn => fn(...args));
  }

  write(_data: unknown) {
    // write()가 호출될 때마다 다음 응답을 data 이벤트로 발생
    const resp = ftp_state.responses[ftp_state.response_idx];
    if (resp !== undefined) {
      ftp_state.response_idx++;
      setTimeout(() => this.emit("data", Buffer.from(resp + "\r\n")), 0);
    }
    return true;
  }

  destroy() { this.destroyed = true; }
}

vi.mock("node:net", () => ({
  createConnection: (_opts: unknown, cb?: () => void) => {
    const socket = new MockSocket();

    Promise.resolve().then(() => {
      if (ftp_state.emit_error) {
        socket.emit("error", new Error(ftp_state.error_msg));
        return;
      }
      // 1) connect 이벤트 발행 → FTP 핸들러가 once("data") 등록하고 suspend
      socket.emit("connect");
      if (cb) cb();
      // 2) 그 다음 tick에 220 배너 발행 → once("data")가 이미 등록된 상태
      Promise.resolve().then(() => {
        socket.emit("data", Buffer.from("220 FTP Server Ready\r\n"));
      });
    });

    return socket as unknown as ReturnType<typeof import("node:net").createConnection>;
  },
}));

// ── 임포트 ───────────────────────────────────────────

const { FtpTool } = await import("@src/agent/tools/ftp.js");

function make_tool() { return new FtpTool(); }

// ── 응답 설정 헬퍼 ────────────────────────────────────

function set_ftp_responses(...resps: string[]) {
  ftp_state.emit_error = false;
  ftp_state.responses = resps;
  ftp_state.response_idx = 0;
}

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("FtpTool — 메타데이터", () => {
  it("name = ftp", () => expect(make_tool().name).toBe("ftp"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// host 없음
// ══════════════════════════════════════════

describe("FtpTool — 파라미터 검증", () => {
  it("host 없음 → Error (static check)", async () => {
    const tool = make_tool();
    // host가 required이지만, 실제로 검사를 우회해서 호출
    const r = await tool.execute({ action: "list", host: "" });
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// 연결 오류
// ══════════════════════════════════════════

describe("FtpTool — 연결 오류", () => {
  beforeEach(() => {
    ftp_state.emit_error = true;
    ftp_state.error_msg = "ECONNREFUSED";
  });

  it("네트워크 오류 → Error 반환", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "info", host: "ftp.example.com" });
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// info action
// ══════════════════════════════════════════

describe("FtpTool — info action", () => {
  beforeEach(() => { ftp_state.emit_error = false; });

  it("info: PWD/SYST 응답 반환", async () => {
    // USER → 331, PASS → 230, PWD → 257, SYST → 215, QUIT → 221
    set_ftp_responses(
      "331 Password required",
      "230 Logged in",
      "257 \"/\" is current directory",
      "215 UNIX Type: L8",
      "221 Goodbye",
    );
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "info", host: "ftp.example.com" }));
    expect(r.host).toBe("ftp.example.com");
    expect(r.port).toBe(21);
  });
});

// ══════════════════════════════════════════
// default (not_implemented) action
// ══════════════════════════════════════════

describe("FtpTool — 미구현 action", () => {
  beforeEach(() => { ftp_state.emit_error = false; });

  it("upload → not_implemented 상태 반환", async () => {
    set_ftp_responses(
      "331 Password required",
      "230 Logged in",
      "221 Goodbye",
    );
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "upload", host: "ftp.example.com" }));
    expect(r.status).toBe("not_implemented");
    expect(r.action).toBe("upload");
  });

  it("download → not_implemented 상태 반환", async () => {
    set_ftp_responses(
      "331 Password required",
      "230 Logged in",
      "221 Goodbye",
    );
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "download", host: "ftp.example.com" }));
    expect(r.status).toBe("not_implemented");
  });
});
