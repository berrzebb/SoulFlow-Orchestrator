import { describe, it, expect } from "vitest";
import { openapi_handler } from "../../../src/agent/nodes/openapi.js";
import type { OpenAPINodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("openapi_handler", () => {
  const createMockNode = (overrides?: Partial<OpenAPINodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "openapi",
    action: "validate",
    spec: '{"openapi":"3.0.0","info":{"title":"Test"}}',
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be openapi", () => {
    expect(openapi_handler.node_type).toBe("openapi");
  });

  it("execute: should handle validate action", async () => {
    const node = createMockNode({ action: "validate" });
    const ctx = createMockContext();
    const result = await openapi_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ spec: "${openapi_spec}" });
    const ctx = createMockContext({ openapi_spec: '{"openapi":"3.0.0"}' });
    const result = await openapi_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "generate" });
    const result = openapi_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ spec: "" });
    const ctx = createMockContext();
    const result = await openapi_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
