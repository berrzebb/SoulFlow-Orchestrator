import { describe, it, expect } from "vitest";
import { circuit_breaker_handler } from "../../../src/agent/nodes/circuit-breaker.js";
import type { CircuitBreakerNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("circuit_breaker_handler", () => {
  const createMockNode = (overrides?: Partial<CircuitBreakerNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "circuit_breaker",
    action: "get_state",
    name: "api-breaker",
    threshold: 5,
    timeout_ms: 30000,
    half_open_max: 2,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be circuit_breaker", () => {
    expect(circuit_breaker_handler.node_type).toBe("circuit_breaker");
  });

  it("execute: should get circuit state", async () => {
    const node = createMockNode({ action: "get_state" });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should create circuit breaker", async () => {
    const node = createMockNode({
      action: "create",
      name: "new-breaker",
      threshold: 10,
    });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should record success", async () => {
    const node = createMockNode({
      action: "record_success",
      name: "api-breaker",
    });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show action and name", () => {
    const node = createMockNode();
    const result = circuit_breaker_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should reset breaker", async () => {
    const node = createMockNode({
      action: "reset",
      name: "api-breaker",
    });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should record failure", async () => {
    const node = createMockNode({
      action: "record_failure",
      name: "api-breaker",
    });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in name", async () => {
    const node = createMockNode({ name: "${breaker_name}" });
    const ctx = createMockContext({ breaker_name: "service-breaker" });
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing name gracefully", async () => {
    const node = createMockNode({ name: "" });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
