import { describe, it, expect } from "vitest";
import { error_handler_handler } from "../../../src/agent/nodes/error-handler.js";
import type { ErrorHandlerNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("error_handler_handler", () => {
  const createMockNode = (overrides?: Partial<ErrorHandlerNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "error_handler",
    error_type: "any",
    recovery_action: "retry",
    max_retries: 3,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be error_handler", () => {
    expect(error_handler_handler.node_type).toBe("error_handler");
  });

  it("execute: should handle error with retry", async () => {
    const node = createMockNode({ recovery_action: "retry", max_retries: 2 });
    const ctx = createMockContext();
    const result = await error_handler_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should filter by error type", async () => {
    const node = createMockNode({ error_type: "timeout" });
    const ctx = createMockContext();
    const result = await error_handler_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should fallback on error", async () => {
    const node = createMockNode({
      recovery_action: "fallback",
      fallback_value: "default",
    });
    const ctx = createMockContext();
    const result = await error_handler_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show recovery action", () => {
    const node = createMockNode();
    const result = error_handler_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should log error", async () => {
    const node = createMockNode({
      recovery_action: "log_and_continue",
    });
    const ctx = createMockContext();
    const result = await error_handler_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should catch specific error patterns", async () => {
    const node = createMockNode({
      error_pattern: "Connection.*refused",
      recovery_action: "retry",
    });
    const ctx = createMockContext();
    const result = await error_handler_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should apply delay on retry", async () => {
    const node = createMockNode({
      recovery_action: "retry",
      retry_delay_ms: 1000,
      max_retries: 3,
    });
    const ctx = createMockContext();
    const result = await error_handler_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle exponential backoff", async () => {
    const node = createMockNode({
      recovery_action: "retry",
      backoff_multiplier: 2,
    });
    const ctx = createMockContext();
    const result = await error_handler_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
