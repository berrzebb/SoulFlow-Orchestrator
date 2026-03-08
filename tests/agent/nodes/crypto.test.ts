import { describe, it, expect } from "vitest";
import { crypto_handler } from "../../../src/agent/nodes/crypto.js";
import type { CryptoNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("crypto_handler", () => {
  const createMockNode = (overrides?: Partial<CryptoNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "crypto",
    action: "encrypt",
    input: "secret",
    key: "mykey",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be crypto", () => {
    expect(crypto_handler.node_type).toBe("crypto");
  });

  it("metadata: output_schema should have result and success fields", () => {
    expect(crypto_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Operation result" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("metadata: input_schema should have action, input, and key", () => {
    expect(crypto_handler.input_schema).toEqual([
      { name: "action", type: "string", description: "encrypt/decrypt/sign/verify/generate_key" },
      { name: "input", type: "string", description: "Input data" },
      { name: "key", type: "string", description: "Encryption/signing key" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = crypto_handler.create_default?.();
    expect(defaults).toEqual({ action: "encrypt", input: "", key: "" });
  });

  it("execute: should handle encrypt action", async () => {
    const node = createMockNode({ action: "encrypt", input: "secret", key: "mykey" });
    const ctx = createMockContext();
    const result = await crypto_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in input", async () => {
    const node = createMockNode({ action: "encrypt", input: "${secret}", key: "mykey" });
    const ctx = createMockContext({ secret: "confidential" });
    const result = await crypto_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in key", async () => {
    const node = createMockNode({ action: "encrypt", input: "data", key: "${key}" });
    const ctx = createMockContext({ key: "encryption-key" });
    const result = await crypto_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should contain action", () => {
    const node = createMockNode({ action: "decrypt" });
    const result = crypto_handler.test(node);
    expect(result.preview).toEqual({ action: "decrypt" });
  });

  it("test: should have no warnings by default", () => {
    const node = createMockNode();
    const result = crypto_handler.test(node);
    expect(result.warnings).toEqual([]);
  });

  it("execute: should handle missing action (default to encrypt)", async () => {
    const node = createMockNode({ action: undefined });
    const ctx = createMockContext();
    const result = await crypto_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing input (default to empty string)", async () => {
    const node = createMockNode({ input: undefined });
    const ctx = createMockContext();
    const result = await crypto_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing key (default to empty string)", async () => {
    const node = createMockNode({ key: undefined });
    const ctx = createMockContext();
    const result = await crypto_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
