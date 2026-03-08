/**
 * HealthcheckTool 커버리지 — http/tcp/dns/multi/ping actions.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { HealthcheckTool } from "@src/agent/tools/healthcheck.js";

const tool = new HealthcheckTool();

describe("HealthcheckTool — 메타데이터", () => {
  it("name = healthcheck", () => expect(tool.name).toBe("healthcheck"));
  it("category = external", () => expect(tool.category).toBe("external"));
  it("to_schema: function 형식", () => expect(tool.to_schema().type).toBe("function"));
});

describe("HealthcheckTool — http check", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("HTTP 200 → healthy=true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));
    const result = await tool.execute({ action: "http", url: "http://example.com", expected_status: 200 });
    const parsed = JSON.parse(result);
    expect(parsed.healthy).toBe(true);
    expect(parsed.status).toBe(200);
    expect(typeof parsed.latency_ms).toBe("number");
  });

  it("HTTP 404 + expected_status=200 → healthy=false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }));
    const result = await tool.execute({ action: "http", url: "http://example.com" });
    const parsed = JSON.parse(result);
    expect(parsed.healthy).toBe(false);
  });

  it("HTTP 오류 (fetch 예외) → healthy=false + error 포함", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await tool.execute({ action: "http", url: "http://localhost:9" });
    const parsed = JSON.parse(result);
    expect(parsed.healthy).toBe(false);
    expect(parsed.error).toContain("ECONNREFUSED");
  });

  it("timeout_ms 파라미터 적용", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));
    const result = await tool.execute({ action: "http", url: "http://example.com", timeout_ms: 1000 });
    const parsed = JSON.parse(result);
    expect(parsed.healthy).toBe(true);
  });

  it("expected_status=201 → 정확히 201일 때만 healthy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 201 }));
    const result = await tool.execute({ action: "http", url: "http://example.com", expected_status: 201 });
    const parsed = JSON.parse(result);
    expect(parsed.healthy).toBe(true);
  });
});

describe("HealthcheckTool — tcp check", () => {
  it("TCP 연결 실패 → healthy=false", async () => {
    // 연결 불가 포트
    const result = await tool.execute({ action: "tcp", host: "localhost", port: 1, timeout_ms: 500 });
    const parsed = JSON.parse(result);
    expect(parsed.healthy).toBe(false);
    expect(parsed.host).toBe("localhost");
    expect(parsed.port).toBe(1);
    expect(typeof parsed.latency_ms).toBe("number");
  });

  it("기본 포트=80 사용", async () => {
    const result = await tool.execute({ action: "tcp", host: "localhost", timeout_ms: 300 });
    const parsed = JSON.parse(result);
    expect(parsed.port).toBe(80);
  });
});

describe("HealthcheckTool — dns check", () => {
  it("localhost DNS 조회 (실제 조회)", async () => {
    const result = await tool.execute({ action: "dns", host: "localhost" });
    const parsed = JSON.parse(result);
    // localhost는 resolve4 실패할 수 있음 - healthy true/false 모두 가능
    expect(parsed).toHaveProperty("host", "localhost");
    expect(typeof parsed.latency_ms).toBe("number");
  });

  it("존재하지 않는 호스트 → healthy=false + error", async () => {
    const result = await tool.execute({ action: "dns", host: "this-host-does-not-exist.invalid" });
    const parsed = JSON.parse(result);
    expect(parsed.healthy).toBe(false);
    expect(parsed.error).toBeTruthy();
  });
});

describe("HealthcheckTool — multi check", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("빈 endpoints → all_healthy=true, total=0", async () => {
    const result = await tool.execute({ action: "multi", endpoints: "[]" });
    const parsed = JSON.parse(result);
    expect(parsed.all_healthy).toBe(true);
    expect(parsed.total).toBe(0);
    expect(parsed.healthy_count).toBe(0);
  });

  it("유효하지 않은 endpoints JSON → error 반환", async () => {
    const result = await tool.execute({ action: "multi", endpoints: "invalid-json" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("invalid endpoints JSON");
  });

  it("http endpoint 포함", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const endpoints = JSON.stringify([{ type: "http", url: "http://example.com" }]);
    const result = await tool.execute({ action: "multi", endpoints });
    const parsed = JSON.parse(result);
    expect(parsed.total).toBe(1);
    expect(parsed.results[0].healthy).toBe(true);
  });

  it("dns endpoint 포함", async () => {
    const endpoints = JSON.stringify([{ type: "dns", host: "this-host-does-not-exist.invalid" }]);
    const result = await tool.execute({ action: "multi", endpoints });
    const parsed = JSON.parse(result);
    expect(parsed.total).toBe(1);
    // dns lookup에 실패하면 healthy=false
    expect(typeof parsed.results[0].healthy).toBe("boolean");
  });

  it("잘못된 endpoint config → healthy=false, error 포함", async () => {
    const endpoints = JSON.stringify([{ type: "unknown" }]);
    const result = await tool.execute({ action: "multi", endpoints });
    const parsed = JSON.parse(result);
    expect(parsed.results[0].healthy).toBe(false);
    expect(parsed.results[0].error).toContain("invalid endpoint config");
  });
});

describe("HealthcheckTool — ping", () => {
  it("ping → dns check와 동일 결과", async () => {
    const result = await tool.execute({ action: "ping", host: "this-host-does-not-exist.invalid" });
    const parsed = JSON.parse(result);
    expect(parsed.healthy).toBe(false);
    expect(parsed.host).toBe("this-host-does-not-exist.invalid");
  });
});

describe("HealthcheckTool — 알 수 없는 action", () => {
  it("unknown action → error JSON", async () => {
    const result = await tool.execute({ action: "unknown" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("unknown action");
  });
});
