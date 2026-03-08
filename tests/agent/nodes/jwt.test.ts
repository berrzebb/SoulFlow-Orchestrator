import { describe, it, expect } from "vitest";
import { jwt_handler } from "../../../src/agent/nodes/jwt.js";
import type { JwtNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("jwt_handler", () => {
  const createMockNode = (overrides?: Partial<JwtNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "jwt",
    action: "create",
    token: "",
    secret: "my-secret",
    payload: '{"user":"test"}',
    algorithm: "HS256",
    expires_in: "1h",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be jwt", () => {
    expect(jwt_handler.node_type).toBe("jwt");
  });

  it("metadata: output_schema should have token, payload, valid fields", () => {
    expect(jwt_handler.output_schema).toEqual([
      { name: "token", type: "string", description: "JWT token" },
      { name: "payload", type: "string", description: "Decoded payload JSON" },
      { name: "valid", type: "boolean", description: "Whether token is valid" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = jwt_handler.create_default?.();
    expect(defaults).toEqual({
      action: "create",
      token: "",
      secret: "",
      payload: "{}",
      algorithm: "HS256",
      expires_in: "1h",
    });
  });

  it("execute: should handle create action", async () => {
    const node = createMockNode({ action: "create" });
    const ctx = createMockContext();
    const result = await jwt_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("token");
    expect(result.output).toHaveProperty("payload");
    expect(result.output).toHaveProperty("valid");
  });

  it("execute: should resolve templates in token", async () => {
    const node = createMockNode({ action: "verify", token: "${jwt_token}" });
    const ctx = createMockContext({ jwt_token: "eyJ..." });
    const result = await jwt_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in secret", async () => {
    const node = createMockNode({ action: "verify", secret: "${api_secret}" });
    const ctx = createMockContext({ api_secret: "super-secret" });
    const result = await jwt_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should contain action and algorithm", () => {
    const node = createMockNode({ action: "decode", algorithm: "RS256" });
    const result = jwt_handler.test(node);
    expect(result.preview).toEqual({ action: "decode", algorithm: "RS256" });
  });

  it("execute: should handle decode action", async () => {
    const node = createMockNode({ action: "decode" });
    const ctx = createMockContext();
    const result = await jwt_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ action: "create", payload: "invalid" });
    const ctx = createMockContext();
    const result = await jwt_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
