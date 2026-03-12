import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";
import type { ModelDailySummary } from "../../gateway/usage-store.js";

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
  get_today_by_model?(): Promise<ModelDailySummary[]>;
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
    if (action === "usage" || action === "today" || action === "사용량") {
      if (!this.access.get_today_by_model) {
        await ctx.send_reply(`${mention}사용량 통계가 연결되지 않았습니다.`);
        return true;
      }
      const rows = await this.access.get_today_by_model();
      await ctx.send_reply(`${mention}${format_today_usage(rows)}`);
      return true;
    }

    if (!action) {
      const guide = format_subcommand_guide("stats");
      if (guide) { await ctx.send_reply(`${mention}${guide}`); return true; }
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

    lines.push("", "상세: /stats cd · 사용량: /stats usage · 초기화: /stats reset");
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

function fmt_tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmt_cost(usd: number): string {
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
}

function bar(fraction: number, width = 10): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** 당일 프로바이더·모델별 사용량을 텍스트 바 차트로 포맷. */
function format_today_usage(rows: ModelDailySummary[]): string {
  if (!rows.length) {
    return `📊 오늘의 사용량\n\n데이터가 없습니다.`;
  }

  const today = rows[0]?.date ?? new Date().toISOString().slice(0, 10);
  const max_tokens = Math.max(...rows.map((r) => r.total_tokens), 1);
  const total_calls = rows.reduce((s, r) => s + r.calls, 0);
  const total_tokens = rows.reduce((s, r) => s + r.total_tokens, 0);
  const total_cost = rows.reduce((s, r) => s + r.cost_usd, 0);

  // provider별로 그루핑
  const by_provider = new Map<string, ModelDailySummary[]>();
  for (const row of rows) {
    const group = by_provider.get(row.provider_id) ?? [];
    group.push(row);
    by_provider.set(row.provider_id, group);
  }

  const lines: string[] = [`📊 오늘의 사용량 (${today})`, ""];

  for (const [provider_id, models] of by_provider) {
    lines.push(`━━ ${provider_id} ━━━━━━━━━━`);
    for (const r of models) {
      const b = bar(r.total_tokens / max_tokens);
      const model_short = r.model.length > 22 ? r.model.slice(0, 21) + "…" : r.model;
      lines.push(`  ${model_short.padEnd(23)} ${b}  ${String(r.calls).padStart(3)}회 · ${fmt_tokens(r.total_tokens).padStart(7)} tok · ${fmt_cost(r.cost_usd)}`);
    }
    lines.push("");
  }

  lines.push(`💰 총 ${total_calls}회 · ${fmt_tokens(total_tokens)} 토큰 · ${fmt_cost(total_cost)}`);
  return lines.join("\n");
}
