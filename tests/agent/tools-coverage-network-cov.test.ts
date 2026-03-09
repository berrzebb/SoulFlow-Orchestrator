/**
 * 네트워크 모킹이 필요한 도구 미커버 분기 보충.
 * healthcheck.ts L85-86 (TCP connect 성공), L93-94 (TCP timeout), L104 (DNS 성공)
 * ftp.ts L43-44 (connection timeout), L118-120 (connect catch), L130 (outer catch)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HealthcheckTool } from "@src/agent/tools/healthcheck.js";
import { FtpTool } from "@src/agent/tools/ftp.js";

// ──────────────────────────────────────────
// node:net 모킹 (동적 import를 vi.mock으로 가로채기)
// ──────────────────────────────────────────
vi.mock("node:net", () => {
  const mock_create_connection = vi.fn();
  return {
    createConnection: mock_create_connection,
    default: { createConnection: mock_create_connection },
  };
});

vi.mock("node:dns", () => {
  const mock_promises = { resolve4: vi.fn() };
  return {
    promises: mock_promises,
    default: { promises: mock_promises },
  };
});

// ══════════════════════════════════════════
// healthcheck.ts L85-86 — TCP connect 성공
// ══════════════════════════════════════════

describe("HealthcheckTool — check_tcp connect 성공 (L85-86)", () => {
  it("socket connect callback 발생 → healthy:true (L85-86)", async () => {
    const { createConnection } = await import("node:net");
    vi.mocked(createConnection).mockImplementation((_opts: any, connectCb?: () => void) => {
      const handlers: Record<string, Function[]> = {};
      const socket = {
        destroy: vi.fn(),
        on: (event: string, cb: Function) => {
          handlers[event] = handlers[event] || [];
          handlers[event].push(cb);
        },
      };
      // 즉시 connect callback 호출 → L85 socket.destroy() + L86 resolve
      if (connectCb) setImmediate(connectCb);
      return socket;
    });

    const tool = new HealthcheckTool();
    const r = JSON.parse(await (tool as any).run({ action: "tcp", host: "example.com", port: 80 }));
    expect(r.healthy).toBe(true);
    expect(r.host).toBe("example.com");
    expect(r.port).toBe(80);
  });
});

// ══════════════════════════════════════════
// healthcheck.ts L93-94 — TCP timeout 이벤트
// ══════════════════════════════════════════

describe("HealthcheckTool — check_tcp timeout (L93-94)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("socket timeout 이벤트 → healthy:false + error:timeout (L93-94)", async () => {
    const { createConnection } = await import("node:net");
    vi.mocked(createConnection).mockImplementation((_opts: any, _connectCb?: () => void) => {
      const handlers: Record<string, Function> = {};
      const socket = {
        destroy: vi.fn(),
        on: (event: string, cb: Function) => { handlers[event] = cb; },
      };
      // timeout 이벤트 발생 → L93 socket.destroy() + L94 resolve
      setImmediate(() => handlers["timeout"]?.());
      return socket;
    });

    const tool = new HealthcheckTool();
    const promise = (tool as any).run({ action: "tcp", host: "slow.host", port: 9999, timeout_ms: 1000 });
    await vi.runAllTimersAsync();
    const r = JSON.parse(await promise);
    expect(r.healthy).toBe(false);
    expect(r.error).toBe("timeout");
  });
});

// ══════════════════════════════════════════
// healthcheck.ts L104 — DNS resolve4 성공
// ══════════════════════════════════════════

describe("HealthcheckTool — check_dns 성공 (L104)", () => {
  it("dns.resolve4 성공 → healthy:true + addresses 반환 (L104)", async () => {
    const dns = await import("node:dns");
    vi.mocked((dns as any).promises.resolve4).mockResolvedValue(["1.2.3.4", "5.6.7.8"]);

    const tool = new HealthcheckTool();
    const r = JSON.parse(await (tool as any).run({ action: "dns", host: "example.com" }));
    expect(r.healthy).toBe(true);
    expect(r.addresses).toEqual(["1.2.3.4", "5.6.7.8"]);
  });
});

// ══════════════════════════════════════════
// ftp.ts L43-44 — connection timeout
// ══════════════════════════════════════════

describe("FtpTool — connection timeout (L43-44)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("10초 타임아웃 → conn.destroy() + Error: connection timeout (L43-44)", async () => {
    const { createConnection } = await import("node:net");
    let captured_destroy: Function | undefined;
    vi.mocked(createConnection).mockImplementation((_opts: any) => {
      const handlers: Record<string, Function> = {};
      const socket = {
        destroy: vi.fn().mockImplementation(() => { captured_destroy = socket.destroy; }),
        on: (event: string, cb: Function) => { handlers[event] = cb; },
        write: vi.fn(),
      };
      return socket;
    });

    const tool = new FtpTool();
    const promise = (tool as any).run({ action: "list", host: "ftp.example.com", port: 21 });
    // 10초 타임아웃 발생 → L43-44
    await vi.advanceTimersByTimeAsync(10001);
    const r = await promise;
    expect(r).toBe("Error: connection timeout");
  });
});

// ══════════════════════════════════════════
// ftp.ts L118-120 — connect handler catch
// ══════════════════════════════════════════

describe("FtpTool — connect handler 내부 예외 (L118-120)", () => {
  it("write() throw → L118-120: Error: ... 반환", async () => {
    const { createConnection } = await import("node:net");
    vi.mocked(createConnection).mockImplementation((_opts: any) => {
      const handlers: Record<string, Function> = {};
      const socket = {
        destroy: vi.fn(),
        on: (event: string, cb: Function) => { handlers[event] = cb; },
        once: (event: string, cb: Function) => {
          // 서버 greeting 즉시 제공
          if (event === "data") setImmediate(() => cb(Buffer.from("220 FTP server ready\r\n")));
        },
        write: vi.fn().mockImplementation(() => { throw new Error("write failed"); }),
        removeListener: vi.fn(),
      };
      // connect 이벤트 발생
      setImmediate(() => handlers["connect"]?.());
      return socket;
    });

    const tool = new FtpTool();
    const r = await (tool as any).run({ action: "list", host: "ftp.example.com", port: 21 });
    expect(r).toContain("Error:");
  });
});

// ══════════════════════════════════════════
// ftp.ts L130 — outer try catch (createConnection throw)
// ══════════════════════════════════════════

describe("FtpTool — createConnection throw → outer catch (L130)", () => {
  it("createConnection 자체가 throw → L130: Error: ... 반환", async () => {
    const { createConnection } = await import("node:net");
    vi.mocked(createConnection).mockImplementation(() => {
      throw new Error("network unavailable");
    });

    const tool = new FtpTool();
    const r = await (tool as any).run({ action: "list", host: "ftp.example.com", port: 21 });
    expect(r).toContain("Error: network unavailable");
  });
});
