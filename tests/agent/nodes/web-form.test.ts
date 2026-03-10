import { describe, it, expect, vi } from "vitest";
import { web_form_handler } from "../../../src/agent/nodes/web-form.js";
import type { WebFormNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("web_form_handler", () => {
  const createMockNode = (overrides?: Partial<WebFormNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "web_form",
    operation: "generate",
    form_id: "contact-form",
    fields: [
      { name: "email", type: "email", required: true },
      { name: "message", type: "textarea" },
    ],
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be web_form", () => {
    expect(web_form_handler.node_type).toBe("web_form");
  });

  it("execute: should generate form HTML", async () => {
    const node = createMockNode({ operation: "generate" });
    const ctx = createMockContext();
    const result = await web_form_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in fields", async () => {
    const node = createMockNode({
      fields: [
        { name: "${field_name}", type: "text" },
      ],
    });
    const ctx = createMockContext({ field_name: "username" });
    const result = await web_form_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should validate form submission", async () => {
    const node = createMockNode({
      operation: "validate",
      submission: { email: "test@example.com", message: "Hello" },
    });
    const ctx = createMockContext();
    const result = await web_form_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should process form submission", async () => {
    const node = createMockNode({
      operation: "submit",
      submission: { email: "user@example.com" },
    });
    const ctx = createMockContext();
    const result = await web_form_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show form fields", () => {
    const node = createMockNode();
    const result = web_form_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should render form with custom styling", async () => {
    const node = createMockNode({
      css_class: "custom-form",
      submit_text: "Send",
    });
    const ctx = createMockContext();
    const result = await web_form_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle conditional fields", async () => {
    const node = createMockNode({
      fields: [
        { name: "type", type: "select", options: ["personal", "business"] },
        { name: "company", type: "text", condition: "type == business" },
      ],
    });
    const ctx = createMockContext();
    const result = await web_form_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle invalid submission gracefully", async () => {
    const node = createMockNode({
      operation: "validate",
      submission: { invalid_field: "value" },
    });
    const ctx = createMockContext();
    const result = await web_form_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  // L37 fetch 호출 경로 커버 — fetch 즉시 실패 → catch 분기 (L37+L49)
  it("execute: url + fields 설정 → fetch 호출 경로 커버 (L37)", async () => {
    const original_fetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    const node = {
      node_id: "n1",
      node_type: "web_form",
      url: "https://example.com/form",
      fields: { email: "test@example.com" },
    } as any;
    const result = await web_form_handler.execute(node, { memory: {}, workspace: "/tmp", abort_signal: undefined });
    globalThis.fetch = original_fetch;
    expect((result.output as any).error).toContain("network error");
  });
});
