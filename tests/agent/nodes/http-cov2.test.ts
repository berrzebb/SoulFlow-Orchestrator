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

// ── L44: user_agent 설정 → User-Agent 헤더 추가 (.some 콜백 포함) ────────────

describe("http_handler — L44: user_agent → User-Agent 헤더", () => {
  it("user_agent + 헤더 있음 → .some() 콜백 실행 → user-agent 아닌 헤더 → L44/L45 실행", async () => {
    stub_fetch();
    // headers에 X-Custom이 있으면 .some() 콜백이 실행됨 (user-agent 아님 → false)
    // → User-Agent 추가됨
    const node = make_node({
      user_agent: "TestBot/1.0",
      headers: { "X-Custom": "value" },
    });
    const result = await http_handler.execute(node, make_ctx());
    expect(result.output.status).toBe(200);
    const mock = vi.mocked(fetch);
    const call_options = mock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((call_options?.headers as Record<string, string>)?.["User-Agent"]).toBe("TestBot/1.0");
  });
});

// ── L55: body 객체 → JSON.stringify (.some 콜백 포함) ───────────────────────

describe("http_handler — L55: 객체 body → JSON.stringify", () => {
  it("body 객체 + headers에 content-type 아닌 헤더 → .some() 콜백 실행 → Content-Type 추가 (L55)", async () => {
    stub_fetch('{"ok":true}');
    // headers에 X-Custom이 있으면 .some() 콜백 실행 (content-type 아님 → false)
    // → Content-Type 추가됨
    const node = make_node({
      method: "POST",
      body: { key: "value", num: 42 },
      headers: { "X-Custom": "header" },
    });
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
