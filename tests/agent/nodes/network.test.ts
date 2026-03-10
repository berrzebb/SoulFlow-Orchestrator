import { describe, it, expect } from "vitest";
import { network_handler } from "../../../src/agent/nodes/network.js";
import type { NetworkNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("network_handler", () => {
  const createMockNode = (overrides?: Partial<NetworkNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "network",
    operation: "ping",
    host: "example.com",
    port: 80,
    count: 3,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be network", () => {
    expect(network_handler.node_type).toBe("network");
  });

  it("metadata: output_schema should have output and success", () => {
    expect(network_handler.output_schema).toEqual([
      { name: "output", type: "string", description: "Command output" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = network_handler.create_default?.();
    expect(defaults).toBeDefined();
    expect(defaults).toHaveProperty("operation");
    expect(defaults).toHaveProperty("host");
  });

  it("execute: should handle ping operation", async () => {
    const node = createMockNode({ operation: "ping" });
    const ctx = createMockContext();
    const result = await network_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("output");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in host", async () => {
    const node = createMockNode({ operation: "dns", host: "${server_host}" });
    const ctx = createMockContext({ server_host: "dns.example.com" });
    const result = await network_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle dns operation", async () => {
    const node = createMockNode({ operation: "dns" });
    const ctx = createMockContext();
    const result = await network_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have operation", () => {
    const node = createMockNode({ operation: "port_check" });
    const result = network_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("test: operation 없음 → 'operation is required' 경고 (L66)", () => {
    const node = createMockNode({ operation: undefined as any });
    const result = network_handler.test(node);
    expect(result.warnings).toContain("operation is required");
  });

  it("test: ping + host 없음 → 'host is required' 경고 (L67)", () => {
    const node = createMockNode({ operation: "ping", host: undefined as any });
    const result = network_handler.test(node);
    expect(result.warnings).toContain("host is required");
  });

  it("test: port_check + port 없음 → 'port is required' 경고 (L68)", () => {
    const node = createMockNode({ operation: "port_check", host: "example.com", port: undefined as any });
    const result = network_handler.test(node);
    expect(result.warnings).toContain("port is required");
  });

  it("execute: should handle port_check operation", async () => {
    const node = createMockNode({ operation: "port_check", port: 443 });
    const ctx = createMockContext();
    const result = await network_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ operation: "invalid" });
    const ctx = createMockContext();
    const result = await network_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
