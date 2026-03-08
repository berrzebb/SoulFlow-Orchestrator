/**
 * RedisTool — RESP 프로토콜 파서 + 명령 빌더 테스트.
 * node:net을 mock하여 실제 Redis 서버 없이 테스트.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock 초기화 ──────────────────────────────────────

const { mock_state } = vi.hoisted(() => {
  const state = {
    response_data: "",   // socket에서 받을 데이터
    connect_error: false,
    error_msg: "",
  };
  return { mock_state: state };
});

vi.mock("node:net", () => {
  const EventEmitter = class {
    private _handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    on(event: string, fn: (...args: unknown[]) => void) { (this._handlers[event] ||= []).push(fn); return this; }
    once(event: string, fn: (...args: unknown[]) => void) { const wrap = (...a: unknown[]) => { fn(...a); this.off(event, wrap); }; return this.on(event, wrap); }
    off(event: string, fn: (...args: unknown[]) => void) { this._handlers[event] = (this._handlers[event] || []).filter(f => f !== fn); return this; }
    emit(event: string, ...args: unknown[]) { (this._handlers[event] || []).forEach(fn => fn(...args)); }
    write(_data: unknown) { return true; }
    destroy() {}
  };

  return {
    createConnection: (_port: number, _host: string, cb?: () => void) => {
      const socket = new EventEmitter();
      Promise.resolve().then(() => {
        if (mock_state.connect_error) {
          socket.emit("error", new Error(mock_state.error_msg || "ECONNREFUSED"));
          return;
        }
        if (cb) cb();
        // 데이터 이벤트 발생
        if (mock_state.response_data) {
          socket.emit("data", Buffer.from(mock_state.response_data, "utf-8"));
        }
      });
      return socket;
    },
  };
});

// ── 도우미 ────────────────────────────────────────────

function set_response(resp: string): void {
  mock_state.response_data = resp;
  mock_state.connect_error = false;
}

function set_connect_error(msg = "ECONNREFUSED"): void {
  mock_state.connect_error = true;
  mock_state.error_msg = msg;
  mock_state.response_data = "";
}

// ── 임포트 ────────────────────────────────────────────

const { RedisTool } = await import("@src/agent/tools/redis.js");
const tool = new RedisTool();

async function exec(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await tool.execute(params);
  return JSON.parse(String(result));
}

// ══════════════════════════════════════════
// ping
// ══════════════════════════════════════════

describe("RedisTool — ping", () => {
  beforeEach(() => { mock_state.response_data = ""; mock_state.connect_error = false; });

  it("PONG 응답 → 성공 반환", async () => {
    set_response("+PONG\r\n");
    const r = await exec({ action: "ping" });
    expect(r.success).toBe(true);
    expect(r.result).toBe("PONG");
  });

  it("연결 오류 → success=false", async () => {
    set_connect_error();
    const r = await exec({ action: "ping" });
    expect(r.success).toBe(false);
    expect(String(r.error)).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// get / set / del
// ══════════════════════════════════════════

describe("RedisTool — get/set/del", () => {
  it("get: bulk string 응답 파싱", async () => {
    set_response("$5\r\nhello\r\n");
    const r = await exec({ action: "get", key: "mykey" });
    expect(r.success).toBe(true);
    expect(r.result).toBe("hello");
  });

  it("get: null bulk ($-1) → null 반환", async () => {
    set_response("$-1\r\n");
    const r = await exec({ action: "get", key: "nonexistent" });
    expect(r.success).toBe(true);
    expect(r.result).toBeNull();
  });

  it("set: +OK 응답 파싱", async () => {
    set_response("+OK\r\n");
    const r = await exec({ action: "set", key: "k", value: "v" });
    expect(r.success).toBe(true);
    expect(r.result).toBe("OK");
  });

  it("set with ttl: EX 포함 쿼리", async () => {
    set_response("+OK\r\n");
    const r = await exec({ action: "set", key: "k", value: "v", ttl: 60 });
    expect(r.success).toBe(true);
  });

  it("del: 정수 응답 (삭제 개수)", async () => {
    set_response(":1\r\n");
    const r = await exec({ action: "del", key: "k" });
    expect(r.success).toBe(true);
    expect(r.result).toBe(1);
  });
});

// ══════════════════════════════════════════
// keys / info / ttl / incr
// ══════════════════════════════════════════

describe("RedisTool — keys/info/ttl/incr", () => {
  it("keys: 배열 응답 파싱", async () => {
    set_response("*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n");
    const r = await exec({ action: "keys", pattern: "*" });
    expect(r.success).toBe(true);
    expect(r.result).toEqual(["foo", "bar"]);
  });

  it("keys: 빈 배열 (*0)", async () => {
    set_response("*0\r\n");
    const r = await exec({ action: "keys" });
    expect(r.success).toBe(true);
    expect(r.result).toEqual([]);
  });

  it("keys: null 배열 (*-1)", async () => {
    set_response("*-1\r\n");
    const r = await exec({ action: "keys" });
    expect(r.success).toBe(true);
    expect(r.result).toBeNull();
  });

  it("info: 문자열 응답", async () => {
    set_response("$9\r\nredis_ver\r\n");
    const r = await exec({ action: "info" });
    expect(r.success).toBe(true);
  });

  it("ttl: 정수 응답", async () => {
    set_response(":300\r\n");
    const r = await exec({ action: "ttl", key: "mykey" });
    expect(r.success).toBe(true);
    expect(r.result).toBe(300);
  });

  it("incr: 증가 후 정수 반환", async () => {
    set_response(":42\r\n");
    const r = await exec({ action: "incr", key: "counter" });
    expect(r.success).toBe(true);
    expect(r.result).toBe(42);
  });
});

// ══════════════════════════════════════════
// hash / list / expire
// ══════════════════════════════════════════

describe("RedisTool — hget/hset/lpush/lrange/expire", () => {
  it("hget: 해시 필드 조회", async () => {
    set_response("$5\r\nworld\r\n");
    const r = await exec({ action: "hget", key: "myhash", field: "hello" });
    expect(r.success).toBe(true);
    expect(r.result).toBe("world");
  });

  it("hset: 성공 응답", async () => {
    set_response(":1\r\n");
    const r = await exec({ action: "hset", key: "myhash", field: "f", value: "v" });
    expect(r.success).toBe(true);
  });

  it("lpush: 리스트 길이 반환", async () => {
    set_response(":3\r\n");
    const r = await exec({ action: "lpush", key: "mylist", value: "item" });
    expect(r.success).toBe(true);
  });

  it("lrange: 리스트 범위 조회", async () => {
    set_response("*3\r\n$1\r\na\r\n$1\r\nb\r\n$1\r\nc\r\n");
    const r = await exec({ action: "lrange", key: "mylist", start: 0, stop: -1 });
    expect(r.success).toBe(true);
    expect(r.result).toEqual(["a", "b", "c"]);
  });

  it("expire: 설정 성공 → 1 반환", async () => {
    set_response(":1\r\n");
    const r = await exec({ action: "expire", key: "k", ttl: 60 });
    expect(r.success).toBe(true);
    expect(r.result).toBe(1);
  });
});

// ══════════════════════════════════════════
// auth password
// ══════════════════════════════════════════

describe("RedisTool — password auth", () => {
  it("password 있을 때 AUTH 먼저 실행 (결과에서 제외)", async () => {
    // AUTH OK + PONG
    set_response("+OK\r\n+PONG\r\n");
    const r = await exec({ action: "ping", password: "secret" });
    expect(r.success).toBe(true);
    // AUTH 응답(OK)은 제거되고 PONG만 반환
    expect(r.result).toBe("PONG");
  });
});

// ══════════════════════════════════════════
// RESP 파서 — 에러 타입
// ══════════════════════════════════════════

describe("RedisTool — RESP 에러 응답", () => {
  it("-ERR 응답 → ERROR: ... 형태로 반환", async () => {
    set_response("-ERR unknown command\r\n");
    const r = await exec({ action: "ping" });
    expect(r.success).toBe(true);
    expect(String(r.result)).toContain("ERROR:");
  });
});

// ══════════════════════════════════════════
// 기본값 / 메타데이터
// ══════════════════════════════════════════

describe("RedisTool — 메타데이터", () => {
  it("name = redis", () => expect(tool.name).toBe("redis"));
  it("category = external", () => expect(tool.category).toBe("external"));
  it("to_schema type = function", () => expect(tool.to_schema().type).toBe("function"));
});
