/**
 * http.ts — 미커버 분기 보충:
 * - L44: user_agent 설정 + User-Agent 헤더 없음 → req_headers["User-Agent"] 추가
 * - L55: body가 객체 → JSON.stringify(resolved)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { http_handler } from "@src/agent/nodes/http.js";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function make_ctx(): OrcheNodeExecutorContext {
  return { memory: {}, workspace: "/tmp", abort_signal: undefined };
}

function make_node(overrides: Record<string, unknown>): OrcheNodeDefinition {
  return {
    node_id: "n1",
    node_type: "http",
    url: "https://example.com/api",
    method: "GET",
    ...overrides,
  } as unknown as OrcheNodeDefinition;
}

function stub_fetch(body = "{}"): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: vi.fn().mockReturnValue("application/json") },
    text: vi.fn().mockResolvedValue(body),
  }));
}

// ── L44: user_agent 설정 → User-Agent 헤더 추가 ──────────────────────────────

describe("http_handler — L44: user_agent → User-Agent 헤더", () => {
  it("user_agent 설정 + headers에 User-Agent 없음 → L44 실행", async () => {
    stub_fetch();
    const node = make_node({ user_agent: "TestBot/1.0" });
    const result = await http_handler.execute(node, make_ctx());
    expect(result.output.status).toBe(200);
    // fetch가 호출됐으므로 User-Agent가 추가된 것 확인
    const mock = vi.mocked(fetch);
    const call_options = mock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((call_options?.headers as Record<string, string>)?.["User-Agent"]).toBe("TestBot/1.0");
  });
});

// ── L55: body 객체 → JSON.stringify ─────────────────────────────────────────

describe("http_handler — L55: 객체 body → JSON.stringify", () => {
  it("body가 객체 → JSON.stringify + Content-Type: application/json (L55)", async () => {
    stub_fetch('{"ok":true}');
    const node = make_node({ method: "POST", body: { key: "value", num: 42 } });
    const result = await http_handler.execute(node, make_ctx());
    expect(result.output.status).toBe(200);
    const mock = vi.mocked(fetch);
    const call_options = mock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(typeof call_options?.body).toBe("string");
    expect(call_options?.body).toContain("\"key\"");
    const headers = call_options?.headers as Record<string, string>;
    expect(headers?.["Content-Type"]).toBe("application/json");
  });
});
