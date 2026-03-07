import { describe, it, expect } from "vitest";
import { webhook_handler } from "@src/agent/nodes/webhook.js";
import type { WebhookNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

function make_node(overrides: Partial<WebhookNodeDefinition> = {}): OrcheNodeDefinition {
  return {
    node_id: "wh1",
    node_type: "webhook",
    label: "Webhook",
    path: "/api/hook",
    http_method: "POST",
    response_mode: "immediate",
    ...overrides,
  } as OrcheNodeDefinition;
}

const base_ctx: OrcheNodeExecutorContext = { memory: {} };

describe("webhook_handler.execute", () => {
  it("기본 실행 — 빈 fallback 반환", async () => {
    const r = await webhook_handler.execute(make_node(), base_ctx);
    expect(r.output).toEqual({ method: "POST", headers: {}, body: {}, query: {} });
  });
});

describe("webhook_handler.test", () => {
  it("path 비어있으면 경고", () => {
    const r = webhook_handler.test(make_node({ path: "" }));
    expect(r.warnings).toContain("path is required");
  });

  it("path가 /로 시작하지 않으면 경고", () => {
    const r = webhook_handler.test(make_node({ path: "no-slash" }));
    expect(r.warnings).toContain("path should start with /");
  });

  it("정상 path → 경고 없음", () => {
    const r = webhook_handler.test(make_node({ path: "/api/hook" }));
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 설정 정보 포함", () => {
    const r = webhook_handler.test(make_node({ path: "/test", http_method: "GET", response_mode: "deferred" }));
    const p = r.preview as Record<string, unknown>;
    expect(p.path).toBe("/test");
    expect(p.method).toBe("GET");
    expect(p.response_mode).toBe("deferred");
  });
});
