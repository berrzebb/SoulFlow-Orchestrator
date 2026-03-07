/** Dashboard tool ops. */

import type { DashboardToolOps } from "../service.js";
import type { McpClientManager } from "../../mcp/index.js";

export function create_tool_ops(deps: {
  tool_names: () => string[];
  get_definitions: () => Array<Record<string, unknown>>;
  mcp: McpClientManager;
}): DashboardToolOps {
  return {
    tool_names: deps.tool_names,
    get_definitions: deps.get_definitions,
    list_mcp_servers: () => deps.mcp.list_servers().map((s) => ({
      name: s.name, connected: s.connected,
      tools: s.tools.map((t) => t.name), error: s.error,
    })),
  };
}
