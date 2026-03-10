import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide, format_subcommand_usage } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["workflow", "wf", "워크플로우", "워플"] as const;

type WorkflowRunInfo = {
  workflow_id: string;
  title: string;
  status: string;
  created_at?: string;
  current_phase?: number;
};

type TemplateInfo = {
  title: string;
  slug: string;
};

export interface WorkflowAccess {
  list_runs(): Promise<WorkflowRunInfo[]>;
  get_run(workflow_id: string): Promise<WorkflowRunInfo | null>;
  create(input: { objective: string; title: string }): Promise<{ ok: boolean; workflow_id?: string; error?: string }>;
  cancel(workflow_id: string): Promise<boolean>;
  list_templates(): TemplateInfo[];
}

const STATUS_ICON: Record<string, string> = {
  running: "\u{1F504}",
  completed: "\u2705",
  failed: "\u274C",
  cancelled: "\u{1F6AB}",
  paused: "\u23F8\uFE0F",
  waiting_input: "\u{1F4AC}",
};

export class WorkflowHandler implements CommandHandler {
  readonly name = "workflow";

  constructor(private readonly access: WorkflowAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const args = ctx.command?.args || [];
    const action = ctx.command?.args_lower?.[0] || "";

    if (!action) {
      const guide = format_subcommand_guide("workflow");
      if (guide) { await ctx.send_reply(`${mention}${guide}`); return true; }
    }
    if (action === "list" || action === "\uBAA9\uB85D") {
      await ctx.send_reply(`${mention}${await this.format_list()}`);
      return true;
    }
    if (action === "status" || action === "\uC0C1\uD0DC") {
      await ctx.send_reply(`${mention}${await this.format_status(args[1] || "")}`);
      return true;
    }
    if (action === "run" || action === "\uC2E4\uD589") {
      const objective = args.slice(1).join(" ");
      await ctx.send_reply(`${mention}${await this.do_run(objective)}`);
      return true;
    }
    if (action === "cancel" || action === "\uCDE8\uC18C") {
      await ctx.send_reply(`${mention}${await this.do_cancel(args[1] || "")}`);
      return true;
    }
    if (action === "templates" || action === "\uD15C\uD50C\uB9BF") {
      await ctx.send_reply(`${mention}${this.format_templates()}`);
      return true;
    }

    const guide = format_subcommand_guide("workflow");
    await ctx.send_reply(`${mention}${guide}`);
    return true;
  }

  private async format_list(): Promise<string> {
    const runs = await this.access.list_runs();
    if (!runs.length) return "\uC2E4\uD589 \uC911\uC778 \uC6CC\uD06C\uD50C\uB85C\uC6B0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
    const lines = runs.slice(0, 15).map((r) => {
      const icon = STATUS_ICON[r.status] || "\u2753";
      return `${icon} \`${r.workflow_id}\` ${r.title || "(untitled)"} \u2014 ${r.status}`;
    });
    const extra = runs.length > 15 ? `\n... \uC678 ${runs.length - 15}\uAC1C` : "";
    return [`\uC6CC\uD06C\uD50C\uB85C\uC6B0 ${runs.length}\uAC1C`, "", ...lines, extra].filter(Boolean).join("\n");
  }

  private async format_status(id: string): Promise<string> {
    if (!id) return format_subcommand_usage("workflow", "status");
    const run = await this.access.get_run(id);
    if (!run) return `\uC6CC\uD06C\uD50C\uB85C\uC6B0\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: ${id}`;
    const icon = STATUS_ICON[run.status] || "\u2753";
    return [
      `${icon} \uC6CC\uD06C\uD50C\uB85C\uC6B0 \uC0C1\uC138`,
      `- id: \`${run.workflow_id}\``,
      `- title: ${run.title || "(untitled)"}`,
      `- status: ${run.status}`,
      run.current_phase !== undefined ? `- phase: ${run.current_phase}` : "",
      run.created_at ? `- created: ${run.created_at}` : "",
    ].filter(Boolean).join("\n");
  }

  private async do_run(objective: string): Promise<string> {
    if (!objective.trim()) return format_subcommand_usage("workflow", "run");
    const result = await this.access.create({ objective, title: objective.slice(0, 60) });
    if (!result.ok) return `\u274C \uC6CC\uD06C\uD50C\uB85C\uC6B0 \uC2E4\uD589 \uC2E4\uD328: ${result.error || "unknown"}`;
    return `\u2705 \uC6CC\uD06C\uD50C\uB85C\uC6B0 \uC2DC\uC791\uB428: \`${result.workflow_id}\``;
  }

  private async do_cancel(id: string): Promise<string> {
    if (!id) return format_subcommand_usage("workflow", "cancel");
    const ok = await this.access.cancel(id);
    return ok ? `\u2705 \uC6CC\uD06C\uD50C\uB85C\uC6B0 \uCDE8\uC18C\uB428: ${id}` : `\uCDE8\uC18C\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: ${id}`;
  }

  private format_templates(): string {
    const templates = this.access.list_templates();
    if (!templates.length) return "\uB4F1\uB85D\uB41C \uC6CC\uD06C\uD50C\uB85C\uC6B0 \uD15C\uD50C\uB9BF\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.";
    const lines = templates.slice(0, 20).map((t) => `- \`${t.slug}\` ${t.title}`);
    return [`\uD15C\uD50C\uB9BF ${templates.length}\uAC1C`, "", ...lines].join("\n");
  }
}
