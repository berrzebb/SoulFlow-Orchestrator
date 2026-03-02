import { slash_name_in } from "../slash-command.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["stats", "통계", "점수", "cd"] as const;

type CDScore = {
  total: number;
  events: Array<{ indicator: string; points: number; context: string; at: string }>;
};

export interface StatsAccess {
  get_cd_score(): CDScore;
  reset_cd(): void;
  get_active_task_count(): number;
  get_active_loop_count(): number;
  get_provider_health?(): Array<{ provider: string; score: number; success_count: number; failure_count: number; avg_latency_ms: number }>;
}

const CD_ICON: Record<string, string> = {
  clarify: "❓",
  correct: "🔄",
  redo: "♻️",
};

export class StatsHandler implements CommandHandler {
  readonly name = "stats";

  constructor(private readonly access: StatsAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const action = (ctx.command?.args?.[0] || "").toLowerCase();

    if (action === "cd" || action === "상세") {
      await ctx.send_reply(`${mention}${this.format_cd_detail()}`);
      return true;
    }
    if (action === "reset" || action === "초기화") {
      this.access.reset_cd();
      await ctx.send_reply(`${mention}CD 점수가 초기화되었습니다.`);
      return true;
    }

    await ctx.send_reply(`${mention}${this.format_overview()}`);
    return true;
  }

  private format_overview(): string {
    const cd = this.access.get_cd_score();
    const tasks = this.access.get_active_task_count();
    const loops = this.access.get_active_loop_count();

    const health = cd.total <= 15 ? "🟢 건강" : cd.total <= 50 ? "🟡 주의" : "🔴 경고";

    const lines = [
      "📊 세션 통계",
      "",
      `CD 점수: ${cd.total} ${health}`,
      `  clarify(+10): ${cd.events.filter((e) => e.indicator === "clarify").length}회`,
      `  correct(+25): ${cd.events.filter((e) => e.indicator === "correct").length}회`,
      `  redo(+40): ${cd.events.filter((e) => e.indicator === "redo").length}회`,
      "",
      `활성 태스크: ${tasks}개`,
      `활성 루프: ${loops}개`,
    ];

    const provider_health = this.access.get_provider_health?.();
    if (provider_health?.length) {
      lines.push("", "🏥 프로바이더 건강");
      for (const p of provider_health) {
        const avg = p.success_count + p.failure_count > 0
          ? Math.round(p.avg_latency_ms)
          : 0;
        const icon = p.score >= 0.8 ? "🟢" : p.score >= 0.5 ? "🟡" : "🔴";
        lines.push(`  ${icon} ${p.provider}: ${(p.score * 100).toFixed(0)}점 (${p.success_count}✓ ${p.failure_count}✗ ${avg}ms)`);
      }
    }

    lines.push("", "상세: /stats cd · 초기화: /stats reset");
    return lines.join("\n");
  }

  private format_cd_detail(): string {
    const cd = this.access.get_cd_score();
    if (!cd.events.length) return "CD 이벤트가 없습니다. (CD 점수: 0)";

    const lines = cd.events.map((e) => {
      const icon = CD_ICON[e.indicator] || "•";
      return `${icon} [${e.indicator} +${e.points}] ${e.context.slice(0, 80)}`;
    });

    return [
      `CD 이벤트 ${cd.events.length}건 (총 ${cd.total}점)`,
      "",
      ...lines,
    ].join("\n");
  }
}
