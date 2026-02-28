import {
  has_explicit_status_intent,
  parse_status_quick_action,
} from "../command-intent.js";
import { slash_name_in } from "../slash-command.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const COMMAND_ALIASES = ["status", "tools", "skills", "상태", "도구", "도구목록", "스킬", "스킬목록"] as const;

export interface StatusAccess {
  list_tools(): Array<{ name: string }>;
  list_skills(): Array<{ name: string; summary: string; always: string }>;
}

export class StatusHandler implements CommandHandler {
  readonly name = "status";

  constructor(private readonly access: StatusAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", COMMAND_ALIASES)
      || has_explicit_status_intent(ctx.text);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const action = parse_status_quick_action(ctx.text, ctx.command) || "overview";
    const mention = format_mention(ctx.provider, ctx.message.sender_id);

    if (action === "tools") {
      await ctx.send_reply(`${mention}${this.format_tools()}`);
      return true;
    }
    if (action === "skills") {
      await ctx.send_reply(`${mention}${this.format_skills()}`);
      return true;
    }

    await ctx.send_reply(`${mention}${this.format_overview()}`);
    return true;
  }

  private format_tools(): string {
    const tools = this.access.list_tools();
    if (!tools.length) return "현재 등록된 도구가 없습니다.";
    const lines = tools.map((t) => `- ${t.name}`);
    return [`현재 사용 가능한 도구는 ${tools.length}개입니다.`, "", ...lines].join("\n");
  }

  private format_skills(): string {
    const skills = this.access.list_skills();
    if (!skills.length) return "현재 등록된 스킬이 없습니다.";
    const lines = skills.map((s) =>
      `- ${s.name}${s.always === "true" ? " [always]" : ""}: ${s.summary || "(설명 없음)"}`,
    );
    return [`현재 사용 가능한 스킬은 ${skills.length}개입니다.`, "", ...lines].join("\n");
  }

  private format_overview(): string {
    const tools = this.access.list_tools();
    const skills = this.access.list_skills();
    const tool_names = tools.slice(0, 10).map((t) => t.name).join(", ");
    const skill_names = skills.slice(0, 10).map((s) => s.name).join(", ");
    return [
      `현재 도구 ${tools.length}개, 스킬 ${skills.length}개가 준비되어 있습니다.`,
      "",
      tool_names ? `도구: ${tool_names}${tools.length > 10 ? " 외" : ""}` : "도구: (없음)",
      skill_names ? `스킬: ${skill_names}${skills.length > 10 ? " 외" : ""}` : "스킬: (없음)",
      "",
      "상세 목록은 /tools, /skills 로 확인하실 수 있습니다.",
    ].join("\n");
  }
}
