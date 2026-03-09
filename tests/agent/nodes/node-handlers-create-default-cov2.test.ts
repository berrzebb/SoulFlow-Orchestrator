/**
 * create_default() 미커버 4개 핸들러 + http.ts 비문자열 body 분기 보충.
 * retriever L27 / ssh L22 / validator L23 / web-search L23 / http L58
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { retriever_handler } from "@src/agent/nodes/retriever.js";
import { ssh_handler } from "@src/agent/nodes/ssh.js";
import { validator_handler } from "@src/agent/nodes/validator.js";
import { web_search_handler } from "@src/agent/nodes/web-search.js";
import { http_handler } from "@src/agent/nodes/http.js";

// ══════════════════════════════════════════
// create_default() 커버리지
// ══════════════════════════════════════════

describe("NodeHandlers — create_default() 미커버 4종", () => {
  it("retriever create_default → source/query/url/top_k 필드 (L27)", () => {
    const d = retriever_handler.create_default!();
    expect(d).toBeDefined();
    expect(d.source).toBe("http");
    expect(d.top_k).toBe(5);
  });

  it("ssh create_default → action/host/command/port 필드 (L22)", () => {
    const d = ssh_handler.create_default!();
    expect(d).toBeDefined();
    expect(d.action).toBe("exec");
    expect(d.port).toBe(22);
  });

  it("validator create_default → operation/input/format/schema/rules 필드 (L23)", () => {
    const d = validator_handler.create_default!();
    expect(d).toBeDefined();
    expect(d.operation).toBe("format");
    expect(d.format).toBe("json");
  });

  it("web_search create_default → query/max_results/search_engine 필드 (L23)", () => {
    const d = web_search_handler.create_default!();
    expect(d).toBeDefined();
    expect(d.max_results).toBe(5);
    expect(d.search_engine).toBe("google");
  });
});

// ══════════════════════════════════════════
// http.ts L58: 비문자열 body → JSON.stringify 분기
// ══════════════════════════════════════════

describe("http_handler — 비문자열 body → JSON.stringify (L58)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("object body → JSON.stringify 후 Content-Type 자동 설정", async () => {
    const mock_fetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ ok: true }),
    });
    vi.stubGlobal("fetch", mock_fetch);

    const node = {
      node_id: "h1",
      node_type: "http",
      url: "https://api.example.com/data",
      method: "POST",
      body: { key: "value", count: 42 }, // 객체 → L58: JSON.stringify
    } as any;

    const result = await http_handler.execute(node, { memory: {} } as any);
    expect(result.output.status).toBe(200);

    // fetch 호출 시 body가 JSON 문자열로 전달됐는지 확인
    const call_args = mock_fetch.mock.calls[0];
    const init = call_args[1];
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body)).toEqual({ key: "value", count: 42 });
    // Content-Type 헤더가 자동 추가됨
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("number body → JSON.stringify (L58)", async () => {
    const mock_fetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: { get: () => "text/plain" },
      text: async () => "ok",
    });
    vi.stubGlobal("fetch", mock_fetch);

    const node = {
      node_id: "h2",
      node_type: "http",
      url: "https://api.example.com/num",
      method: "POST",
      body: 99, // 숫자 → L58: JSON.stringify
    } as any;

    const result = await http_handler.execute(node, { memory: {} } as any);
    expect(result.output.status).toBe(200);

    const init = mock_fetch.mock.calls[0][1];
    expect(init.body).toBe("99");
  });
});
