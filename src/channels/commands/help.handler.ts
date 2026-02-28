import { slash_name_in } from "../slash-command.js";
import { format_help_text, get_command_descriptors } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["help", "commands", "cmd", "도움말", "명령어"] as const;

export class HelpHandler implements CommandHandler {
  readonly name = "help";

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    await ctx.send_reply(`${mention}${format_help_text(get_command_descriptors())}`);
    return true;
  }
}
