import { describe, it, expect, vi } from "vitest";
import { execute_chain, type ChainStep } from "@src/agent/tools/chain.js";
import { ToolRegistry } from "@src/agent/tools/registry.js";
import type { ToolLike, ToolSchema, JsonSchema, ToolExecutionContext } from "@src/agent/tools/types.js";

function make_tool(name: string, handler: (params: Record<string, unknown>) => string): ToolLike {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: { type: "object" } as JsonSchema,
    execute: async (params: Record<string, unknown>) => handler(params),
    validate_params: () => [],
    to_schema: () => ({
      type: "function",
      function: { name, description: `Test tool: ${name}`, parameters: { type: "object" } },
    }) as ToolSchema,
  };
}

describe("execute_chain", () => {
  it("executes single step successfully", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("echo", (p) => String(p.text || "")));

    const result = await execute_chain(registry, [
      { tool: "echo", params: { text: "hello" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.final_output).toBe("hello");
  });

  it("chains two steps with $prev substitution", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("greet", () => "Hello World"));
    registry.register(make_tool("upper", (p) => String(p.input || "").toUpperCase()));

    const result = await execute_chain(registry, [
      { tool: "greet", params: {} },
      { tool: "upper", params: { input: "$prev" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("HELLO WORLD");
  });

  it("supports $steps[N] reference", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("a", () => "AAA"));
    registry.register(make_tool("b", () => "BBB"));
    registry.register(make_tool("join", (p) => `${p.first}-${p.second}`));

    const result = await execute_chain(registry, [
      { tool: "a", params: {} },
      { tool: "b", params: {} },
      { tool: "join", params: { first: "$steps[0]", second: "$steps[1]" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("AAA-BBB");
  });

  it("supports $prev.json.key for JSON path access", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("json_source", () => JSON.stringify({ url: "https://example.com", title: "Example" })));
    registry.register(make_tool("fetch", (p) => `Fetched: ${p.url}`));

    const result = await execute_chain(registry, [
      { tool: "json_source", params: {} },
      { tool: "fetch", params: { url: "$prev.json.url" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("Fetched: https://example.com");
  });

  it("supports nested JSON path", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("source", () => JSON.stringify({ data: { items: [1, 2, 3] } })));
    registry.register(make_tool("use", (p) => `Got: ${p.val}`));

    const result = await execute_chain(registry, [
      { tool: "source", params: {} },
      { tool: "use", params: { val: "$prev.json.data.items" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("Got: [1,2,3]");
  });

  it("aborts on error by default", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("fail", () => "Error: something went wrong"));
    registry.register(make_tool("never_reached", () => "should not run"));

    const result = await execute_chain(registry, [
      { tool: "fail", params: {} },
      { tool: "never_reached", params: {} },
    ]);

    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].error).toBe(true);
  });

  it("continues on error when abort_on_error is false", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("fail", () => "Error: minor issue"));
    registry.register(make_tool("recover", () => "recovered"));

    const result = await execute_chain(registry, [
      { tool: "fail", params: {}, abort_on_error: false },
      { tool: "recover", params: {} },
    ]);

    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].error).toBe(true);
    expect(result.final_output).toBe("recovered");
  });

  it("handles unknown tool gracefully", async () => {
    const registry = new ToolRegistry();

    const result = await execute_chain(registry, [
      { tool: "nonexistent", params: {} },
    ]);

    expect(result.ok).toBe(false);
    expect(result.steps[0].error).toBe(true);
  });

  it("resolves template in nested objects and arrays", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("source", () => "VALUE"));
    registry.register(make_tool("use", (p) => JSON.stringify(p)));

    const result = await execute_chain(registry, [
      { tool: "source", params: {} },
      { tool: "use", params: { nested: { key: "$prev" }, list: ["$prev", "static"] } },
    ]);

    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.final_output);
    expect(parsed.nested.key).toBe("VALUE");
    expect(parsed.list).toEqual(["VALUE", "static"]);
  });

  it("handles empty steps array", async () => {
    const registry = new ToolRegistry();
    const result = await execute_chain(registry, []);
    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("");
  });

  it("$prev returns empty string when no previous output exists", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("check", (p) => `got:[${p.input}]`));

    // First step uses $prev but there is no previous output
    const result = await execute_chain(registry, [
      { tool: "check", params: { input: "$prev" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("got:[]");
  });
});
