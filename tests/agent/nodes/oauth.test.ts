/** OAuth (토큰 자동 주입 HTTP) 노드 핸들러 테스트
 *
 * 목표: oauth_handler를 통한 OAuth 기반 HTTP 요청 검증
 *       - execute: 기본 응답 (runner 없음)
 *       - runner_execute: oauth_fetch 호출로 실제 요청 수행
 *       - service_id + url: 필수 매개변수
 *       - headers/body: 템플릿 변수 해석
 *       - 에러 처리
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { oauth_handler } from "@src/agent/nodes/oauth.js";
import type { OauthNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext, RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockOauthNode = (overrides?: Partial<OauthNodeDefinition>): OauthNodeDefinition => ({
  node_id: "oauth-1",
  title: "Test OAuth Node",
  node_type: "oauth",
  service_id: "github",
  url: "https://api.github.com/user",
  method: "GET",
  headers: undefined,
  body: undefined,
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

const createMockRunnerContext = (overrides?: Partial<RunnerContext>): RunnerContext => ({
  state: {
    workflow_id: "wf-1",
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    memory: {},
  },
  all_nodes: [],
  options: {
    workspace: { id: "workspace-1", api_key: "test-key" },
    abort_signal: undefined,
  },
  execute_node: vi.fn(),
  emit: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  services: {
    oauth_fetch: vi.fn(),
  },
  ...overrides,
});

/* ── Tests ── */

