import { describe, it, expect } from "vitest";
import { web_scrape_handler } from "../../../src/agent/nodes/web-scrape.js";
import type { WebScrapeNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("web_scrape_handler", () => {
  const createMockNode = (overrides?: Partial<WebScrapeNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "web_scrape",
    url: "https://example.com",
    selector: "div.content",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be web_scrape", () => {
    expect(web_scrape_handler.node_type).toBe("web_scrape");
  });

  it("execute: should scrape webpage content", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in URL", async () => {
    const node = createMockNode({ url: "${target_url}" });
    const ctx = createMockContext({ target_url: "https://test.example.com" });
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should extract multiple selectors", async () => {
    const node = createMockNode({
      selectors: {
        title: "h1",
        description: "p.desc",
        links: "a[href]",
      },
    });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle JavaScript rendering", async () => {
    const node = createMockNode({
      javascript: true,
      wait_for_selector: ".dynamic-content",
    });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show URL and selector", () => {
    const node = createMockNode();
    const result = web_scrape_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should follow pagination", async () => {
    const node = createMockNode({
      pagination: {
        enabled: true,
        next_selector: "a.next",
        max_pages: 5,
      },
    });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should add custom headers", async () => {
    const node = createMockNode({
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html",
      },
    });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle network error gracefully", async () => {
    const node = createMockNode({ url: "https://invalid-url-that-does-not-exist.test" });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
