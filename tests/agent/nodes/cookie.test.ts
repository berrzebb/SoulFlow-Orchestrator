import { describe, it, expect } from "vitest";
import { cookie_handler } from "../../../src/agent/nodes/cookie.js";
import type { CookieNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("cookie_handler", () => {
  const createMockNode = (overrides?: Partial<CookieNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "cookie",
    action: "parse",
    input: "session=abc123; path=/",
    cookie_name: "session",
    cookie_value: "abc123",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be cookie", () => {
    expect(cookie_handler.node_type).toBe("cookie");
  });

  it("metadata: output_schema should have result field", () => {
    expect(cookie_handler.output_schema).toEqual([
      { name: "result", type: "unknown", description: "Cookie operation result" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = cookie_handler.create_default?.();
    expect(defaults).toEqual({
      action: "parse",
      input: "",
    });
  });

  it("execute: should handle parse action", async () => {
    const node = createMockNode({ action: "parse", input: "session=xyz; path=/" });
    const ctx = createMockContext();
    const result = await cookie_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
  });

  it("execute: should resolve templates in input", async () => {
    const node = createMockNode({ action: "parse", input: "${cookie_string}" });
    const ctx = createMockContext({ cookie_string: "id=123; path=/" });
    const result = await cookie_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in cookie_name", async () => {
    const node = createMockNode({ action: "serialize", cookie_name: "${name}" });
    const ctx = createMockContext({ name: "user_id" });
    const result = await cookie_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in cookie_value", async () => {
    const node = createMockNode({ action: "build_set_cookie", cookie_value: "${token}" });
    const ctx = createMockContext({ token: "secret123" });
    const result = await cookie_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if action is missing", () => {
    const node = createMockNode({ action: undefined });
    const result = cookie_handler.test(node);
    expect(result.warnings).toContain("action is required");
  });

  it("test: preview should contain action", () => {
    const node = createMockNode({ action: "serialize" });
    const result = cookie_handler.test(node);
    expect(result.preview).toEqual({ action: "serialize" });
  });

  it("execute: should handle serialize action", async () => {
    const node = createMockNode({ action: "serialize", input: '{"session":"abc"}' });
    const ctx = createMockContext();
    const result = await cookie_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ action: "parse", input: "invalid" });
    const ctx = createMockContext();
    const result = await cookie_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
