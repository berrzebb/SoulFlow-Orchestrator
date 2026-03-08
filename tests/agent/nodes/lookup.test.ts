import { describe, it, expect } from "vitest";
import { lookup_handler } from "../../../src/agent/nodes/lookup.js";
import type { LookupNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("lookup_handler", () => {
  const createMockNode = (overrides?: Partial<LookupNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "lookup",
    table: "http_status",
    key: "200",
    reverse: false,
    list: false,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be lookup", () => {
    expect(lookup_handler.node_type).toBe("lookup");
  });

  it("metadata: output_schema should have result and success", () => {
    expect(lookup_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Lookup result" },
      { name: "success", type: "boolean", description: "Whether lookup succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = lookup_handler.create_default?.();
    expect(defaults).toEqual({ table: "http_status", key: "", reverse: false, list: false });
  });

  it("execute: should handle http_status lookup", async () => {
    const node = createMockNode({ table: "http_status", key: "200" });
    const ctx = createMockContext();
    const result = await lookup_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in key", async () => {
    const node = createMockNode({ table: "mime_type", key: "${code}" });
    const ctx = createMockContext({ code: "json" });
    const result = await lookup_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if key missing and list disabled", () => {
    const node = createMockNode({ list: false, key: undefined });
    const result = lookup_handler.test(node);
    expect(result.warnings).toContain("key is required (or enable list mode)");
  });

  it("test validation: should not warn if key missing but list enabled", () => {
    const node = createMockNode({ list: true, key: undefined });
    const result = lookup_handler.test(node);
    expect(result.warnings.length).toBe(0);
  });

  it("test: preview should contain table", () => {
    const node = createMockNode({ table: "country" });
    const result = lookup_handler.test(node);
    expect(result.preview).toEqual({ table: "country" });
  });

  it("execute: should handle list mode", async () => {
    const node = createMockNode({ list: true, key: "" });
    const ctx = createMockContext();
    const result = await lookup_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle reverse lookup", async () => {
    const node = createMockNode({ reverse: true, key: "OK" });
    const ctx = createMockContext();
    const result = await lookup_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
