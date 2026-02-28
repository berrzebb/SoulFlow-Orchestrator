import { slash_name_in } from "../slash-command.js";
import type { ChannelProvider } from "../types.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["stop", "cancel", "중지"] as const;

export type CancelActiveRuns = (provider: ChannelProvider, chat_id: string) => Promise<number>;

export class StopHandler implements CommandHandler {
  readonly name = "stop";

  constructor(private readonly cancel_runs: CancelActiveRuns) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const cancelled = await this.cancel_runs(ctx.provider, ctx.message.chat_id);
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const text = cancelled > 0
      ? `${mention}실행 중 작업 ${cancelled}건을 중지했습니다.`
      : `${mention}중지할 실행 작업이 없습니다.`;
    await ctx.send_reply(text);
    return true;
  }
}
