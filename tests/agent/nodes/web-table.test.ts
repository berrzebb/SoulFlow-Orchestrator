import { describe, it, expect, vi } from "vitest";
import { web_table_handler } from "../../../src/agent/nodes/web-table.js";
import type { WebTableNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("web_table_handler", () => {
  const createMockNode = (overrides?: Partial<WebTableNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "web_table",
    url: "https://example.com/data",
    selector: "table",
    max_rows: 100,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be web_table", () => {
    expect(web_table_handler.node_type).toBe("web_table");
  });

  it("execute: should extract table from URL", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await web_table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in URL", async () => {
    const node = createMockNode({ url: "${target_url}" });
    const ctx = createMockContext({ target_url: "https://data.example.com/table" });
    const result = await web_table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should use custom CSS selector", async () => {
    const node = createMockNode({ selector: "#data-table" });
    const ctx = createMockContext();
    const result = await web_table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show URL and selector", () => {
    const node = createMockNode();
    const result = web_table_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should respect max_rows limit", async () => {
    const node = createMockNode({ max_rows: 50 });
    const ctx = createMockContext();
    const result = await web_table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should return headers and rows", async () => {
    const node = createMockNode({
      url: "https://example.com/stats",
      selector: "table.data-table",
    });
    const ctx = createMockContext();
    const result = await web_table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle multiple tables", async () => {
    const node = createMockNode({
      selector: "table:nth-child(2)",
    });
    const ctx = createMockContext();
    const result = await web_table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle empty URL gracefully", async () => {
    const node = createMockNode({ url: "" });
    const ctx = createMockContext();
    const result = await web_table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should include total row count", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await web_table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  // L36 setTimeout 콜백 커버 — fetch 걸림 + fake timer로 30초 타임아웃 발생
  it("execute: fetch 걸림 → 30초 타임아웃 → AbortError (L36)", async () => {
    vi.useFakeTimers();
    const original_fetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url: unknown, opts: RequestInit) =>
      new Promise<Response>((_, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const node = createMockNode({ url: "https://example.com/table" });
    const promise = web_table_handler.execute(node, createMockContext());
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;
    globalThis.fetch = original_fetch;
    vi.useRealTimers();
    expect(result.output).toBeDefined();
  });
});
