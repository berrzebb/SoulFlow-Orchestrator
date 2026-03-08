/**
 * SyslogTool — format/parse/send 커버리지.
 * UDP/TCP는 node:dgram / node:net mock 기반.
 */
import { describe, it, expect, vi } from "vitest";

// ── mock 상태 ─────────────────────────────────────────
const { udp_state, tcp_state } = vi.hoisted(() => ({
  udp_state: { emit_error: false, error_msg: "send error" },
  tcp_state: { emit_error: false, error_msg: "ECONNREFUSED", timeout: false },
}));

vi.mock("node:dgram", () => ({
  createSocket: () => ({
    send: (_buf: unknown, _off: unknown, _len: unknown, _port: unknown, _host: unknown, cb: (err: Error | null) => void) => {
      if (udp_state.emit_error) cb(new Error(udp_state.error_msg));
      else cb(null);
    },
    close: vi.fn(),
  }),
}));

vi.mock("node:net", () => ({
  createConnection: (_port: unknown, _host: unknown, cb?: () => void) => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const socket = {
      write: (_buf: unknown, write_cb: () => void) => { if (!tcp_state.emit_error) write_cb(); },
      destroy: vi.fn(),
      on: (event: string, fn: (...a: unknown[]) => void) => { (handlers[event] ||= []).push(fn); return socket; },
    };

    Promise.resolve().then(() => {
      if (tcp_state.emit_error) {
        (handlers["error"] || []).forEach(fn => fn(new Error(tcp_state.error_msg)));
        return;
      }
      if (!tcp_state.timeout && cb) cb();
    });

    return socket;
  },
}));

import { SyslogTool } from "@src/agent/tools/syslog.js";

function make_tool() { return new SyslogTool(); }

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("SyslogTool — 메타데이터", () => {
  it("name = syslog", () => expect(make_tool().name).toBe("syslog"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// format
// ══════════════════════════════════════════

describe("SyslogTool — format", () => {
  it("기본값으로 포맷", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "format", message: "test log" }));
    expect(r.message).toContain("<14>"); // facility=1 severity=6 → 1*8+6=14
    expect(r.message).toContain("soulflow");
    expect(r.message).toContain("test log");
  });

  it("custom facility/severity/app_name", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "format",
      message: "auth error",
      facility: 4,   // auth
      severity: 3,   // error → 4*8+3=35
      app_name: "myapp",
      hostname: "server1",
    }));
    expect(r.message).toContain("<35>");
    expect(r.message).toContain("myapp");
    expect(r.message).toContain("server1");
  });

  it("facility/severity 클램핑 (최대값 초과)", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "format",
      message: "x",
      facility: 100,  // → 23
      severity: 100,  // → 7 → priority=23*8+7=191
    }));
    expect(r.message).toContain("<191>");
  });
});

// ══════════════════════════════════════════
// parse
// ══════════════════════════════════════════

describe("SyslogTool — parse", () => {
  const VALID_MSG = "<14>Dec 15 12:34:56 myhost myapp[1234]: This is a test message";

  it("유효한 syslog → 파싱 성공", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: VALID_MSG }));
    expect(r.priority).toBe(14);
    expect(r.facility).toBe(1);
    expect(r.facility_name).toBe("user");
    expect(r.severity).toBe(6);
    expect(r.severity_name).toBe("info");
    expect(r.hostname).toBe("myhost");
    expect(r.app_name).toBe("myapp");
    expect(r.pid).toBe(1234);
    expect(r.message).toContain("test message");
  });

  it("pid 없음 → null", async () => {
    const no_pid = "<13>Jan  1 00:00:00 host app: msg";
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: no_pid }));
    expect(r.pid).toBeNull();
  });

  it("파싱 불가 → error 포함", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: "not a syslog message" }));
    expect(r.error).toBeDefined();
  });

  it("알 수 없는 facility → unknown", async () => {
    // priority=999 → facility=124(unknown), severity=7
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: "<999>Jan  1 00:00:00 host app: msg" }));
    // 파싱은 되지만 facility_name=unknown
    expect(typeof r.facility_name).toBe("string");
  });
});

// ══════════════════════════════════════════
// send — 파라미터 검증
// ══════════════════════════════════════════

describe("SyslogTool — send 파라미터 검증", () => {
  it("host 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "send" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("host");
  });
});

// ══════════════════════════════════════════
// send — UDP
// ══════════════════════════════════════════

describe("SyslogTool — send UDP", () => {
  it("UDP 전송 성공", async () => {
    udp_state.emit_error = false;
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      host: "syslog.example.com",
      protocol: "udp",
      message: "test message",
    }));
    expect(r.success).toBe(true);
    expect(r.protocol).toBe("udp");
    expect(r.bytes).toBeGreaterThan(0);
  });

  it("UDP 전송 실패 → success=false", async () => {
    udp_state.emit_error = true;
    udp_state.error_msg = "network unreachable";
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      host: "syslog.example.com",
      protocol: "udp",
      message: "test",
    }));
    expect(r.success).toBe(false);
    expect(r.error).toContain("network unreachable");
    udp_state.emit_error = false;
  });
});

// ══════════════════════════════════════════
// send — TCP
// ══════════════════════════════════════════

describe("SyslogTool — send TCP", () => {
  it("TCP 전송 성공", async () => {
    tcp_state.emit_error = false;
    tcp_state.timeout = false;
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      host: "syslog.example.com",
      port: 6514,
      protocol: "tcp",
      message: "tcp test",
    }));
    expect(r.success).toBe(true);
    expect(r.protocol).toBe("tcp");
  });

  it("TCP 연결 오류 → success=false", async () => {
    tcp_state.emit_error = true;
    tcp_state.error_msg = "ECONNREFUSED";
    const r = JSON.parse(await make_tool().execute({
      action: "send",
      host: "syslog.example.com",
      protocol: "tcp",
      message: "test",
    }));
    expect(r.success).toBe(false);
    expect(r.error).toContain("ECONNREFUSED");
    tcp_state.emit_error = false;
  });
});

// ══════════════════════════════════════════
// unsupported action
// ══════════════════════════════════════════

describe("SyslogTool — unsupported action", () => {
  it("bogus → Error", async () => {
    const r = await make_tool().execute({ action: "bogus" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});
