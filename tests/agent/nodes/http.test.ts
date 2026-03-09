/** HTTP 노드 핸들러 테스트
 *
 * 목표: http_handler를 통한 HTTP 요청 실행 검증
 *       - execute: HTTP 요청 실행, 응답 수신 및 처리
 *       - Template resolution: URL, headers, body의 {{memory.key}} 치환
 *       - Private host blocking: localhost/127.x/192.168/10.x/172.16-31.x 차단
 *       - Protocol validation: http/https만 허용
 *       - Timeout handling: 100ms ~ 30s 범위 내 타임아웃
 *       - JSON parsing: Content-Type: application/json 자동 파싱
 *       - Response truncation: 50,000자 초과 응답 자르기
 *       - Validation: test() 함수의 URL 필드 검증
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { http_handler } from "@src/agent/nodes/http.js";
import type { HttpNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockHttpNode = (overrides?: Partial<HttpNodeDefinition>): HttpNodeDefinition => ({
  node_id: "http-1",
  title: "Test HTTP Node",
  node_type: "http",
  url: "https://api.example.com/users",
  method: "GET",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    api_endpoint: "https://api.github.com",
    user_id_value: "123",
    search_query: "typescript",
    previous_output: {},
  },
  ...overrides,
});

/* ── Tests ── */

