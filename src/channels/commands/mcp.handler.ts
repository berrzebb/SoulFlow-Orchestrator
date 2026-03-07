import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide, format_subcommand_usage } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["mcp", "mcp-server", "mcp\uC11C\uBC84"] as const;

type McpServerInfo = {
  name: string;
  connected: boolean;
  tool_count: number;
  error?: string;
};

export interface McpAccess {
  list_servers(): McpServerInfo[];
  reconnect(name: string): Promise<boolean>;
}

export class McpHandler implements CommandHandler {
  readonly name = "mcp";

  constructor(private readonly access: McpAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const args = ctx.command?.args || [];
    const action = (args[0] || "").toLowerCase();

    if (action === "reconnect" || action === "\uC7AC\uC5F0\uACB0") {
      const name = args[1] || "";
      if (!name) {
        await ctx.send_reply(`${mention}${format_subcommand_usage("mcp", "reconnect")}`);
        return true;
      }
      const ok = await this.access.reconnect(name);
      await ctx.send_reply(`${mention}${ok ? `\u2705 ${name} \uC7AC\uC5F0\uACB0 \uC644\uB8CC` : `\u274C ${name} \uC7AC\uC5F0\uACB0 \uC2E4\uD328 (\uC11C\uBC84\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC74C)`}`);
      return true;
    }

    if (!action) {
      const guide = format_subcommand_guide("mcp");
      if (guide) { await ctx.send_reply(`${mention}${guide}`); return true; }
    }
    const servers = this.access.list_servers();
    if (!servers.length) {
      await ctx.send_reply(`${mention}\uB4F1\uB85D\uB41C MCP \uC11C\uBC84\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.`);
      return true;
    }
    const lines = servers.map((s) => {
      const icon = s.connected ? "\u{1F7E2}" : "\u{1F534}";
      const err = s.error ? ` \u2014 ${s.error}` : "";
      return `${icon} \`${s.name}\` (tools: ${s.tool_count})${err}`;
    });
    const connected = servers.filter((s) => s.connected).length;
    await ctx.send_reply(`${mention}${[`MCP \uC11C\uBC84 ${servers.length}\uAC1C (\uC5F0\uACB0 ${connected}\uAC1C)`, "", ...lines].join("\n")}`);
    return true;
  }
}
