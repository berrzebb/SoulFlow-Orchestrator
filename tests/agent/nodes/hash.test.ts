import { describe, it, expect } from "vitest";
import { hash_handler } from "../../../src/agent/nodes/hash.js";
import type { HashNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("hash_handler", () => {
  const createMockNode = (overrides?: Partial<HashNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "hash",
    action: "hash",
    input: "test",
    algorithm: "sha256",
    key: "",
    encoding: "hex",
    expected: "",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be hash", () => {
    expect(hash_handler.node_type).toBe("hash");
  });

  it("metadata: output_schema should have digest and success fields", () => {
    expect(hash_handler.output_schema).toEqual([
      { name: "digest", type: "string", description: "Hash digest" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("metadata: input_schema should have action, input, and algorithm", () => {
    expect(hash_handler.input_schema).toEqual([
      { name: "action", type: "string", description: "hash/hmac/verify" },
      { name: "input", type: "string", description: "Input string" },
      { name: "algorithm", type: "string", description: "md5/sha256/sha512" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = hash_handler.create_default?.();
    expect(defaults).toEqual({
      action: "hash",
      input: "",
      algorithm: "sha256",
      key: "",
      encoding: "hex",
      expected: "",
    });
  });

  it("execute: should handle hash action", async () => {
    const node = createMockNode({ action: "hash", input: "test", algorithm: "sha256" });
    const ctx = createMockContext();
    const result = await hash_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("digest");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in input", async () => {
    const node = createMockNode({ action: "hash", input: "${val}", algorithm: "sha256" });
    const ctx = createMockContext({ val: "secret" });
    const result = await hash_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output.success).toBe(true);
  });

  it("execute: should handle missing input (default to empty string)", async () => {
    const node = createMockNode({ action: "hash", input: undefined, algorithm: "sha256" });
    const ctx = createMockContext();
    const result = await hash_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing algorithm (default to sha256)", async () => {
    const node = createMockNode({ action: "hash", input: "test", algorithm: undefined });
    const ctx = createMockContext();
    const result = await hash_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing action (default to hash)", async () => {
    const node = createMockNode({ action: undefined, input: "test", algorithm: "sha256" });
    const ctx = createMockContext();
    const result = await hash_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should contain action and algorithm", () => {
    const node = createMockNode({ action: "hash", algorithm: "sha256" });
    const result = hash_handler.test(node);
    expect(result.preview).toEqual({ action: "hash", algorithm: "sha256" });
  });

  it("test: should have no warnings by default", () => {
    const node = createMockNode();
    const result = hash_handler.test(node);
    expect(result.warnings).toEqual([]);
  });
});
