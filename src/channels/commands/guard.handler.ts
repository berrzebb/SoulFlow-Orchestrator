import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";
import type { ConfirmationGuard } from "../../orchestration/confirmation-guard.js";

const ROOT_ALIASES = ["guard", "가드", "확인"] as const;
const ON_TOKENS = new Set(["on", "enable", "활성", "켜"]);
const OFF_TOKENS = new Set(["off", "disable", "비활성", "꺼"]);

export class GuardHandler implements CommandHandler {
  readonly name = "guard";

  constructor(private readonly guard: ConfirmationGuard) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ROOT_ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const arg = String(ctx.command?.args_lower?.[0] || ctx.command?.args?.[0] || "").toLowerCase();

    if (ON_TOKENS.has(arg)) {
      this.guard.set_enabled(true);
      await ctx.send_reply(`${mention}✅ 확인 가드가 활성화되었습니다. 크론 작업이나 장기 실행 작업 실행 전 확인을 요청합니다.`);
      return true;
    }

    if (OFF_TOKENS.has(arg)) {
      this.guard.set_enabled(false);
      await ctx.send_reply(`${mention}🚫 확인 가드가 비활성화되었습니다.`);
      return true;
    }

    const status = this.guard.get_status();
    const guide = format_subcommand_guide("guard");
    await ctx.send_reply([
      `${mention}확인 가드 상태`,
      `- 활성: ${status.enabled ? "✅ ON" : "🚫 OFF"}`,
      `- 대기 중: ${status.pending_count}건`,
      ...(guide ? ["", guide] : []),
    ].join("\n"));
    return true;
  }
}
