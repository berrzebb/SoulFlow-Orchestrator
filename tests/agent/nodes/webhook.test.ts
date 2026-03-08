/** Webhook 노드 핸들러 테스트
 *
 * 목표: webhook_handler를 통한 HTTP 수신 검증
 *       - runner_execute: get_webhook_data 서비스 호출
 *       - path 검증: 필수, "/"로 시작
 *       - http_method: GET/POST/PUT/DELETE 지원
 *       - response_mode: immediate/wait
 *       - 웹훅 데이터: method/headers/body/query 반환
 *       - 에러 처리: 서비스 불가/타임아웃/경로 오류
 */

import { describe, it, expect, vi } from "vitest";
import { webhook_handler } from "@src/agent/nodes/webhook.js";
import type { WebhookNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext, RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockWebhookNode = (overrides?: Partial<WebhookNodeDefinition>): WebhookNodeDefinition => ({
  node_id: "webhook-1",
  label: "Test Webhook",
  node_type: "webhook",
  path: "/api/webhook",
  http_method: "POST",
  response_mode: "immediate",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
  },
  ...overrides,
});

const createMockRunner = (overrides?: Partial<RunnerContext>): RunnerContext => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  ...overrides,
});

/* ── Tests ── */

describe("Webhook Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(webhook_handler.node_type).toBe("webhook");
    });

    it("should have output_schema with method, headers, body, query", () => {
      const schema = webhook_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("method");
      expect(fields).toContain("headers");
      expect(fields).toContain("body");
      expect(fields).toContain("query");
    });

    it("should have input_schema empty", () => {
      const schema = webhook_handler.input_schema || [];
      expect(schema).toHaveLength(0);
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = webhook_handler.create_default?.();
      expect(defaultNode?.path).toBe("");
      expect(defaultNode?.http_method).toBe("POST");
      expect(defaultNode?.response_mode).toBe("immediate");
    });

    it("should have icon and color metadata", () => {
      expect(webhook_handler.icon).toBeDefined();
      expect(webhook_handler.color).toBeDefined();
      expect(webhook_handler.shape).toBe("rect");
    });
  });

  describe("execute — fallback (no runner service)", () => {
    it("should return empty webhook data", async () => {
      const node = createMockWebhookNode();
      const ctx = createMockContext();

      const result = await webhook_handler.execute(node, ctx);

      expect(result.output.method).toBe("POST");
      expect(result.output.headers).toEqual({});
      expect(result.output.body).toEqual({});
      expect(result.output.query).toEqual({});
    });

    it("should return empty headers/body/query regardless of node config", async () => {
      const node = createMockWebhookNode({
        http_method: "GET",
        path: "/custom",
      });
      const ctx = createMockContext();

      const result = await webhook_handler.execute(node, ctx);

      expect(result.output.method).toBe("POST");
      expect(result.output.headers).toEqual({});
      expect(result.output.body).toEqual({});
      expect(result.output.query).toEqual({});
    });
  });

  describe("runner_execute — path validation", () => {
    it("should return error when path is empty", async () => {
      const node = createMockWebhookNode({ path: "" });
      const ctx = createMockContext();
      const getMockData = vi.fn();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result.output as any).error).toBe("path is required");
    });

    it("should return error when path is whitespace only", async () => {
      const node = createMockWebhookNode({ path: "   " });
      const ctx = createMockContext();
      const getMockData = vi.fn();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result.output as any).error).toBe("path is required");
    });

    it("should fallback to execute() when no get_webhook_data service", async () => {
      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: {} });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.method).toBe("POST");
      expect(result.output.headers).toEqual({});
      expect(result.output.body).toEqual({});
    });

    it("should fallback to execute() when get_webhook_data is undefined", async () => {
      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: undefined } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.method).toBe("POST");
    });
  });

  describe("runner_execute — webhook data retrieval", () => {
    it("should return webhook data from get_webhook_data service", async () => {
      const webhookData = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { event: "payment", amount: 100 },
        query: { webhook_id: "123" },
      };
      const getMockData = vi.fn().mockResolvedValue(webhookData);

      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(getMockData).toHaveBeenCalledWith("/api/webhook");
      expect(result.output.method).toBe("POST");
      expect(result.output.headers).toEqual({ "content-type": "application/json" });
      expect(result.output.body).toEqual({ event: "payment", amount: 100 });
      expect(result.output.query).toEqual({ webhook_id: "123" });
    });

    it("should return waiting=true when no data available yet", async () => {
      const getMockData = vi.fn().mockResolvedValue(null);

      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(getMockData).toHaveBeenCalledWith("/api/webhook");
      expect((result.output as any).waiting).toBe(true);
      expect(result.output.method).toBe("");
      expect(result.output.headers).toEqual({});
      expect(result.output.body).toEqual({});
      expect(result.output.query).toEqual({});
    });

    it("should return waiting=true when data is undefined", async () => {
      const getMockData = vi.fn().mockResolvedValue(undefined);

      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result.output as any).waiting).toBe(true);
    });

    it("should handle different HTTP methods", async () => {
      const webhookData = {
        method: "GET",
        headers: { "user-agent": "curl" },
        body: {},
        query: { param: "value" },
      };
      const getMockData = vi.fn().mockResolvedValue(webhookData);

      const node = createMockWebhookNode({ http_method: "GET" });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.method).toBe("GET");
      expect(result.output.headers).toEqual({ "user-agent": "curl" });
      expect(result.output.query).toEqual({ param: "value" });
    });

    it("should handle complex nested request body", async () => {
      const complexBody = {
        event: "order.created",
        data: {
          order_id: "ORD-123",
          items: [
            { sku: "ITEM-1", qty: 2, price: 50.00 },
            { sku: "ITEM-2", qty: 1, price: 100.00 },
          ],
          customer: {
            id: "CUST-456",
            email: "test@example.com",
            tags: ["vip", "early-adopter"],
          },
        },
        timestamp: "2024-01-15T10:30:00Z",
      };
      const webhookData = {
        method: "POST",
        headers: {},
        body: complexBody,
        query: {},
      };
      const getMockData = vi.fn().mockResolvedValue(webhookData);

      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.body).toEqual(complexBody);
    });
  });

  describe("runner_execute — error handling", () => {
    it("should return error when service throws", async () => {
      const getMockData = vi.fn().mockRejectedValue(new Error("Connection timeout"));

      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result.output as any).error).toContain("Connection timeout");
      expect((result.output as any).method).toBe("");
      expect(runner.logger.warn).toHaveBeenCalledWith("webhook_node_error", expect.any(Object));
    });

    it("should return error when service throws with unknown error", async () => {
      const getMockData = vi.fn().mockRejectedValue("Unknown error");

      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result.output as any).error).toBeDefined();
      expect(runner.logger.warn).toHaveBeenCalled();
    });

    it("should log warning with node_id and error details", async () => {
      const getMockData = vi.fn().mockRejectedValue(new Error("Service unavailable"));

      const node = createMockWebhookNode({ node_id: "webhook-error-test" });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      await webhook_handler.runner_execute?.(node, ctx, runner);

      expect(runner.logger.warn).toHaveBeenCalledWith(
        "webhook_node_error",
        expect.objectContaining({ node_id: "webhook-error-test", error: expect.any(String) })
      );
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid node", () => {
      const node = createMockWebhookNode({ path: "/api/webhook" });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when path is empty", () => {
      const node = createMockWebhookNode({ path: "" });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.warnings).toContain("path is required");
    });

    it("should warn when path is whitespace only", () => {
      const node = createMockWebhookNode({ path: "  \t  " });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.warnings).toContain("path is required");
    });

    it("should warn when path does not start with /", () => {
      const node = createMockWebhookNode({ path: "api/webhook" });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.warnings).toContain("path should start with /");
    });

    it("should warn only for missing / when path is non-empty", () => {
      const node = createMockWebhookNode({ path: "no-slash" });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.warnings).toContain("path should start with /");
      expect(result.warnings).not.toContain("path is required");
    });

    it("should not warn when path has leading / with valid content", () => {
      const node = createMockWebhookNode({ path: "/webhooks/stripe" });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should include preview with path, method, response_mode", () => {
      const node = createMockWebhookNode({
        path: "/api/webhook",
        http_method: "PUT",
        response_mode: "wait",
      });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.preview.path).toBe("/api/webhook");
      expect(result.preview.method).toBe("PUT");
      expect(result.preview.response_mode).toBe("wait");
    });

    it("should preserve path in preview even with validation warnings", () => {
      const node = createMockWebhookNode({ path: "invalid" });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.preview.path).toBe("invalid");
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should validate multiple paths correctly", () => {
      const testCases = [
        { path: "", shouldWarn: true },
        { path: "/", shouldWarn: false },
        { path: "/api", shouldWarn: false },
        { path: "/api/v1/webhook", shouldWarn: false },
        { path: "/api-v1", shouldWarn: false },
        { path: "api/webhook", shouldWarn: true },
        { path: "webhook", shouldWarn: true },
      ];

      for (const { path, shouldWarn } of testCases) {
        const node = createMockWebhookNode({ path });
        const result = webhook_handler.test(node, createMockContext());
        if (shouldWarn) {
          expect(result.warnings.length).toBeGreaterThan(0);
        } else {
          expect(result.warnings).toEqual([]);
        }
      }
    });
  });

  describe("integration scenarios", () => {
    it("should handle webhook from external service", async () => {
      const externalPayload = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": "sha256=abc123",
          "user-agent": "github-hook/1.0",
        },
        body: {
          action: "opened",
          pull_request: {
            id: 1,
            title: "Add webhook support",
            author: "user-123",
          },
        },
        query: {},
      };
      const getMockData = vi.fn().mockResolvedValue(externalPayload);

      const node = createMockWebhookNode({
        path: "/webhooks/github",
        http_method: "POST",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.method).toBe("POST");
      expect(result.output.headers["x-webhook-signature"]).toBe("sha256=abc123");
      expect((result.output.body as any).action).toBe("opened");
    });

    it("should handle multiple webhook calls sequentially", async () => {
      const payload1 = {
        method: "POST",
        headers: {},
        body: { event: "first" },
        query: {},
      };
      const payload2 = {
        method: "POST",
        headers: {},
        body: { event: "second" },
        query: {},
      };
      const getMockData = vi.fn()
        .mockResolvedValueOnce(payload1)
        .mockResolvedValueOnce(payload2);

      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result1 = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };
      const result2 = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result1.output.body as any).event).toBe("first");
      expect((result2.output.body as any).event).toBe("second");
      expect(getMockData).toHaveBeenCalledTimes(2);
    });

    it("should support different response modes in preview", () => {
      const node1 = createMockWebhookNode({ response_mode: "immediate" });
      const node2 = createMockWebhookNode({ response_mode: "wait" });

      const result1 = webhook_handler.test(node1, createMockContext());
      const result2 = webhook_handler.test(node2, createMockContext());

      expect(result1.preview.response_mode).toBe("immediate");
      expect(result2.preview.response_mode).toBe("wait");
    });

    it("should handle GET request with query parameters", async () => {
      const webhookData = {
        method: "GET",
        headers: { "accept": "application/json" },
        body: {},
        query: {
          id: "123",
          filter: "active",
          page: "1",
        },
      };
      const getMockData = vi.fn().mockResolvedValue(webhookData);

      const node = createMockWebhookNode({
        http_method: "GET",
        path: "/api/query",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.method).toBe("GET");
      expect(result.output.query).toEqual({ id: "123", filter: "active", page: "1" });
    });

    it("should handle DELETE request with minimal payload", async () => {
      const webhookData = {
        method: "DELETE",
        headers: {},
        body: {},
        query: { resource_id: "456" },
      };
      const getMockData = vi.fn().mockResolvedValue(webhookData);

      const node = createMockWebhookNode({
        http_method: "DELETE",
        path: "/api/resource",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.method).toBe("DELETE");
      expect(result.output.body).toEqual({});
    });
  });

  describe("edge cases", () => {
    it("should handle path with special characters", () => {
      const node = createMockWebhookNode({ path: "/api/v1.0/webhook-event" });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
      expect(result.preview.path).toBe("/api/v1.0/webhook-event");
    });

    it("should handle path with trailing slash", () => {
      const node = createMockWebhookNode({ path: "/api/webhook/" });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should handle very long path", () => {
      const longPath = "/" + "segment/".repeat(50).slice(0, -1);
      const node = createMockWebhookNode({ path: longPath });
      const ctx = createMockContext();

      const result = webhook_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
      expect(result.preview.path).toBe(longPath);
    });

    it("should handle empty headers in webhook data", async () => {
      const webhookData = {
        method: "POST",
        headers: {},
        body: { data: "test" },
        query: {},
      };
      const getMockData = vi.fn().mockResolvedValue(webhookData);

      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.headers).toEqual({});
    });

    it("should pass through null query parameters from webhook data", async () => {
      const webhookData = {
        method: "POST",
        headers: {},
        body: {},
        query: null,
      };
      const getMockData = vi.fn().mockResolvedValue(webhookData);

      const node = createMockWebhookNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { get_webhook_data: getMockData } });

      const result = await webhook_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      // Handler passes data through as-is, so null query becomes null
      expect(result.output.query).toBeNull();
      expect((result.output as any).error).toBeUndefined();
    });

    it("should handle case sensitivity in HTTP methods", () => {
      const node1 = createMockWebhookNode({ http_method: "POST" });
      const node2 = createMockWebhookNode({ http_method: "GET" });
      const node3 = createMockWebhookNode({ http_method: "PUT" });

      const r1 = webhook_handler.test(node1, createMockContext());
      const r2 = webhook_handler.test(node2, createMockContext());
      const r3 = webhook_handler.test(node3, createMockContext());

      expect(r1.preview.method).toBe("POST");
      expect(r2.preview.method).toBe("GET");
      expect(r3.preview.method).toBe("PUT");
    });
  });
});
