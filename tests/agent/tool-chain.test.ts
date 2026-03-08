import { describe, it, expect, vi } from "vitest";
import { execute_chain, ChainTool, type ChainStep } from "@src/agent/tools/chain.js";
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

  it("passes through primitive values (number, boolean) without template substitution", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("sum", (p) => String(Number(p.n || 0) + 1)));

    // number and boolean params should pass through as-is
    const result = await execute_chain(registry, [
      { tool: "sum", params: { n: 41, flag: true } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("42");
  });

  it("supports $steps[N].json.key path access", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("produce", () => JSON.stringify({ city: "Seoul" })));
    registry.register(make_tool("noop", () => "noop"));
    registry.register(make_tool("consume", (p) => `city=${p.loc}`));

    const result = await execute_chain(registry, [
      { tool: "produce", params: {} },
      { tool: "noop", params: {} },
      { tool: "consume", params: { loc: "$steps[0].json.city" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("city=Seoul");
  });

  it("returns empty string for $steps[N].json.key when JSON is invalid", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("bad_json", () => "not-json"));
    registry.register(make_tool("check", (p) => `val=${p.v}`));

    const result = await execute_chain(registry, [
      { tool: "bad_json", params: {} },
      { tool: "check", params: { v: "$prev.json.key" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("val=");
  });

  it("returns empty string for $steps[N].json.key when intermediate path is null", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("src", () => JSON.stringify({ a: null })));
    registry.register(make_tool("use", (p) => `v=${p.x}`));

    const result = await execute_chain(registry, [
      { tool: "src", params: {} },
      { tool: "use", params: { x: "$prev.json.a.nested" } },
    ]);

    expect(result.ok).toBe(true);
    // null intermediate path → extract_json_path returns ""
    expect(result.final_output).toBe("v=");
  });

  it("$steps[N] out of bounds returns empty string", async () => {
    const registry = new ToolRegistry();
    registry.register(make_tool("a", () => "AAA"));
    registry.register(make_tool("use", (p) => `got=${p.x}`));

    const result = await execute_chain(registry, [
      { tool: "a", params: {} },
      { tool: "use", params: { x: "$steps[99]" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.final_output).toBe("got=");
  });
});

describe("ChainTool", () => {
  function make_registry_with_tools(...names: string[]): ToolRegistry {
    const reg = new ToolRegistry();
    for (const name of names) {
      reg.register(make_tool(name, (p) => `${name}:${JSON.stringify(p)}`));
    }
    return reg;
  }

  it("execute returns error for empty steps array", async () => {
    const reg = new ToolRegistry();
    const tool = new ChainTool(reg);
    const result = await tool.execute({ steps: [] });
    expect(result).toContain("Error");
    expect(result).toContain("at least one step");
  });

  it("execute returns error when steps is not an array", async () => {
    const reg = new ToolRegistry();
    const tool = new ChainTool(reg);
    const result = await tool.execute({ steps: "not-an-array" });
    expect(result).toContain("Error");
  });

  it("execute returns error when steps exceed 20", async () => {
    const reg = make_registry_with_tools("echo");
    const tool = new ChainTool(reg);
    const steps = Array.from({ length: 21 }, () => ({ tool: "echo", params: {} }));
    const result = await tool.execute({ steps });
    expect(result).toContain("Error");
    expect(result).toContain("maximum 20");
  });

  it("execute returns error for recursive chain call", async () => {
    const reg = new ToolRegistry();
    const tool = new ChainTool(reg);
    const result = await tool.execute({ steps: [{ tool: "chain", params: {} }] });
    expect(result).toContain("Error");
    expect(result).toContain("recursive");
  });

  it("execute runs steps and returns formatted output", async () => {
    const reg = make_registry_with_tools("alpha", "beta");
    const tool = new ChainTool(reg);
    const result = await tool.execute({
      steps: [
        { tool: "alpha", params: { x: 1 } },
        { tool: "beta", params: { y: 2 } },
      ],
    });
    expect(result).toContain("step 0: alpha [OK]");
    expect(result).toContain("step 1: beta [OK]");
  });

  it("execute shows ERROR status for failed steps and adds abort message", async () => {
    const reg = new ToolRegistry();
    reg.register(make_tool("fail", () => "Error: deliberate failure"));
    const tool = new ChainTool(reg);
    const result = await tool.execute({
      steps: [{ tool: "fail", params: {} }],
    });
    expect(result).toContain("[ERROR]");
    expect(result).toContain("Chain aborted");
  });

  it("execute handles step.params missing (uses empty object)", async () => {
    const reg = make_registry_with_tools("noop");
    const tool = new ChainTool(reg);
    const result = await tool.execute({
      steps: [{ tool: "noop" }],
    });
    expect(result).toContain("step 0: noop [OK]");
  });

  it("validate_params returns error when steps is not array", () => {
    const reg = new ToolRegistry();
    const tool = new ChainTool(reg);
    const errors = tool.validate_params({ steps: "bad" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("steps");
  });

  it("validate_params returns empty array for valid params", () => {
    const reg = new ToolRegistry();
    const tool = new ChainTool(reg);
    const errors = tool.validate_params({ steps: [] });
    expect(errors).toHaveLength(0);
  });

  it("to_schema returns correct schema structure", () => {
    const reg = new ToolRegistry();
    const tool = new ChainTool(reg);
    const schema = tool.to_schema();
    expect(schema.type).toBe("function");
    expect(schema.function.name).toBe("chain");
  });

  it("has correct name and category", () => {
    const reg = new ToolRegistry();
    const tool = new ChainTool(reg);
    expect(tool.name).toBe("chain");
    expect(tool.category).toBe("admin");
  });
});
