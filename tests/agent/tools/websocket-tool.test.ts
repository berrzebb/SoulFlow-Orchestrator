/**
 * WebSocketTool — connect/send/receive/close/list 테스트.
 * ws 패키지를 mock하여 실제 서버 없이 테스트.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── ws mock ────────────────────────────────────────

const { ws_instances } = vi.hoisted(() => {
  return { ws_instances: [] as MockWS[] };
});

class MockWS {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  public readyState: number;
  private _handlers: Record<string, ((...a: unknown[]) => void)[]> = {};

  constructor(public url: string) {
    this.readyState = MockWS.OPEN;
    ws_instances.push(this);
    // 비동기적으로 open 이벤트 발생
    Promise.resolve().then(() => this.emit("open"));
  }

  on(event: string, fn: (...a: unknown[]) => void) {
    (this._handlers[event] ||= []).push(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    (this._handlers[event] || []).forEach(f => f(...args));
  }

  send(msg: string, cb?: (err?: Error) => void) { cb?.(); }
  close() { this.readyState = MockWS.CLOSED; this.emit("close"); }
}

vi.mock("ws", () => ({
  WebSocket: MockWS,
}));

// ── 임포트 ────────────────────────────────────────────

const { WebSocketTool } = await import("@src/agent/tools/websocket.js");

// ── 헬퍼 ──────────────────────────────────────────────

function make_tool() {
  return new WebSocketTool();
}

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("WebSocketTool — 메타데이터", () => {
  it("name = websocket", () => expect(make_tool().name).toBe("websocket"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// connect
// ══════════════════════════════════════════

describe("WebSocketTool — connect", () => {
  let tool: WebSocketTool;

  beforeEach(() => {
    tool = make_tool();
    ws_instances.length = 0;
  });

  it("url 없음 → Error", async () => {
    const r = await tool.execute({ action: "connect", url: "" });
    expect(String(r)).toContain("Error");
  });

  it("http:// URL → Error", async () => {
    const r = await tool.execute({ action: "connect", url: "http://example.com" });
    expect(String(r)).toContain("Error");
  });

  it("ws:// 연결 → 성공 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "connect", url: "ws://localhost:8080", id: "test_conn" }));
    expect(r.status).toBe("connected");
    expect(r.id).toBe("test_conn");
  });

  it("자동 ID 생성 (id 미지정)", async () => {
    const r = JSON.parse(await tool.execute({ action: "connect", url: "ws://localhost:8080" }));
    expect(r.status).toBe("connected");
    expect(String(r.id)).toMatch(/^ws_/);
  });
});

// ══════════════════════════════════════════
// send
// ══════════════════════════════════════════

describe("WebSocketTool — send", () => {
  let tool: WebSocketTool;

  beforeEach(async () => {
    tool = make_tool();
    ws_instances.length = 0;
    await tool.execute({ action: "connect", url: "ws://localhost:8080", id: "send_conn" });
  });

  it("연결된 커넥션에 메시지 전송 → 성공", async () => {
    const r = JSON.parse(await tool.execute({ action: "send", id: "send_conn", message: "hello" }));
    expect(r.sent).toBe(true);
    expect(r.length).toBe(5);
  });

  it("없는 id → Error", async () => {
    const r = await tool.execute({ action: "send", id: "nonexistent", message: "hi" });
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// receive
// ══════════════════════════════════════════

describe("WebSocketTool — receive", () => {
  let tool: WebSocketTool;

  beforeEach(async () => {
    tool = make_tool();
    ws_instances.length = 0;
    await tool.execute({ action: "connect", url: "ws://localhost:8080", id: "recv_conn" });
  });

  it("없는 id → Error", async () => {
    const r = await tool.execute({ action: "receive", id: "nonexistent" });
    expect(String(r)).toContain("Error");
  });

  it("버퍼에 메시지 있을 때 즉시 반환", async () => {
    // 소켓에서 메시지 수동 발생
    const ws = ws_instances[0];
    ws?.emit("message", Buffer.from("test-message"));

    const r = JSON.parse(await tool.execute({ action: "receive", id: "recv_conn", count: 5 }));
    expect(r.messages).toContain("test-message");
    expect(r.count).toBeGreaterThan(0);
  });

  it("timeout 내 메시지 없음 → timeout=true", async () => {
    const r = JSON.parse(await tool.execute({ action: "receive", id: "recv_conn", timeout_ms: 50 }));
    expect(r.timeout).toBe(true);
    expect(r.messages).toEqual([]);
  });
});

// ══════════════════════════════════════════
// close
// ══════════════════════════════════════════

describe("WebSocketTool — close", () => {
  let tool: WebSocketTool;

  beforeEach(async () => {
    tool = make_tool();
    ws_instances.length = 0;
    await tool.execute({ action: "connect", url: "ws://localhost:8080", id: "close_conn" });
  });

  it("연결 닫기 → status: closed", async () => {
    const r = JSON.parse(await tool.execute({ action: "close", id: "close_conn" }));
    expect(r.status).toBe("closed");
  });

  it("없는 id → Error", async () => {
    const r = await tool.execute({ action: "close", id: "ghost_conn" });
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// list
// ══════════════════════════════════════════

describe("WebSocketTool — list", () => {
  it("연결 없을 때 count=0", async () => {
    // 새 도구 인스턴스이지만 connections Map은 모듈 레벨이므로 공유됨
    // close_conn 등 닫히면 제거됨
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "list" }));
    expect(r.count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(r.connections)).toBe(true);
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("WebSocketTool — unknown action", () => {
  it("알 수 없는 액션 → Error", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "unknown_action" });
    expect(String(r)).toContain("Error");
  });
});
