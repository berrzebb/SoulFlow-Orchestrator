import { error_message } from "../../utils/common.js";
import { slash_name_in } from "../slash-command.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["verify", "검증", "확인", "리뷰"] as const;

export interface VerifyAccess {
  get_last_output(provider: string, chat_id: string): string | null | Promise<string | null>;
  run_verification(task: string): Promise<{ ok: boolean; content: string }>;
}

export class VerifyHandler implements CommandHandler {
  readonly name = "verify";

  constructor(private readonly access: VerifyAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const last_output = await this.access.get_last_output(ctx.provider, ctx.message.chat_id);

    if (!last_output) {
      await ctx.send_reply(`${mention}검증할 이전 출력이 없습니다.`);
      return true;
    }

    const criteria = (ctx.command?.args || []).join(" ") || "정확성, 완전성, 일관성을 검증";
    const snippet = last_output.length > 200 ? `${last_output.slice(0, 200)}...` : last_output;
    await ctx.send_reply(`${mention}검증을 시작합니다...\n대상: "${snippet}"`);

    try {
      const task = [
        `다음 출력물을 검증하세요. 기준: ${criteria}`,
        "",
        "--- 검증 대상 ---",
        last_output.slice(0, 2000),
        "--- 끝 ---",
        "",
        "결과를 PASS/FAIL + 사유로 간결하게 보고하세요.",
      ].join("\n");

      const result = await this.access.run_verification(task);
      const icon = result.ok ? "✅ PASS" : "❌ FAIL";
      await ctx.send_reply(`${mention}${icon}\n${result.content}`);
    } catch (error) {
      const msg = error_message(error);
      await ctx.send_reply(`${mention}검증 중 오류: ${msg}`);
    }

    return true;
  }
}