describe("OAuth Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(oauth_handler.node_type).toBe("oauth");
    });

    it("should have output_schema with status, body, headers", () => {
      const schema = oauth_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("status");
      expect(fields).toContain("body");
      expect(fields).toContain("headers");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = oauth_handler.create_default?.();
      expect(defaultNode?.method).toBe("GET");
      expect(defaultNode?.service_id).toBe("");
    });
  });

  describe("execute — basic operation (no runner)", () => {
    it("should return empty response without runner", async () => {
      const node = createMockOauthNode();
      const ctx = createMockContext();

      const result = await oauth_handler.execute(node, ctx);

      expect(result.output.status).toBe(0);
      expect(result.output.body).toBeNull();
      expect(result.output.headers).toEqual({});
    });

    it("should include _meta with resolved URL", async () => {
      const node = createMockOauthNode({
        url: "https://api.example.com/user",
      });
      const ctx = createMockContext();

      const result = await oauth_handler.execute(node, ctx);

      expect((result.output as any)._meta.url).toBe("https://api.example.com/user");
      expect((result.output as any)._meta.service_id).toBe("github");
    });
  });

  describe("runner_execute — with oauth_fetch service", () => {
    it("should call oauth_fetch with correct parameters", async () => {
      const node = createMockOauthNode({
        service_id: "github",
        url: "https://api.github.com/user",
        method: "GET",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 200,
            body: { login: "octocat" },
            headers: { "content-type": "application/json" },
          }),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(mockRunner.services!.oauth_fetch).toHaveBeenCalledWith(
        "github",
        expect.objectContaining({
          url: "https://api.github.com/user",
          method: "GET",
        })
      );
      expect(result.output.status).toBe(200);
      expect(result.output.body).toEqual({ login: "octocat" });
    });

    it("should return 401 for invalid OAuth", async () => {
      const node = createMockOauthNode({
        service_id: "invalid_service",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 401,
            body: { error: "Unauthorized" },
            headers: {},
          }),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.status).toBe(401);
    });

    it("should fallback to execute when oauth_fetch unavailable", async () => {
      const node = createMockOauthNode();
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: undefined,
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.status).toBe(0);
      expect(result.output.body).toBeNull();
    });
  });

  describe("runner_execute — validation", () => {
    it("should fail when service_id missing", async () => {
      const node = createMockOauthNode({
        service_id: "",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn(),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.status).toBe(0);
      expect(result.output.error).toContain("service_id is required");
      expect(mockRunner.services!.oauth_fetch).not.toHaveBeenCalled();
    });

    it("should fail when url missing", async () => {
      const node = createMockOauthNode({
        url: "",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn(),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.status).toBe(0);
      expect(result.output.error).toContain("url is required");
    });

    it("should fail when service_id is whitespace only", async () => {
      const node = createMockOauthNode({
        service_id: "   ",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn(),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.error).toContain("service_id is required");
    });
  });

  describe("runner_execute — template resolution", () => {
    it("should resolve URL template variables", async () => {
      const node = createMockOauthNode({
        url: "https://api.{{memory.domain}}/user",
      });
      const ctx = createMockContext({
        memory: { domain: "github.com" },
      });
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 200,
            body: { user: "alice" },
            headers: {},
          }),
        },
      });

      await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.oauth_fetch as any).mock.calls[0];
      expect(call[1].url).toContain("github.com");
    });

    it("should resolve headers template variables", async () => {
      const node = createMockOauthNode({
        url: "https://api.example.com/data",
        headers: {
          "Authorization": "Bearer {{memory.token}}",
          "X-User-ID": "{{memory.user_id}}",
        },
      });
      const ctx = createMockContext({
        memory: { token: "secret123", user_id: "42" },
      });
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 200,
            body: {},
            headers: {},
          }),
        },
      });

      await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.oauth_fetch as any).mock.calls[0];
      expect(call[1].headers).toEqual({
        "Authorization": "Bearer secret123",
        "X-User-ID": "42",
      });
    });

    it("should resolve body template variables", async () => {
      const node = createMockOauthNode({
        method: "POST",
        url: "https://api.example.com/create",
        body: {
          name: "{{memory.name}}",
          email: "{{memory.email}}",
        },
      });
      const ctx = createMockContext({
        memory: { name: "Bob", email: "bob@example.com" },
      });
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 201,
            body: { id: 123 },
            headers: {},
          }),
        },
      });

      await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.oauth_fetch as any).mock.calls[0];
      expect(call[1].body).toEqual({
        name: "Bob",
        email: "bob@example.com",
      });
    });
  });

  describe("runner_execute — HTTP methods", () => {
    it("should support GET method", async () => {
      const node = createMockOauthNode({
        method: "GET",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 200,
            body: {},
            headers: {},
          }),
        },
      });

      await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.oauth_fetch as any).mock.calls[0];
      expect(call[1].method).toBe("GET");
    });

    it("should support POST method", async () => {
      const node = createMockOauthNode({
        method: "POST",
        url: "https://api.example.com/create",
        body: { name: "test" },
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 201,
            body: { id: 1 },
            headers: {},
          }),
        },
      });

      await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.oauth_fetch as any).mock.calls[0];
      expect(call[1].method).toBe("POST");
    });

    it("should default method to GET", async () => {
      const node = createMockOauthNode();
      delete node.method;
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 200,
            body: {},
            headers: {},
          }),
        },
      });

      await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      const call = (mockRunner.services!.oauth_fetch as any).mock.calls[0];
      expect(call[1].method).toBe("GET");
    });
  });

  describe("runner_execute — error handling", () => {
    it("should catch oauth_fetch errors gracefully", async () => {
      const node = createMockOauthNode();
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockRejectedValueOnce(new Error("Network timeout")),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.status).toBe(0);
      expect(result.output.error).toContain("Network timeout");
      expect(mockRunner.logger.warn).toHaveBeenCalledWith(
        "oauth_node_error",
        expect.objectContaining({ node_id: "oauth-1" })
      );
    });

    it("should handle rate limit response", async () => {
      const node = createMockOauthNode();
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 429,
            body: { error: "Too many requests" },
            headers: { "retry-after": "3600" },
          }),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.status).toBe(429);
      expect(result.output.headers["retry-after"]).toBe("3600");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockOauthNode({
        service_id: "github",
        url: "https://api.github.com/user",
      });
      const ctx = createMockContext();

      const result = oauth_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when service_id missing", () => {
      const node = createMockOauthNode({
        service_id: "",
      });
      const ctx = createMockContext();

      const result = oauth_handler.test(node, ctx);

      expect(result.warnings).toContain("service_id is required");
    });

    it("should warn when url missing", () => {
      const node = createMockOauthNode({
        url: "",
      });
      const ctx = createMockContext();

      const result = oauth_handler.test(node, ctx);

      expect(result.warnings).toContain("url is required");
    });

    it("should include service_id, method, url in preview", () => {
      const node = createMockOauthNode({
        service_id: "slack",
        method: "POST",
        url: "https://slack.com/api/chat.postMessage",
      });
      const ctx = createMockContext();

      const result = oauth_handler.test(node, ctx);

      expect(result.preview.service_id).toBe("slack");
      expect(result.preview.method).toBe("POST");
      expect(result.preview.url).toContain("slack.com");
    });

    it("should resolve URL in preview", () => {
      const node = createMockOauthNode({
        url: "https://{{memory.domain}}/endpoint",
      });
      const ctx = createMockContext({
        memory: { domain: "api.example.com" },
      });

      const result = oauth_handler.test(node, ctx);

      expect(result.preview.url).toContain("api.example.com");
    });
  });

  describe("integration scenarios", () => {
    it("should fetch user data from GitHub", async () => {
      const node = createMockOauthNode({
        service_id: "github",
        url: "https://api.github.com/user",
      });
      const ctx = createMockContext();
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 200,
            body: { login: "octocat", id: 1, name: "The Octocat" },
            headers: { "content-type": "application/json" },
          }),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.status).toBe(200);
      expect(result.output.body.login).toBe("octocat");
    });

    it("should post message to Slack", async () => {
      const node = createMockOauthNode({
        service_id: "slack",
        url: "https://slack.com/api/chat.postMessage",
        method: "POST",
        body: {
          channel: "{{memory.channel}}",
          text: "{{memory.message}}",
        },
      });
      const ctx = createMockContext({
        memory: { channel: "#general", message: "Hello team!" },
      });
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 200,
            body: { ok: true, ts: "1234567890.123456" },
            headers: {},
          }),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.status).toBe(200);
      expect(result.output.body.ok).toBe(true);
    });

    it("should handle multi-header OAuth request", async () => {
      const node = createMockOauthNode({
        service_id: "api_gateway",
        url: "https://api.example.com/secure/data",
        method: "GET",
        headers: {
          "Authorization": "Bearer {{memory.access_token}}",
          "X-API-Key": "{{memory.api_key}}",
          "X-Request-ID": "{{memory.request_id}}",
        },
      });
      const ctx = createMockContext({
        memory: {
          access_token: "abc123",
          api_key: "secret",
          request_id: "req-001",
        },
      });
      const mockRunner = createMockRunnerContext({
        services: {
          oauth_fetch: vi.fn().mockResolvedValueOnce({
            status: 200,
            body: { data: [1, 2, 3] },
            headers: {},
          }),
        },
      });

      const result = await oauth_handler.runner_execute!(node, ctx, mockRunner as RunnerContext);

      expect(result.output.status).toBe(200);
    });
  });
});
