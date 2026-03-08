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

  it("metadata: output_schema should have state and result fields", () => {
    expect(circuit_breaker_handler.output_schema).toEqual([
      { name: "state", type: "string", description: "Circuit state: closed / open / half_open" },
      { name: "result", type: "unknown", description: "Full result" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = circuit_breaker_handler.create_default?.();
    expect(defaults).toEqual({
      action: "get_state",
      name: "",
    });
  });

  it("execute: should handle get_state action", async () => {
    const node = createMockNode({ action: "get_state", name: "breaker1" });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("state");
    expect(result.output).toHaveProperty("result");
  });

  it("execute: should resolve templates in name", async () => {
    const node = createMockNode({ action: "get_state", name: "${breaker_name}" });
    const ctx = createMockContext({ breaker_name: "db-service" });
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if name is missing", () => {
    const node = createMockNode({ name: undefined });
    const result = circuit_breaker_handler.test(node);
    expect(result.warnings).toContain("name is required");
  });

  it("test validation: should warn if name is empty", () => {
    const node = createMockNode({ name: "" });
    const result = circuit_breaker_handler.test(node);
    expect(result.warnings).toContain("name is required");
  });

  it("test: preview should contain action and name", () => {
    const node = createMockNode({ action: "reset", name: "api-breaker" });
    const result = circuit_breaker_handler.test(node);
    expect(result.preview).toEqual({ action: "reset", name: "api-breaker" });
  });

  it("execute: should handle create action", async () => {
    const node = createMockNode({ action: "create", name: "new-breaker" });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle record_success action", async () => {
    const node = createMockNode({ action: "record_success", name: "breaker1" });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ action: "get_state", name: "" });
    const ctx = createMockContext();
    const result = await circuit_breaker_handler.execute(node, ctx);
    expect(result.output.state).toBe("not_found");
  });
});
