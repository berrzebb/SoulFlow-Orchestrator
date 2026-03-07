import { describe, it, expect, vi } from "vitest";
import { McpToolAdapter, create_mcp_tool_adapters } from "@src/mcp/tool-adapter.js";
import type { McpClientManager } from "@src/mcp/client-manager.js";
import type { McpToolEntry } from "@src/mcp/types.js";

function make_entry(overrides: Partial<McpToolEntry> = {}): McpToolEntry {
  return {
    server_name: "test-server",
    name: "do_thing",
    description: "Does a thing",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    ...overrides,
  };
}

function make_mcp(tools: McpToolEntry[] = []): McpClientManager {
  return {
    list_all_tools: vi.fn(() => tools),
    call_tool: vi.fn(async () => ({
      is_error: false,
      content: [{ type: "text" as const, text: "result" }],
    })),
  } as unknown as McpClientManager;
}

describe("McpToolAdapter", () => {
  it("constructs name with mcp__ prefix", () => {
    const adapter = new McpToolAdapter(make_entry(), make_mcp());
    expect(adapter.name).toBe("mcp__test-server__do_thing");
  });

  it("extracts original_name", () => {
    const adapter = new McpToolAdapter(make_entry(), make_mcp());
    expect(adapter.original_name).toBe("do_thing");
  });

  it("uses entry description", () => {
    const adapter = new McpToolAdapter(make_entry({ description: "My tool" }), make_mcp());
    expect(adapter.description).toBe("My tool");
  });

  it("falls back description when empty", () => {
    const adapter = new McpToolAdapter(make_entry({ description: "" }), make_mcp());
    expect(adapter.description).toContain("MCP tool: do_thing");
  });

  it("normalizes schema with properties and required", () => {
    const adapter = new McpToolAdapter(make_entry(), make_mcp());
    expect(adapter.parameters.type).toBe("object");
    expect(adapter.parameters.properties).toBeDefined();
    expect(adapter.parameters.required).toEqual(["query"]);
  });

  it("normalizes schema without properties", () => {
    const adapter = new McpToolAdapter(
      make_entry({ input_schema: { type: "object" } }),
      make_mcp(),
    );
    expect(adapter.parameters.type).toBe("object");
    expect(adapter.parameters.properties).toBeUndefined();
  });

  it("category is external", () => {
    const adapter = new McpToolAdapter(make_entry(), make_mcp());
    expect(adapter.category).toBe("external");
  });

  it("execute calls mcp.call_tool with original name", async () => {
    const mcp = make_mcp();
    const adapter = new McpToolAdapter(make_entry(), mcp);
    const result = await adapter.execute({ query: "hello" });
    expect(result).toBe("result");
    expect(mcp.call_tool).toHaveBeenCalledWith("do_thing", { query: "hello" }, undefined, "test-server");
  });

  it("execute returns Error prefix on mcp error", async () => {
    const mcp = {
      list_all_tools: vi.fn(() => []),
      call_tool: vi.fn(async () => ({
        is_error: true,
        content: [{ type: "text" as const, text: "something failed" }],
      })),
    } as unknown as McpClientManager;
    const adapter = new McpToolAdapter(make_entry(), mcp);
    const result = await adapter.execute({});
    expect(result).toBe("Error: something failed");
  });

  it("execute handles image content type", async () => {
    const mcp = {
      list_all_tools: vi.fn(() => []),
      call_tool: vi.fn(async () => ({
        is_error: false,
        content: [{ type: "image" as const, mimeType: "image/png" }],
      })),
    } as unknown as McpClientManager;
    const adapter = new McpToolAdapter(make_entry(), mcp);
    const result = await adapter.execute({});
    expect(result).toBe("[image: image/png]");
  });

  it("execute returns (empty result) for empty content", async () => {
    const mcp = {
      list_all_tools: vi.fn(() => []),
      call_tool: vi.fn(async () => ({
        is_error: false,
        content: [{ type: "text" as const, text: "" }],
      })),
    } as unknown as McpClientManager;
    const adapter = new McpToolAdapter(make_entry(), mcp);
    const result = await adapter.execute({});
    expect(result).toBe("(empty result)");
  });

  it("validate_params always returns empty", () => {
    const adapter = new McpToolAdapter(make_entry(), make_mcp());
    expect(adapter.validate_params({ any: "thing" })).toEqual([]);
  });

  it("to_schema returns function schema", () => {
    const adapter = new McpToolAdapter(make_entry(), make_mcp());
    const schema = adapter.to_schema();
    expect(schema.type).toBe("function");
    expect(schema.function.name).toBe("mcp__test-server__do_thing");
  });
});

describe("create_mcp_tool_adapters", () => {
  it("creates adapters for all tools", () => {
    const entries = [make_entry({ name: "tool1" }), make_entry({ name: "tool2" })];
    const mcp = make_mcp(entries);
    const adapters = create_mcp_tool_adapters(mcp);
    expect(adapters).toHaveLength(2);
    expect(adapters[0].name).toBe("mcp__test-server__tool1");
    expect(adapters[1].name).toBe("mcp__test-server__tool2");
  });

  it("returns empty array for no tools", () => {
    const mcp = make_mcp([]);
    const adapters = create_mcp_tool_adapters(mcp);
    expect(adapters).toEqual([]);
  });
});
