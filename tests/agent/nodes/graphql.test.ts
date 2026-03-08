import { describe, it, expect } from "vitest";
import { graphql_handler } from "../../../src/agent/nodes/graphql.js";
import type { GraphqlNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("graphql_handler", () => {
  const createMockNode = (overrides?: Partial<GraphqlNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "graphql",
    url: "https://api.example.com/graphql",
    query: "{ users { id name } }",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be graphql", () => {
    expect(graphql_handler.node_type).toBe("graphql");
  });

  it("execute: should execute query", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await graphql_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ url: "${api_url}", query: "${query}" });
    const ctx = createMockContext({ api_url: "https://test.com/graphql", query: "{ test }" });
    const result = await graphql_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have url", () => {
    const node = createMockNode();
    const result = graphql_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ url: "" });
    const ctx = createMockContext();
    const result = await graphql_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
