import { slash_name_in } from "../slash-command.js";
import type { CommandContext, CommandHandler } from "./types.js";

const ALIASES = ["reload", "리로드", "새로고침"] as const;

export type ReloadTarget = {
  reload_config: () => Promise<void>;
  reload_tools: () => Promise<number>;
  reload_skills: () => Promise<number>;
};

export class ReloadHandler implements CommandHandler {
  readonly name = "reload";

  constructor(private readonly target: ReloadTarget) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const lines: string[] = [];
    try {
      await this.target.reload_config();
      lines.push("config: reloaded");
    } catch (error) {
      lines.push(`config: failed (${error instanceof Error ? error.message : String(error)})`);
    }
    try {
      const tools = await this.target.reload_tools();
      lines.push(`tools: ${tools} reloaded`);
    } catch (error) {
      lines.push(`tools: failed (${error instanceof Error ? error.message : String(error)})`);
    }
    try {
      const skills = await this.target.reload_skills();
      lines.push(`skills: ${skills} reloaded`);
    } catch (error) {
      lines.push(`skills: failed (${error instanceof Error ? error.message : String(error)})`);
    }
    await ctx.send_reply(`🔄 reload\n${lines.join("\n")}`);
    return true;
  }
}
