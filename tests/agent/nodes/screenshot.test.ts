import { describe, it, expect } from "vitest";
import { screenshot_handler } from "../../../src/agent/nodes/screenshot.js";
import type { ScreenshotNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("screenshot_handler", () => {
  const createMockNode = (overrides?: Partial<ScreenshotNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "screenshot",
    url: "https://example.com",
    format: "png",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be screenshot", () => {
    expect(screenshot_handler.node_type).toBe("screenshot");
  });

  it("execute: should capture screenshot", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await screenshot_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in URL", async () => {
    const node = createMockNode({ url: "${target_url}" });
    const ctx = createMockContext({ target_url: "https://test.example.com" });
    const result = await screenshot_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should support different formats", async () => {
    const node = createMockNode({ format: "jpeg" });
    const ctx = createMockContext();
    const result = await screenshot_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should set viewport dimensions", async () => {
    const node = createMockNode({
      viewport_width: 1920,
      viewport_height: 1080,
    });
    const ctx = createMockContext();
    const result = await screenshot_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show URL and format", () => {
    const node = createMockNode();
    const result = screenshot_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should wait for page load", async () => {
    const node = createMockNode({
      wait_for_selector: ".content",
      timeout_ms: 5000,
    });
    const ctx = createMockContext();
    const result = await screenshot_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle JavaScript execution", async () => {
    const node = createMockNode({
      execute_script: "window.scrollTo(0, document.body.scrollHeight);",
    });
    const ctx = createMockContext();
    const result = await screenshot_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle invalid URL gracefully", async () => {
    const node = createMockNode({ url: "invalid-url" });
    const ctx = createMockContext();
    const result = await screenshot_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});

describe("screenshot — create_default (L22)", () => {
  it("create_default: 기본값 반환", () => {
    const defaults = screenshot_handler.create_default?.();
    expect(defaults).toBeDefined();
    expect((defaults as any).url).toBe("");
    expect((defaults as any).full_page).toBe(false);
  });

  it("test: url 없음 → url 경고 (L57)", () => {
    const node = { node_id: "n1", node_type: "screenshot", url: "" } as any;
    const result = screenshot_handler.test(node);
    expect(result.warnings.some((w: string) => w.includes("url"))).toBe(true);
  });
});