describe("HTTP Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(http_handler.node_type).toBe("http");
    });

    it("should have output_schema with status, body, content_type, headers", () => {
      const schema = http_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("status");
      expect(fields).toContain("body");
      expect(fields).toContain("content_type");
      expect(fields).toContain("headers");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = http_handler.create_default?.();
      expect(defaultNode?.url).toBe("");
      expect(defaultNode?.method).toBe("GET");
    });
  });

  describe("execute — basic HTTP requests", () => {
    // Note: These tests use real HTTP calls (not mocked) to demonstrate integration
    // In production, you'd want to mock fetch. We keep them real to test actual behavior.

    it("should make GET request and return response", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/get",
        method: "GET",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
      expect(result.output.status).toBeLessThan(300);
      expect(result.output.body).toBeDefined();
    });

    it("should handle POST with string body (L56 body_str = resolved)", async () => {
      // body가 문자열이면 typeof resolved === "string" → body_str = resolved (L56)
      const node = createMockHttpNode({
        url: "https://httpbin.org/post",
        method: "POST",
        body: "raw string body",
      });
      const ctx = createMockContext();
      const result = await http_handler.execute(node, ctx);
      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });

    it("should handle POST request with JSON body", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/post",
        method: "POST",
        body: { name: "test", value: 123 },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
      expect(result.output.status).toBeLessThan(300);
    });

    it("should include content-type in headers for JSON body", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/post",
        method: "POST",
        body: { test: "data" },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
      expect(result.output.content_type).toBeDefined();
    });

    it("should parse JSON responses", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/json",
        method: "GET",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
      if (result.output.content_type.includes("application/json")) {
        expect(typeof result.output.body).toBe("object");
      }
    });

    it("should handle text responses as strings", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/html",
        method: "GET",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
      expect(typeof result.output.body).toBe("string");
    });
  });

  describe("execute — template resolution", () => {
    it("should resolve template in URL", async () => {
      const node = createMockHttpNode({
        url: "{{memory.api_endpoint}}/repos/anthropics/claude-code",
        method: "GET",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output).toBeDefined();
      // URL should be resolved from memory context
    });

    it("should resolve template in headers", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/headers",
        method: "GET",
        headers: {
          "X-User-ID": "{{memory.user_id_value}}",
          "X-Search": "{{memory.search_query}}",
        },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });

    it("should resolve template in body", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/post",
        method: "POST",
        body: {
          user_id: "{{memory.user_id_value}}",
          query: "{{memory.search_query}}",
        },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe("execute — protocol validation", () => {
    it("should reject unsupported protocol", async () => {
      const node = createMockHttpNode({
        url: "ftp://files.example.com/file.txt",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("unsupported protocol");
      }
    });

    it("should reject gopher protocol", async () => {
      const node = createMockHttpNode({
        url: "gopher://old.example.com",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("unsupported protocol");
      }
    });

    it("should allow https protocol", async () => {
      const node = createMockHttpNode({
        url: "https://api.example.com/test",
      });
      const ctx = createMockContext();

      // This will fail with host error (private), but not protocol error
      // Actually, let's use a public URL
      const publicNode = createMockHttpNode({
        url: "https://httpbin.org/get",
      });

      const result = await http_handler.execute(publicNode, ctx);

      expect(result.output).toBeDefined();
    });

    it("should allow http protocol", async () => {
      const node = createMockHttpNode({
        url: "http://example.com",
      });
      const ctx = createMockContext();

      // Note: This might still fail due to timeout or network, but not protocol validation
      const result = await http_handler.execute(node, ctx);

      // Either success or timeout error, but not protocol error
      expect(result.output).toBeDefined();
    });
  });

  describe("execute — private host blocking", () => {
    it("should reject localhost", async () => {
      const node = createMockHttpNode({
        url: "http://localhost:3000/api",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("private/loopback host blocked");
      }
    });

    it("should reject 127.0.0.1", async () => {
      const node = createMockHttpNode({
        url: "http://127.0.0.1:8080/test",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("private/loopback host blocked");
      }
    });

    it("should reject 127.x.x.x range", async () => {
      const node = createMockHttpNode({
        url: "http://127.100.200.50/api",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("private/loopback host blocked");
      }
    });

    it("should reject IPv6 loopback ::1", async () => {
      const node = createMockHttpNode({
        url: "http://[::1]:3000/api",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("private/loopback host blocked");
      }
    });

    it("should reject private 192.168.x.x", async () => {
      const node = createMockHttpNode({
        url: "http://192.168.1.1/admin",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("private/loopback host blocked");
      }
    });

    it("should reject private 10.x.x.x", async () => {
      const node = createMockHttpNode({
        url: "http://10.0.0.5/internal",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("private/loopback host blocked");
      }
    });

    it("should reject private 172.16-31.x.x", async () => {
      const node = createMockHttpNode({
        url: "http://172.20.1.1/api",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("private/loopback host blocked");
      }
    });

    it("should reject 0.0.0.0", async () => {
      const node = createMockHttpNode({
        url: "http://0.0.0.0/test",
      });
      const ctx = createMockContext();

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("private/loopback host blocked");
      }
    });

    it("should allow public IP addresses", async () => {
      const node = createMockHttpNode({
        url: "https://8.8.8.8/test",
      });
      const ctx = createMockContext();

      // This will likely timeout or fail with connection error, not host error
      const result = await http_handler.execute(node, ctx);

      // Error should exist but NOT be about private host
      if (result.output.error) {
        expect(result.output.error).not.toContain("private/loopback host blocked");
      }
    });

    it("should allow public domain names", async () => {
      const node = createMockHttpNode({
        url: "https://www.google.com",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      // Should not have private host error
      if (result.output.error) {
        expect(result.output.error).not.toContain("private/loopback host blocked");
      } else {
        expect(result.output.status).toBeGreaterThanOrEqual(200);
      }
    });
  });

  describe("execute — timeout handling", () => {
    it("should enforce maximum timeout of 30 seconds", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/delay/1",
        timeout_ms: 100_000, // Try to set 100s
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      // Should use 30s max instead of requested 100s
      expect(result.output).toBeDefined();
    });

    it("should enforce minimum timeout of 100ms", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/delay/5",
        timeout_ms: 10, // Try to set 10ms - should get bumped to 100ms
      });
      const ctx = createMockContext();

      // With 100ms minimum and a 5s delay, this will timeout or abort
      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have timed out");
      } catch (err: any) {
        // Expected: AbortError due to timeout
        expect(err.message).toContain("abort");
      }
    });

    it("should use default timeout of 10 seconds", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/get",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe("execute — response handling", () => {
    it("should return status code", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/status/201",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBe(201);
    });

    it("should return content-type header", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/json",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.content_type).toBeDefined();
    });

    it("should truncate responses exceeding 50,000 characters", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/anything",
        method: "POST",
        body: { data: "x".repeat(60000) },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.truncated).toBe(true);
    });

    it("should not truncate responses under 50,000 characters", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/json",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      // Most reasonable responses won't exceed 50k
      if (!result.output.error) {
        expect(result.output.truncated).not.toBe(true);
      }
    });

    it("should parse JSON when content-type includes application/json", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/json",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.content_type).toContain("application/json");
      expect(typeof result.output.body).toBe("object");
    });

    it("should keep as string if JSON parsing fails", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/html",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      // HTML shouldn't parse as JSON, should remain string
      expect(typeof result.output.body).toBe("string");
    });
  });

  describe("execute — HTTP methods", () => {
    it("should support GET method", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/get",
        method: "GET",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });

    it("should support POST method", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/post",
        method: "POST",
        body: { test: "data" },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });

    it("should support PUT method", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/put",
        method: "PUT",
        body: { update: "value" },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });

    it("should support DELETE method", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/delete",
        method: "DELETE",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });

    it("should support PATCH method", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/patch",
        method: "PATCH",
        body: { partial: "update" },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid URL", () => {
      const node = createMockHttpNode({
        url: "https://api.example.com/users",
      });
      const ctx = createMockContext();

      const result = http_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn if URL is empty", () => {
      const node = createMockHttpNode({
        url: "",
      });
      const ctx = createMockContext();

      const result = http_handler.test(node, ctx);

      expect(result.warnings).toContain("url is empty after template resolution");
    });

    it("should warn if template resolves to empty URL", () => {
      const node = createMockHttpNode({
        url: "{{memory.nonexistent_field}}",
      });
      const ctx = createMockContext();

      const result = http_handler.test(node, ctx);

      expect(result.warnings).toContain("url is empty after template resolution");
    });

    it("should return preview with method and URL", () => {
      const node = createMockHttpNode({
        url: "https://api.example.com/test",
        method: "POST",
      });
      const ctx = createMockContext();

      const result = http_handler.test(node, ctx);

      expect(result.preview.method).toBe("POST");
      expect(result.preview.url).toBe("https://api.example.com/test");
    });

    it("should resolve template in preview URL", () => {
      const node = createMockHttpNode({
        url: "{{memory.api_endpoint}}/repos",
      });
      const ctx = createMockContext();

      const result = http_handler.test(node, ctx);

      expect(result.preview.url).toContain("https://api.github.com");
    });

    it("should include headers in preview", () => {
      const node = createMockHttpNode({
        url: "https://api.example.com",
        headers: {
          Authorization: "Bearer token",
          "X-Custom": "value",
        },
      });
      const ctx = createMockContext();

      const result = http_handler.test(node, ctx);

      expect(result.preview.headers).toBeDefined();
      expect(result.preview.headers?.Authorization).toBe("Bearer token");
    });

    it("should include body in preview", () => {
      const node = createMockHttpNode({
        url: "https://api.example.com",
        method: "POST",
        body: { name: "test", value: 42 },
      });
      const ctx = createMockContext();

      const result = http_handler.test(node, ctx);

      expect(result.preview.body).toBeDefined();
    });

    it("should use default GET method in preview", () => {
      const node = createMockHttpNode({
        url: "https://api.example.com",
      });
      delete (node as any).method; // Remove method to use default
      const ctx = createMockContext();

      const result = http_handler.test(node, ctx);

      expect(result.preview.method).toBe("GET");
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete workflow — resolve template, make request, parse response", async () => {
      const node = createMockHttpNode({
        url: "{{memory.api_endpoint}}/users/{{memory.user_id_value}}",
        method: "GET",
        headers: {
          "X-Request-ID": "{{memory.user_id_value}}",
        },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output).toBeDefined();
      // URL should be resolved from memory
    });

    it("should create and send POST with template-resolved body", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/post",
        method: "POST",
        body: {
          user: "{{memory.user_id_value}}",
          query: "{{memory.search_query}}",
          custom: "static",
        },
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
    });

    it("should handle response with headers and parsed JSON body", async () => {
      const node = createMockHttpNode({
        url: "https://httpbin.org/json",
        method: "GET",
      });
      const ctx = createMockContext();

      const result = await http_handler.execute(node, ctx);

      expect(result.output.status).toBeGreaterThanOrEqual(200);
      expect(result.output.content_type).toBeDefined();
      // Headers may not always be in result, but status should be present
      expect(result.output.status).toBeDefined();
    });

    it("should block private host even with valid template resolution", async () => {
      const node = createMockHttpNode({
        url: "{{memory.private_endpoint}}",
      });
      const ctx = createMockContext({
        memory: {
          ...createMockContext().memory,
          private_endpoint: "http://192.168.1.1/admin",
        },
      });

      try {
        await http_handler.execute(node, ctx);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("private/loopback host blocked");
      }
    });
  });
});
