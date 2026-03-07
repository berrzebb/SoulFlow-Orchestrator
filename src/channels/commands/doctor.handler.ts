import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["doctor", "진단", "health", "건강", "헬스"] as const;

export interface DoctorAccess {
  get_tool_count(): number;
  get_skill_count(): number;
  get_active_task_count(): number;
  get_active_loop_count(): number;
  list_backends(): string[];
  list_mcp_servers(): Array<{ name: string; connected: boolean; tool_count: number; error?: string }>;
  get_cron_job_count(): number | Promise<number>;
}

export class DoctorHandler implements CommandHandler {
  readonly name = "doctor";

  constructor(private readonly access: DoctorAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const action = (ctx.command?.args?.[0] || "").toLowerCase();

    if (action === "mcp") {
      await ctx.send_reply(`${mention}${this.format_mcp()}`);
      return true;
    }
    if (action === "providers" || action === "backends" || action === "백엔드") {
      await ctx.send_reply(`${mention}${this.format_backends()}`);
      return true;
    }

    if (!action) {
      const guide = format_subcommand_guide("doctor");
      if (guide) { await ctx.send_reply(`${mention}${guide}`); return true; }
    }
    await ctx.send_reply(`${mention}${await this.format_overview()}`);
    return true;
  }

  private async format_overview(): Promise<string> {
    const tools = this.access.get_tool_count();
    const skills = this.access.get_skill_count();
    const tasks = this.access.get_active_task_count();
    const loops = this.access.get_active_loop_count();
    const backends = this.access.list_backends();
    const mcp = this.access.list_mcp_servers();
    const cron = await this.access.get_cron_job_count();

    const mcp_connected = mcp.filter((s) => s.connected).length;
    const mcp_tools = mcp.reduce((sum, s) => sum + s.tool_count, 0);

    return [
      "🩺 시스템 진단",
      "",
      `도구: ${tools}개 (내장) + ${mcp_tools}개 (MCP)`,
      `스킬: ${skills}개`,
      `백엔드: ${backends.join(", ") || "(없음)"}`,
      `MCP 서버: ${mcp_connected}/${mcp.length}개 연결`,
      `크론 작업: ${cron}개`,
      "",
      `활성 태스크: ${tasks}개`,
      `활성 에이전트 루프: ${loops}개`,
      "",
      "상세: /doctor mcp, /doctor backends",
    ].join("\n");
  }

  private format_mcp(): string {
    const servers = this.access.list_mcp_servers();
    if (!servers.length) return "등록된 MCP 서버가 없습니다.";
    const lines = servers.map((s) => {
      const status = s.connected ? "✅" : "❌";
      const detail = s.connected
        ? `도구 ${s.tool_count}개`
        : (s.error || "연결 안됨");
      return `${status} ${s.name}: ${detail}`;
    });
    return [`MCP 서버 상태 (${servers.length}개)`, "", ...lines].join("\n");
  }

  private format_backends(): string {
    const backends = this.access.list_backends();
    if (!backends.length) return "등록된 백엔드가 없습니다.";
    const lines = backends.map((b) => `- ${b}`);
    return [`에이전트 백엔드 (${backends.length}개)`, "", ...lines].join("\n");
  }
}
