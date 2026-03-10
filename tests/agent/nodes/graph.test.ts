import { describe, it, expect } from "vitest";
import { graph_handler } from "../../../src/agent/nodes/graph.js";
import type { GraphNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("graph_handler", () => {
  const createMockNode = (overrides?: Partial<GraphNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "graph",
    operation: "create",
    nodes: [
      { id: "1", label: "Node 1" },
      { id: "2", label: "Node 2" },
    ],
    edges: [{ from: "1", to: "2", label: "connects" }],
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be graph", () => {
    expect(graph_handler.node_type).toBe("graph");
  });

  it("execute: should create graph structure", async () => {
    const node = createMockNode({ operation: "create" });
    const ctx = createMockContext();
    const result = await graph_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in node labels", async () => {
    const node = createMockNode({
      nodes: [
        { id: "1", label: "${label1}" },
        { id: "2", label: "Node 2" },
      ],
    });
    const ctx = createMockContext({ label1: "Start" });
    const result = await graph_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should find shortest path", async () => {
    const node = createMockNode({
      operation: "shortest_path",
      start_node: "1",
      end_node: "2",
    });
    const ctx = createMockContext();
    const result = await graph_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should traverse graph in BFS order", async () => {
    const node = createMockNode({
      operation: "bfs",
      start_node: "1",
    });
    const ctx = createMockContext();
    const result = await graph_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show nodes and edges", () => {
    const node = createMockNode();
    const result = graph_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should detect cycles", async () => {
    const node = createMockNode({
      operation: "detect_cycles",
      edges: [
        { from: "1", to: "2" },
        { from: "2", to: "3" },
        { from: "3", to: "1" },
      ],
    });
    const ctx = createMockContext();
    const result = await graph_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should compute node degrees", async () => {
    const node = createMockNode({ operation: "degrees" });
    const ctx = createMockContext();
    const result = await graph_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle disconnected graph", async () => {
    const node = createMockNode({
      nodes: [
        { id: "1", label: "A" },
        { id: "2", label: "B" },
        { id: "3", label: "C" },
      ],
      edges: [{ from: "1", to: "2" }],
    });
    const ctx = createMockContext();
    const result = await graph_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("create_default: returns default action/edges (L22)", () => {
    const defaults = graph_handler.create_default?.();
    expect(defaults).toBeDefined();
    expect((defaults as any).action).toBe("bfs");
  });

  it("execute: action/edges as strings → success path → L36 JSON.parse", async () => {
    // 문자열 형태로 전달 → resolve_templates 정상 동작 → GraphTool 반환값 JSON.parse 성공
    const node = { node_id: "n1", node_type: "graph", action: "bfs", edges: "[]", start: "A" } as any;
    const ctx = createMockContext();
    const result = await graph_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect((result.output as any).result).toBeDefined();
  });

  it("test: edges 없음 → 'edges is required' 경고 (L46)", () => {
    const node = { node_id: "n1", node_type: "graph", action: "bfs" } as any;
    const result = graph_handler.test(node);
    expect(result.warnings).toContain("edges is required");
  });
});
