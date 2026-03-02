/**
 * MCP 도구 → ToolLike 어댑터.
 * McpClientManager가 발견한 도구를 ToolRegistry에 등록 가능한 형태로 변환.
 */

import type { ToolLike, ToolSchema, JsonSchema, ToolExecutionContext } from "../agent/tools/types.js";
import type { McpClientManager } from "./client-manager.js";
import type { McpToolEntry } from "./types.js";

export class McpToolAdapter implements ToolLike {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;

  private readonly mcp: McpClientManager;
  private readonly server_name: string;

  constructor(entry: McpToolEntry, mcp: McpClientManager) {
    this.name = `mcp__${entry.server_name}__${entry.name}`;
    this.description = entry.description || `MCP tool: ${entry.name} (server: ${entry.server_name})`;
    this.parameters = normalize_schema(entry.input_schema);
    this.mcp = mcp;
    this.server_name = entry.server_name;
  }

  /** MCP 서버의 원래 도구 이름. */
  get original_name(): string {
    return this.name.replace(`mcp__${this.server_name}__`, "");
  }

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const result = await this.mcp.call_tool(this.original_name, params, context?.signal);
    if (result.is_error) {
      const text = result.content.map((c) => c.text || "").filter(Boolean).join("\n");
      return `Error: ${text || "mcp_tool_error"}`;
    }
    return result.content
      .map((c) => {
        if (c.type === "text") return c.text || "";
        if (c.type === "image") return `[image: ${c.mimeType || "unknown"}]`;
        return `[${c.type}]`;
      })
      .join("\n")
      .trim() || "(empty result)";
  }

  validate_params(_params: Record<string, unknown>): string[] {
    return [];
  }

  to_schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}

/** McpClientManager의 모든 도구를 ToolLike[]로 변환. */
export function create_mcp_tool_adapters(mcp: McpClientManager): McpToolAdapter[] {
  return mcp.list_all_tools().map((entry) => new McpToolAdapter(entry, mcp));
}

function normalize_schema(raw: Record<string, unknown>): JsonSchema {
  const schema: JsonSchema = { type: "object" };
  if (raw.properties && typeof raw.properties === "object") {
    schema.properties = raw.properties as Record<string, JsonSchema>;
  }
  if (Array.isArray(raw.required)) {
    schema.required = raw.required as string[];
  }
  return schema;
}
