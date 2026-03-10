/**
 * RedisTool — 미커버 분기 보충.
 * parse_resp 직접 호출 + 타임아웃 시나리오.
 */
import { describe, it, expect, vi } from "vitest";

// ── node:net mock ──────────────────────────────────────

const { mock_state } = vi.hoisted(() => {
  const state = { response_data: "", connect_error: false, error_msg: "" };
  return { mock_state: state };
});

vi.mock("node:net", () => {
  const EventEmitter = class {
    private _handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    on(event: string, fn: (...args: unknown[]) => void) { (this._handlers[event] ||= []).push(fn); return this; }
    write(_data: unknown) { return true; }
    destroy() {}
    emit(event: string, ...args: unknown[]) { (this._handlers[event] || []).forEach(fn => fn(...args)); }
  };
  return {
    createConnection: (_port: number, _host: string, cb?: () => void) => {
      const socket = new EventEmitter();
      Promise.resolve().then(() => {
        if (mock_state.connect_error) { socket.emit("error", new Error(mock_state.error_msg || "ECONNREFUSED")); return; }
        if (cb) cb();
        if (mock_state.response_data) socket.emit("data", Buffer.from(mock_state.response_data, "utf-8"));
      });
      return socket;
    },
  };
});

const { RedisTool } = await import("../../../src/agent/tools/redis.js");
const tool = new RedisTool();

// ══════════════════════════════════════════
// timeout 콜백 (L81)
// ══════════════════════════════════════════

describe("RedisTool — timeout (L81 콜백)", () => {
  it("응답 없음 + fake timer → timeout error → success=false", async () => {
    vi.useFakeTimers();
    mock_state.response_data = "";
    mock_state.connect_error = false;
    const p = tool.execute({ action: "ping", timeout_ms: 1 }).then(r => JSON.parse(String(r)));
    await vi.advanceTimersByTimeAsync(10);
    const r = await p;
    vi.useRealTimers();
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain("timeout");
  });
});

// ══════════════════════════════════════════
// unknown action (L62)
// ══════════════════════════════════════════

describe("RedisTool — unknown action (L62)", () => {
  it("unknown action → Error 반환", async () => {
    mock_state.response_data = "";
    mock_state.connect_error = false;
    const r = String(await tool.execute({ action: "zadd" }));
    expect(r).toContain("unsupported action");
  });
});

// ══════════════════════════════════════════
// parse_resp 직접 테스트 (L94, L111, L113, L126, L136, L143)
// ══════════════════════════════════════════

describe("RedisTool — parse_resp 직접 테스트", () => {
  const pr = (data: string) => (tool as unknown as { parse_resp(d: string): unknown }).parse_resp(data);

  it("빈 문자열 → null (L111)", () => {
    expect(pr("")).toBeNull();
  });

  it("CRLF 없음 → null (L113)", () => {
    expect(pr("+PONG")).toBeNull();
  });

  it("$ 타입: rest 너무 짧음 → null (L126)", () => {
    // $5\r\nhe → rest="he" (2바이트) < len+2(7) → null
    expect(pr("$5\r\nhe")).toBeNull();
  });

  it("* 타입: 하위 요소 파싱 실패 → null (L136)", () => {
    // *1\r\n+OK (CRLF 없음) → 하위 파싱 null → L136 return null
    expect(pr("*1\r\n+OK")).toBeNull();
  });

  it("unknown type → default { value, rest } 반환 (L143)", () => {
    const r = pr("?hello\r\nrest") as { value: string; rest: string };
    expect(r.value).toBe("hello");
    expect(r.rest).toBe("rest");
  });
});

// ══════════════════════════════════════════
// L94: socket 응답이 불완전 → parse_resp null → break
// (위 parse_resp 테스트로 간접 커버 + fake timer로 직접 커버)
// ══════════════════════════════════════════

describe("RedisTool — 불완전 응답 (L94)", () => {
  it("불완전한 응답 + fake timer → timeout", async () => {
    vi.useFakeTimers();
    // CRLF 없는 불완전 응답 → parse_resp null → break (L94) → 응답 대기 → timeout
    mock_state.response_data = "+PONG";  // CRLF 없음
    mock_state.connect_error = false;
    const p = tool.execute({ action: "ping", timeout_ms: 1 }).then(r => JSON.parse(String(r)));
    await vi.advanceTimersByTimeAsync(10);
    const r = await p;
    vi.useRealTimers();
    expect(r.success).toBe(false);
  });
});
