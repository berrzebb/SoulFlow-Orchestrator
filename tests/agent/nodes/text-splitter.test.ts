import { describe, it, expect } from "vitest";
import { text_splitter_handler } from "../../../src/agent/nodes/text-splitter.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("text_splitter_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "text_splitter",
    text: "This is sample text to split into chunks for processing",
    chunk_size: 20,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be text_splitter", () => {
    expect(text_splitter_handler.node_type).toBe("text_splitter");
  });

  it("test: preview should be defined", () => {
    const node = createMockNode();
    const result = text_splitter_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should split text", async () => {
    const node = createMockNode({ input_field: "source_text" });
    const ctx = createMockContext({ source_text: "This is sample text to split into chunks for processing" });
    const result = await text_splitter_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(Array.isArray(result.output.chunks)).toBe(true);
    expect(result.output.chunk_count).toBeGreaterThan(0);
  });
});
