/**
 * WebSocketTool — 미커버 분기 보충.
 * MAX_CONNECTIONS 한도, readyState !== OPEN 에러, send 콜백 에러,
 * receive 지연 메시지 (check loop), ws 닫힘 중 receive.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTimeout as sleep } from "node:timers/promises";

// ── ws mock ────────────────────────────────────────

const { ws_instances } = vi.hoisted(() => ({
  ws_instances: [] as MockWS[],
}));

class MockWS {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  public readyState: number;
  private _handlers: Record<string, ((...a: unknown[]) => void)[]> = {};

  constructor(public url: string) {
    this.readyState = MockWS.OPEN;
    ws_instances.push(this);
    Promise.resolve().then(() => this.emit("open"));
  }

  on(event: string, fn: (...a: unknown[]) => void) {
    (this._handlers[event] ||= []).push(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    (this._handlers[event] || []).forEach(f => f(...args));
  }

  send(msg: string, cb?: (err?: Error) => void) {
    if ((this as any)._send_error) {
      cb?.(new Error("send failed"));
    } else {
      cb?.();
    }
  }

  close() {
    this.readyState = MockWS.CLOSED;
    this.emit("close");
  }
}

vi.mock("ws", () => ({
  WebSocket: MockWS,
}));

const { WebSocketTool } = await import("@src/agent/tools/websocket.js");

// ══════════════════════════════════════════
// MAX_CONNECTIONS 한도
// ══════════════════════════════════════════

describe("WebSocketTool — MAX_CONNECTIONS 한도 (10)", () => {
  it("10개 초과 연결 시도 → Error", async () => {
    const tool = new WebSocketTool();
    ws_instances.length = 0;

    // 10개 연결 생성
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `overflow_conn_${i}`;
      ids.push(id);
      await tool.execute({ action: "connect", url: "ws://localhost:8080", id });
    }

    // 11번째 시도 → MAX_CONNECTIONS 초과
    const r = await tool.execute({ action: "connect", url: "ws://localhost:8080", id: "extra_conn" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("10");

    // 정리
    for (const id of ids) {
      await tool.execute({ action: "close", id });
    }
  });
});

// ══════════════════════════════════════════
// send — readyState !== OPEN
// ══════════════════════════════════════════

describe("WebSocketTool — send readyState !== OPEN", () => {
  it("닫힌 연결에 send → Error: connection not open", async () => {
    const tool = new WebSocketTool();
    ws_instances.length = 0;

    await tool.execute({ action: "connect", url: "ws://localhost:8080", id: "not_open_conn" });

    // 연결을 닫혀있는 상태로 만들기 (readyState를 CLOSED로)
    const ws = ws_instances[ws_instances.length - 1];
    ws.readyState = MockWS.CLOSED;

    const r = await tool.execute({ action: "send", id: "not_open_conn", message: "hello" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not open");
  });
});

// ══════════════════════════════════════════
// send — 콜백 에러
// ══════════════════════════════════════════

describe("WebSocketTool — send 콜백 에러", () => {
  it("ws.send가 에러 반환 → Error 메시지", async () => {
    const tool = new WebSocketTool();
    ws_instances.length = 0;

    await tool.execute({ action: "connect", url: "ws://localhost:8080", id: "send_err_conn" });

    // send 메서드가 에러를 반환하도록 설정
    const ws = ws_instances[ws_instances.length - 1];
    (ws as any)._send_error = true;

    const r = await tool.execute({ action: "send", id: "send_err_conn", message: "hello" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("send failed");
  });
});

// ══════════════════════════════════════════
// receive — 지연 메시지 (check loop)
// ══════════════════════════════════════════

describe("WebSocketTool — receive 지연 메시지", () => {
  it("메시지 없다가 100ms 후 도착 → check loop에서 감지", async () => {
    const tool = new WebSocketTool();
    ws_instances.length = 0;

    await tool.execute({ action: "connect", url: "ws://localhost:8080", id: "delayed_conn" });
    const ws = ws_instances[ws_instances.length - 1];

    // 150ms 후 메시지 emit
    setTimeout(() => {
      ws.emit("message", Buffer.from("delayed message"));
    }, 150);

    const r = JSON.parse(await tool.execute({ action: "receive", id: "delayed_conn", timeout_ms: 500 }));
    expect(r.messages).toContain("delayed message");
    expect(r.count).toBe(1);
  });
});

// ══════════════════════════════════════════
// receive — ws 닫힘 중 대기
// ══════════════════════════════════════════

describe("WebSocketTool — receive ws 닫힘 감지", () => {
  it("receive 대기 중 ws 닫힘 → closed=true 반환", async () => {
    const tool = new WebSocketTool();
    ws_instances.length = 0;

    await tool.execute({ action: "connect", url: "ws://localhost:8080", id: "close_during_recv" });
    const ws = ws_instances[ws_instances.length - 1];

    // 100ms 후 연결 닫기
    setTimeout(() => {
      ws.readyState = MockWS.CLOSED;
    }, 100);

    const r = JSON.parse(await tool.execute({ action: "receive", id: "close_during_recv", timeout_ms: 500 }));
    expect(r.closed).toBe(true);
    expect(r.messages).toEqual([]);
  });
});
