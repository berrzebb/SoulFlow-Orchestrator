import { describe, it, expect } from "vitest";
import { qr_handler } from "../../../src/agent/nodes/qr.js";
import { QrTool } from "@src/agent/tools/qr.js";
import type { QrNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("qr_handler", () => {
  const createMockNode = (overrides?: Partial<QrNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "qr",
    action: "generate",
    data: "https://example.com",
    format: "svg",
    size: 10,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be qr", () => {
    expect(qr_handler.node_type).toBe("qr");
  });

  it("metadata: output_schema should have result and success fields", () => {
    expect(qr_handler.output_schema).toEqual([
      { name: "result", type: "unknown", description: "QR code output (SVG or text)" },
      { name: "success", type: "boolean", description: "Whether generation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = qr_handler.create_default?.();
    expect(defaults).toEqual({ action: "generate", data: "", format: "svg" });
  });

  it("execute: should handle generate action", async () => {
    const node = createMockNode({ data: "test data" });
    const ctx = createMockContext();
    const result = await qr_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in data", async () => {
    const node = createMockNode({ data: "${url}" });
    const ctx = createMockContext({ url: "https://test.com" });
    const result = await qr_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if data is missing", () => {
    const node = createMockNode({ data: undefined });
    const result = qr_handler.test(node);
    expect(result.warnings).toContain("data is required");
  });

  it("test: preview should contain truncated data and format", () => {
    const node = createMockNode({ data: "123456789012345678901234567890extra", format: "text" });
    const result = qr_handler.test(node);
    expect(result.preview.data?.length).toBeLessThanOrEqual(30);
    expect(result.preview.format).toBe("text");
  });

  it("execute: should handle text format", async () => {
    const node = createMockNode({ data: "text data", format: "text" });
    const ctx = createMockContext();
    const result = await qr_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ data: "" });
    const ctx = createMockContext();
    const result = await qr_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});

// ── QrTool — data too long / version >= 2 ─────────────────────────────────────

const tool = new QrTool();

describe("QrTool — data too long", () => {
  it("data > 60 bytes → Error 반환", async () => {
    const result = await tool.execute({ action: "generate", data: "A".repeat(61) });
    expect(result).toContain("too long");
  });
});

describe("QrTool — version >= 2 (18-60 bytes)", () => {
  it("18바이트 → version 2, alignment pattern 실행, SVG 반환", async () => {
    const result = await tool.execute({ action: "generate", data: "A".repeat(18) });
    expect(result).toContain("svg");
  });

  it("33바이트 → version 3, pad bytes 실행, text 반환", async () => {
    const result = await tool.execute({ action: "text", data: "A".repeat(33) });
    expect(result).toContain("text");
  });

  it("50바이트 → version 4, SVG 반환", async () => {
    const result = await tool.execute({ action: "generate", data: "A".repeat(50) });
    expect(result).toContain("svg");
  });
});
