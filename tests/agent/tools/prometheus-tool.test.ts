/**
 * PrometheusTool — format/parse/push/query_format 커버리지.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { PrometheusTool } from "@src/agent/tools/prometheus.js";

function make_tool() { return new PrometheusTool(); }

afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("PrometheusTool — 메타데이터", () => {
  it("name = prometheus", () => expect(make_tool().name).toBe("prometheus"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// format
// ══════════════════════════════════════════

describe("PrometheusTool — format", () => {
  it("단순 메트릭 포맷", async () => {
    const r = await make_tool().execute({
      action: "format",
      metrics: JSON.stringify([{ name: "cpu_usage", type: "gauge", help: "CPU usage", value: 0.75 }]),
    });
    expect(r).toContain("# HELP cpu_usage CPU usage");
    expect(r).toContain("# TYPE cpu_usage gauge");
    expect(r).toContain("cpu_usage 0.75");
  });

  it("labels 포함 포맷", async () => {
    const r = await make_tool().execute({
      action: "format",
      metrics: JSON.stringify([{ name: "http_requests", value: 100, labels: { method: "GET", status: "200" } }]),
    });
    expect(r).toContain('http_requests{');
    expect(r).toContain('method="GET"');
  });

  it("timestamp 포함", async () => {
    const r = await make_tool().execute({
      action: "format",
      metrics: JSON.stringify([{ name: "temp", value: 25, timestamp: 1700000000000 }]),
    });
    expect(r).toContain("temp 25 1700000000000");
  });

  it("같은 이름 중복 → HELP/TYPE 한 번만", async () => {
    const r = await make_tool().execute({
      action: "format",
      metrics: JSON.stringify([
        { name: "hits", type: "counter", value: 1 },
        { name: "hits", type: "counter", value: 2, labels: { env: "prod" } },
      ]),
    });
    const type_count = (r.match(/# TYPE hits counter/g) || []).length;
    expect(type_count).toBe(1);
  });

  it("잘못된 JSON → Error", async () => {
    const r = await make_tool().execute({ action: "format", metrics: "{invalid}" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("JSON");
  });

  it("metrics 없음 (빈 배열) → 빈 줄", async () => {
    const r = await make_tool().execute({ action: "format", metrics: "[]" });
    expect(r.trim()).toBe("");
  });

  it("labels 특수문자 이스케이프", async () => {
    const r = await make_tool().execute({
      action: "format",
      metrics: JSON.stringify([{
        name: "req",
        value: 1,
        labels: { path: '/api/"test"' },
      }]),
    });
    expect(r).toContain('\\"test\\"');
  });
});

// ══════════════════════════════════════════
// parse
// ══════════════════════════════════════════

describe("PrometheusTool — parse", () => {
  const EXPOSITION = `# HELP http_requests Total HTTP requests
# TYPE http_requests counter
http_requests{method="GET",status="200"} 1234 1700000000000
http_requests{method="POST",status="201"} 56
# TYPE cpu gauge
cpu 0.45
`;

  it("파싱 → count=3", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: EXPOSITION }));
    expect(r.count).toBe(3);
  });

  it("type/help 연결", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: EXPOSITION }));
    expect(r.metrics[0].type).toBe("counter");
    expect(r.metrics[0].help).toContain("HTTP requests");
  });

  it("labels 파싱", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: EXPOSITION }));
    expect(r.metrics[0].labels?.method).toBe("GET");
    expect(r.metrics[0].labels?.status).toBe("200");
  });

  it("timestamp 파싱", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: EXPOSITION }));
    expect(r.metrics[0].timestamp).toBe(1700000000000);
  });

  it("labels 없는 메트릭 → labels undefined", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: EXPOSITION }));
    expect(r.metrics[2].labels).toBeUndefined();
  });

  it("빈 입력 → count=0", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "parse", input: "" }));
    expect(r.count).toBe(0);
  });

  it("주석 줄 무시", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "parse",
      input: "# custom comment\n# TYPE foo gauge\nfoo 1\n",
    }));
    expect(r.count).toBe(1);
  });
});

// ══════════════════════════════════════════
// push
// ══════════════════════════════════════════

describe("PrometheusTool — push", () => {
  it("pushgateway_url 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "push" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("pushgateway_url");
  });

  it("잘못된 metrics JSON → Error", async () => {
    const r = await make_tool().execute({
      action: "push",
      pushgateway_url: "http://localhost:9091",
      metrics: "invalid",
    });
    expect(String(r)).toContain("Error");
  });

  it("push 성공", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 200 }),
    );
    const r = JSON.parse(await make_tool().execute({
      action: "push",
      pushgateway_url: "http://pushgateway.example.com:9091",
      job: "my-job",
      metrics: JSON.stringify([{ name: "custom_metric", value: 42 }]),
    }));
    expect(r.success).toBe(true);
    expect(r.status).toBe(200);
    expect(r.url).toContain("my-job");
  });

  it("push 실패 (HTTP 500) → success=false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 500 }),
    );
    const r = JSON.parse(await make_tool().execute({
      action: "push",
      pushgateway_url: "http://pushgateway.example.com",
      metrics: "[]",
    }));
    expect(r.success).toBe(false);
  });

  it("push 네트워크 오류 → success=false + error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connection refused"));
    const r = JSON.parse(await make_tool().execute({
      action: "push",
      pushgateway_url: "http://localhost:9091",
      metrics: "[]",
    }));
    expect(r.success).toBe(false);
    expect(r.error).toContain("connection refused");
  });

  it("URL 끝 슬래시 제거", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 200 }),
    );
    await make_tool().execute({
      action: "push",
      pushgateway_url: "http://gateway.example.com:9091///",
      metrics: "[]",
    });
    const called_url = spy.mock.calls[0][0] as string;
    expect(called_url).not.toContain("///");
  });
});

// ══════════════════════════════════════════
// query_format
// ══════════════════════════════════════════

describe("PrometheusTool — query_format", () => {
  it("query 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "query_format" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("query");
  });

  it("instant query → /api/v1/query", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "query_format",
      query: "up",
    }));
    expect(r.endpoint).toBe("/api/v1/query");
    expect(r.query_string).toContain("query=up");
  });

  it("range query → /api/v1/query_range", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "query_format",
      query: "rate(http_requests[5m])",
      start: "2024-01-01T00:00:00Z",
      end: "2024-01-01T01:00:00Z",
      step: "15s",
    }));
    expect(r.endpoint).toBe("/api/v1/query_range");
    expect(r.query_string).toContain("start=");
    expect(r.query_string).toContain("step=15s");
  });
});

// ══════════════════════════════════════════
// unsupported action
// ══════════════════════════════════════════

describe("PrometheusTool — unsupported action", () => {
  it("bogus → Error", async () => {
    const r = await make_tool().execute({ action: "bogus" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});
