import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide, format_subcommand_usage } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["skill", "skills", "스킬", "스킬관리"] as const;

type SkillInfo = {
  name: string;
  summary: string;
  type: string;
  source: string;
  always: boolean;
  model: string | null;
  tools: string[];
  requirements: string[];
  role: string | null;
  shared_protocols: string[];
};

export interface SkillAccess {
  list_skills(): Array<{ name: string; summary: string; type: string; source: string; always: boolean; model: string | null }>;
  get_skill(name: string): SkillInfo | null;
  list_role_skills(): Array<{ name: string; role: string | null; summary: string }>;
  recommend(task: string, limit?: number): string[];
  refresh(): number;
}

export class SkillHandler implements CommandHandler {
  readonly name = "skill";

  constructor(private readonly access: SkillAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const args = ctx.command?.args || [];
    const action = ctx.command?.args_lower?.[0] || "";

    if (action === "info" || action === "상세") {
      await ctx.send_reply(`${mention}${this.format_info(args[1] || "")}`);
      return true;
    }
    if (action === "roles" || action === "역할") {
      await ctx.send_reply(`${mention}${this.format_roles()}`);
      return true;
    }
    if (action === "recommend" || action === "추천") {
      const task = args.slice(1).join(" ");
      await ctx.send_reply(`${mention}${this.format_recommend(task)}`);
      return true;
    }
    if (action === "refresh" || action === "새로고침") {
      const count = this.access.refresh();
      await ctx.send_reply(`${mention}스킬을 새로고침했습니다. (${count}개 로드됨)`);
      return true;
    }
    if (action === "list" || action === "목록") {
      await ctx.send_reply(`${mention}${this.format_list(true)}`);
      return true;
    }

    // 인자 없이 호출: 세부 기능 안내
    if (!action) {
      const guide = format_subcommand_guide("skill");
      if (guide) { await ctx.send_reply(`${mention}${guide}`); return true; }
    }
    await ctx.send_reply(`${mention}${this.format_list(false)}`);
    return true;
  }

  private format_list(detailed: boolean): string {
    const skills = this.access.list_skills();
    if (!skills.length) return "등록된 스킬이 없습니다.";

    const lines = skills.map((s) => {
      const flags = [
        s.always ? "[always]" : "",
        s.type === "role" ? "[role]" : "",
        s.model ? `[${s.model}]` : "",
      ].filter(Boolean).join(" ");
      return detailed
        ? `- ${s.name} ${flags}: ${s.summary || "(설명 없음)"} (${s.source})`
        : `- ${s.name}${flags ? ` ${flags}` : ""}: ${s.summary || "(설명 없음)"}`;
    });
    return [`스킬 ${skills.length}개`, "", ...lines].join("\n");
  }

  private format_info(name: string): string {
    if (!name) return format_subcommand_usage("skill", "info");
    const skill = this.access.get_skill(name);
    if (!skill) return `스킬을 찾을 수 없습니다: ${name}`;

    const lines = [
      `**${skill.name}**`,
      `- 설명: ${skill.summary || "(없음)"}`,
      `- 타입: ${skill.type}`,
      `- 소스: ${skill.source}`,
      `- always: ${skill.always}`,
      skill.model ? `- 모델: ${skill.model}` : "",
      skill.role ? `- 역할: ${skill.role}` : "",
      skill.tools.length ? `- 도구: ${skill.tools.join(", ")}` : "",
      skill.requirements.length ? `- 요구사항: ${skill.requirements.join(", ")}` : "",
      skill.shared_protocols.length ? `- 프로토콜: ${skill.shared_protocols.join(", ")}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  }

  private format_roles(): string {
    const roles = this.access.list_role_skills();
    if (!roles.length) return "등록된 역할 스킬이 없습니다.";
    const lines = roles.map((r) => `- ${r.name} (${r.role || "?"}): ${r.summary || "(설명 없음)"}`);
    return [`역할 스킬 ${roles.length}개`, "", ...lines].join("\n");
  }

  private format_recommend(task: string): string {
    if (!task) return format_subcommand_usage("skill", "recommend");
    const names = this.access.recommend(task, 5);
    if (!names.length) return "추천할 스킬이 없습니다.";
    const lines = names.map((n, i) => `${i + 1}. ${n}`);
    return [`"${task.slice(0, 60)}" 에 추천되는 스킬:`, "", ...lines].join("\n");
  }
}
