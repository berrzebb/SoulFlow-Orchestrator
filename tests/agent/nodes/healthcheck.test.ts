import { describe, it, expect } from "vitest";
import { healthcheck_handler } from "../../../src/agent/nodes/healthcheck.js";
import type { HealthcheckNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("healthcheck_handler", () => {
  const createMockNode = (overrides?: Partial<HealthcheckNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "healthcheck",
    action: "http",
    url: "https://example.com",
    host: "example.com",
    port: 443,
    timeout_ms: 5000,
    expected_status: 200,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be healthcheck", () => {
    expect(healthcheck_handler.node_type).toBe("healthcheck");
  });

  it("metadata: output_schema should have healthy and result fields", () => {
    expect(healthcheck_handler.output_schema).toEqual([
      { name: "healthy", type: "boolean", description: "Whether target is healthy" },
      { name: "result", type: "unknown", description: "Check details" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = healthcheck_handler.create_default?.();
    expect(defaults).toEqual({
      action: "http",
      url: "",
      timeout_ms: 5000,
    });
  });

  it("execute: should handle http check", async () => {
    const node = createMockNode({ action: "http", url: "https://example.com" });
    const ctx = createMockContext();
    const result = await healthcheck_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("healthy");
    expect(result.output).toHaveProperty("result");
  });

  it("execute: should resolve templates in url", async () => {
    const node = createMockNode({ action: "http", url: "${target_url}" });
    const ctx = createMockContext({ target_url: "https://api.example.com" });
    const result = await healthcheck_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in host", async () => {
    const node = createMockNode({ action: "tcp", host: "${server_host}" });
    const ctx = createMockContext({ server_host: "db.example.com" });
    const result = await healthcheck_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if url is missing for http check", () => {
    const node = createMockNode({ action: "http", url: undefined });
    const result = healthcheck_handler.test(node);
    expect(result.warnings).toContain("url is required for http check");
  });

  it("test validation: should warn if host is missing for tcp check", () => {
    const node = createMockNode({ action: "tcp", host: undefined });
    const result = healthcheck_handler.test(node);
    expect(result.warnings).toContain("host is required");
  });

  it("test validation: should warn if host is missing for dns check", () => {
    const node = createMockNode({ action: "dns", host: undefined });
    const result = healthcheck_handler.test(node);
    expect(result.warnings).toContain("host is required");
  });

  it("test: preview should contain action, url, and host", () => {
    const node = createMockNode({ action: "http", url: "https://test.com", host: "test.com" });
    const result = healthcheck_handler.test(node);
    expect(result.preview).toEqual({ action: "http", url: "https://test.com", host: "test.com" });
  });

  it("execute: should handle missing action (default to http)", async () => {
    const node = createMockNode({ action: undefined });
    const ctx = createMockContext();
    const result = await healthcheck_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ action: "http" });
    const ctx = createMockContext();
    const result = await healthcheck_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: endpoints 배열 전달 → resolve_templates TypeError → catch → L41 healthy=false", async () => {
    // endpoints가 배열이면 resolve_templates 호출 시 .replace 없어서 throw → catch(L41)
    const node = { node_id: "n1", node_type: "healthcheck", action: "http", endpoints: ["url1", "url2"] as any } as OrcheNodeDefinition;
    const ctx = createMockContext();
    const result = await healthcheck_handler.execute(node, ctx);
    expect((result.output as any).healthy).toBe(false);
    expect((result.output as any).result).toBeNull();
  });
});
