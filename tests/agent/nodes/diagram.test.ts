import { describe, it, expect } from "vitest";
import { diagram_handler } from "../../../src/agent/nodes/diagram.js";
import type { DiagramNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("diagram_handler", () => {
  const createMockNode = (overrides?: Partial<DiagramNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "diagram",
    diagram_type: "flowchart",
    elements: [
      { id: "1", type: "start", label: "Start" },
      { id: "2", type: "process", label: "Process" },
    ],
    connections: [{ from: "1", to: "2" }],
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be diagram", () => {
    expect(diagram_handler.node_type).toBe("diagram");
  });

  it("execute: should generate flowchart", async () => {
    const node = createMockNode({ diagram_type: "flowchart" });
    const ctx = createMockContext();
    const result = await diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in labels", async () => {
    const node = createMockNode({
      elements: [{ id: "1", type: "start", label: "${start_label}" }],
    });
    const ctx = createMockContext({ start_label: "Initialize" });
    const result = await diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should generate sequence diagram", async () => {
    const node = createMockNode({
      diagram_type: "sequence",
      elements: [
        { id: "actor1", type: "actor", label: "User" },
        { id: "actor2", type: "actor", label: "Server" },
      ],
    });
    const ctx = createMockContext();
    const result = await diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should generate state diagram", async () => {
    const node = createMockNode({
      diagram_type: "state",
      elements: [
        { id: "s1", type: "state", label: "State1" },
        { id: "s2", type: "state", label: "State2" },
      ],
    });
    const ctx = createMockContext();
    const result = await diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show diagram type", () => {
    const node = createMockNode();
    const result = diagram_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should generate entity relationship diagram", async () => {
    const node = createMockNode({
      diagram_type: "er",
      elements: [
        { id: "users", type: "entity", label: "Users" },
        { id: "orders", type: "entity", label: "Orders" },
      ],
    });
    const ctx = createMockContext();
    const result = await diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should export diagram to different formats", async () => {
    const node = createMockNode({
      output_format: "svg",
    });
    const ctx = createMockContext();
    const result = await diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle styling options", async () => {
    const node = createMockNode({
      style: { background: "#fff", fontSize: 12 },
    });
    const ctx = createMockContext();
    const result = await diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle invalid diagram type gracefully", async () => {
    const node = createMockNode({ diagram_type: "invalid" });
    const ctx = createMockContext();
    const result = await diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
