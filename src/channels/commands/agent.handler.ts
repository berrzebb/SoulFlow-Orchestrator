import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide, format_subcommand_usage } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["agent", "agents", "에이전트", "서브에이전트"] as const;

type AgentInfo = {
  id: string;
  role: string;
  status: string;
  label?: string;
  created_at?: string;
  last_error?: string;
  model?: string;
  session_id?: string;
  updated_at?: string;
  last_result?: string;
};

export interface AgentAccess {
  list(): AgentInfo[];
  list_running(): AgentInfo[];
  get(id: string): AgentInfo | null;
  cancel(id: string): boolean;
  send_input(id: string, text: string): boolean;
  get_running_count(): number;
}

const STATUS_ICON: Record<string, string> = {
  idle: "⏸️",
  running: "🔄",
  completed: "✅",
  failed: "❌",
  cancelled: "🚫",
};

export class AgentHandler implements CommandHandler {
  readonly name = "agent";

  constructor(private readonly access: AgentAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const args = ctx.command?.args || [];
    const action = (args[0] || "").toLowerCase();

    if (action === "running" || action === "실행중") {
      await ctx.send_reply(`${mention}${this.format_running()}`);
      return true;
    }
    if (action === "status" || action === "상태") {
      await ctx.send_reply(`${mention}${this.format_status(args[1] || "")}`);
      return true;
    }
    if (action === "cancel" || action === "취소") {
      await ctx.send_reply(`${mention}${this.do_cancel(args[1] || "")}`);
      return true;
    }
    if (action === "send" || action === "전송") {
      await ctx.send_reply(`${mention}${this.do_send(args[1] || "", args.slice(2).join(" "))}`);
      return true;
    }

    if (!action) {
      const guide = format_subcommand_guide("agent");
      if (guide) { await ctx.send_reply(`${mention}${guide}`); return true; }
    }
    await ctx.send_reply(`${mention}${this.format_list()}`);
    return true;
  }

  private format_list(): string {
    const agents = this.access.list();
    if (!agents.length) return "등록된 서브에이전트가 없습니다.";
    const lines = agents.slice(0, 20).map((a) => {
      const icon = STATUS_ICON[a.status] || "❓";
      const label = a.label ? ` (${a.label})` : "";
      return `${icon} \`${a.id}\` [${a.role}]${label} — ${a.status}`;
    });
    const extra = agents.length > 20 ? `\n... 외 ${agents.length - 20}개` : "";
    return [`서브에이전트 ${agents.length}개 (실행 중 ${this.access.get_running_count()}개)`, "", ...lines, extra].filter(Boolean).join("\n");
  }

  private format_running(): string {
    const running = this.access.list_running();
    if (!running.length) return "실행 중인 서브에이전트가 없습니다.";
    const lines = running.map((a) => {
      const label = a.label ? ` (${a.label})` : "";
      return `🔄 \`${a.id}\` [${a.role}]${label}`;
    });
    return [`실행 중 ${running.length}개`, "", ...lines].join("\n");
  }

  private format_status(id: string): string {
    if (!id) return format_subcommand_usage("agent", "status");
    const a = this.access.get(id);
    if (!a) return `서브에이전트를 찾을 수 없습니다: ${id}`;
    const result_preview = a.last_result ? a.last_result.slice(0, 200) : "";
    const lines = [
      `${STATUS_ICON[a.status] || "❓"} 서브에이전트 상세`,
      `- id: \`${a.id}\``,
      `- role: ${a.role}`,
      `- status: ${a.status}`,
      a.label ? `- label: ${a.label}` : "",
      a.model ? `- model: ${a.model}` : "",
      a.session_id ? `- session: ${a.session_id}` : "",
      a.created_at ? `- created: ${a.created_at}` : "",
      a.updated_at ? `- updated: ${a.updated_at}` : "",
      a.last_error ? `- error: ${a.last_error}` : "",
      result_preview ? `- result: ${result_preview}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  }

  private do_send(id: string, text: string): string {
    if (!id) return format_subcommand_usage("agent", "send");
    if (!text.trim()) return "전송할 텍스트를 입력하세요.";
    const ok = this.access.send_input(id, text);
    return ok
      ? `✅ 입력 전송됨: ${id}`
      : `전송할 수 없습니다: ${id} (실행 중이 아니거나 입력을 지원하지 않음)`;
  }

  private do_cancel(id: string): string {
    if (!id) return format_subcommand_usage("agent", "cancel");

    if (id === "all" || id === "전체") {
      const running = this.access.list_running();
      if (!running.length) return "취소할 실행 중인 서브에이전트가 없습니다.";
      let cancelled = 0;
      for (const a of running) {
        if (this.access.cancel(a.id)) cancelled++;
      }
      return `🚫 ${cancelled}/${running.length}개 서브에이전트 취소됨`;
    }

    const ok = this.access.cancel(id);
    return ok
      ? `✅ 서브에이전트 취소됨: ${id}`
      : `취소할 수 없습니다: ${id} (없거나 이미 종료됨)`;
  }
}
