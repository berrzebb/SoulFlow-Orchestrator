/**
 * FtpTool — list action: PASV 데이터 연결 포함 테스트.
 * 두 번째 createConnection(data socket)을 별도로 처리.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 상태 ──────────────────────────────────────────────

const { ftp_list_state } = vi.hoisted(() => {
  const state = {
    emit_error: false,
    error_msg: "ECONNREFUSED",
    responses: [] as string[],
    response_idx: 0,
    call_count: 0,
    data_listing: "drwxr-xr-x 2 ftp ftp 4096 Jan 01 index.html\r\n-rw-r--r-- 1 ftp ftp  512 Jan 01 readme.txt",
    emit_pasv_fail: false,
    emit_data_error: false,
  };
  return { ftp_list_state: state };
});

class MockDataSocket {
  private _handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  on(event: string, fn: (...a: unknown[]) => void) {
    (this._handlers[event] ||= []).push(fn);
    // data 핸들러 등록 후 바로 데이터 발행
    if (event === "data" && !ftp_list_state.emit_data_error) {
      setTimeout(() => {
        fn(Buffer.from(ftp_list_state.data_listing));
        // end 이벤트 발행
        setTimeout(() => {
          (this._handlers["end"] || []).forEach(h => h());
        }, 0);
      }, 0);
    }
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    (this._handlers[event] || []).forEach(fn => fn(...args));
  }
  destroy() {}
}

class MockMainSocket {
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
    const resp = ftp_list_state.responses[ftp_list_state.response_idx];
    if (resp !== undefined) {
      ftp_list_state.response_idx++;
      setTimeout(() => this.emit("data", Buffer.from(resp + "\r\n")), 0);
    }
    return true;
  }
  destroy() { this.destroyed = true; }
}

vi.mock("node:net", () => ({
  createConnection: (_opts: unknown) => {
    ftp_list_state.call_count++;

    if (ftp_list_state.call_count === 1) {
      // 첫 번째 연결 = 메인 FTP 소켓
      const socket = new MockMainSocket();
      Promise.resolve().then(() => {
        if (ftp_list_state.emit_error) {
          socket.emit("error", new Error(ftp_list_state.error_msg));
          return;
        }
        socket.emit("connect");
        Promise.resolve().then(() => {
          socket.emit("data", Buffer.from("220 FTP Server Ready\r\n"));
        });
      });
      return socket as unknown as ReturnType<typeof import("node:net").createConnection>;
    } else {
      // 두 번째 연결 = PASV 데이터 소켓
      return new MockDataSocket() as unknown as ReturnType<typeof import("node:net").createConnection>;
    }
  },
}));

const { FtpTool } = await import("@src/agent/tools/ftp.js");

function make_tool() { return new FtpTool(); }

function set_responses(...resps: string[]) {
  ftp_list_state.responses = resps;
  ftp_list_state.response_idx = 0;
  ftp_list_state.call_count = 0;
  ftp_list_state.emit_error = false;
  ftp_list_state.emit_pasv_fail = false;
  ftp_list_state.emit_data_error = false;
}

beforeEach(() => {
  ftp_list_state.call_count = 0;
  ftp_list_state.emit_error = false;
  ftp_list_state.responses = [];
  ftp_list_state.response_idx = 0;
});

// ══════════════════════════════════════════
// list action — PASV 실패
// ══════════════════════════════════════════

describe("FtpTool — list PASV 실패", () => {
  it("PASV 응답에 포트 정보 없음 → Error 반환", async () => {
    set_responses(
      "331 Password required",
      "230 Logged in",
      "200 OK",
      "227 Entering Passive Mode (no match)", // PASV 파싱 실패
    );
    const tool = make_tool();
    const r = await tool.execute({ action: "list", host: "ftp.example.com", remote_path: "/" });
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// list action — 성공
// ══════════════════════════════════════════

describe("FtpTool — list 성공", () => {
  it("파일 목록 반환 → files 배열 + count", async () => {
    // USER → 331, PASS → 230, TYPE A → 200, PASV → 227 포트정보, LIST → 125, QUIT → 221
    set_responses(
      "331 Password required",
      "230 Logged in",
      "200 OK",
      "227 Entering Passive Mode (127,0,0,1,0,20)", // port = 0*256+20 = 20
      "125 Data connection open",
      "221 Goodbye",
    );
    ftp_list_state.data_listing = "index.html\r\nreadme.txt";
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "list", host: "ftp.example.com", remote_path: "/" }));
    expect(r).toHaveProperty("files");
    expect(r).toHaveProperty("count");
    expect(r.path).toBe("/");
  });
});
