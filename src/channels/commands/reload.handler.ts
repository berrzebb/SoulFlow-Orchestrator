import { error_message } from "../../utils/common.js";
import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide } from "./registry.js";
import type { CommandContext, CommandHandler } from "./types.js";
import type { Logger } from "../../logger.js";

const ALIASES = ["reload", "리로드", "새로고침"] as const;

export type ReloadTarget = {
  reload_config: () => Promise<void>;
  reload_tools: () => Promise<number>;
  reload_skills: () => Promise<number>;
};

export class ReloadHandler implements CommandHandler {
  readonly name = "reload";
  private readonly logger: Logger | null;

  constructor(private readonly target: ReloadTarget, logger?: Logger | null) {
    this.logger = logger ?? null;
  }

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    if (!ctx.command?.args?.length) {
      const guide = format_subcommand_guide("reload");
      if (guide) { await ctx.send_reply(guide); return true; }
    }
    const results: Record<string, { ok: boolean; count?: number; error?: string }> = {};
    const lines: string[] = [];
    try {
      await this.target.reload_config();
      lines.push("config: reloaded");
      results.config = { ok: true };
    } catch (error) {
      lines.push(`config: failed (${error_message(error)})`);
      results.config = { ok: false, error: error_message(error) };
    }
    try {
      const tools = await this.target.reload_tools();
      lines.push(`tools: ${tools} reloaded`);
      results.tools = { ok: true, count: tools };
    } catch (error) {
      lines.push(`tools: failed (${error_message(error)})`);
      results.tools = { ok: false, error: error_message(error) };
    }
    try {
      const skills = await this.target.reload_skills();
      lines.push(`skills: ${skills} reloaded`);
      results.skills = { ok: true, count: skills };
    } catch (error) {
      lines.push(`skills: failed (${error_message(error)})`);
      results.skills = { ok: false, error: error_message(error) };
    }
    this.logger?.info("config_reload", results);
    await ctx.send_reply(`🔄 reload\n${lines.join("\n")}`);
    return true;
  }
}
