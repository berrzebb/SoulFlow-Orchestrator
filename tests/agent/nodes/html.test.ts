import { describe, it, expect } from "vitest";
import { html_handler } from "../../../src/agent/nodes/html.js";
import type { HtmlNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("html_handler", () => {
  const createMockNode = (overrides?: Partial<HtmlNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "html",
    action: "extract_text",
    html: "<p>test</p>",
    selector: "p",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be html", () => {
    expect(html_handler.node_type).toBe("html");
  });

  it("metadata: output_schema should have result and success", () => {
    expect(html_handler.output_schema).toEqual([
      { name: "result", type: "unknown", description: "HTML operation result" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = html_handler.create_default?.();
    expect(defaults).toEqual({ action: "extract_text", html: "" });
  });

  it("execute: should handle extract_text action", async () => {
    const node = createMockNode({ action: "extract_text" });
    const ctx = createMockContext();
    const result = await html_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in html", async () => {
    const node = createMockNode({ action: "extract_text", html: "${content}" });
    const ctx = createMockContext({ content: "<div>test</div>" });
    const result = await html_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle extract_links action", async () => {
    const node = createMockNode({ action: "extract_links" });
    const ctx = createMockContext();
    const result = await html_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "sanitize" });
    const result = html_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle sanitize action", async () => {
    const node = createMockNode({ action: "sanitize" });
    const ctx = createMockContext();
    const result = await html_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ html: "" });
    const ctx = createMockContext();
    const result = await html_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
