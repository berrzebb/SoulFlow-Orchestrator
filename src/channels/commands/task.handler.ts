/**
 * /task 명령 핸들러 — Process + Agent Loop + Task Loop 통합 상태 조회·취소.
 *
 * | 명령                | 동작                                       |
 * |---------------------|--------------------------------------------|
 * | `/task`             | 활성 프로세스 + 작업 목록                   |
 * | `/task list`        | 활성 프로세스 + 작업 목록                   |
 * | `/task status <id>` | run_id/Task/Loop 상세 조회                  |
 * | `/task cancel <id>` | cascade 취소 (run_id → task → loop)         |
 * | `/task recent`      | 최근 완료 프로세스 이력                     |
 */
import type { TaskState, AgentLoopState } from "../../contracts.js";
import type { ProcessEntry } from "../../orchestration/process-tracker.js";
import { STATUS_EMOJI } from "../../orchestration/prompts.js";
import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide, format_subcommand_usage } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["task", "tasks", "작업"] as const;

export interface TaskAccess {
  find_waiting_task(provider: string, chat_id: string): Promise<TaskState | null>;
  get_task(task_id: string): Promise<TaskState | null>;
  cancel_task(task_id: string, reason?: string): Promise<TaskState | null>;
  list_active_tasks(): TaskState[];
  list_active_loops(): AgentLoopState[];
  stop_loop(loop_id: string, reason?: string): AgentLoopState | null;
  list_active_processes(): ProcessEntry[];
  list_recent_processes(limit?: number): ProcessEntry[];
  get_process(run_id: string): ProcessEntry | null;
  cancel_process(run_id: string): Promise<{ cancelled: boolean; details: string }>;
}

export class TaskHandler implements CommandHandler {
  readonly name = "task";

  constructor(private readonly access: TaskAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const { provider, message, command } = ctx;
    const mention = format_mention(provider, message.sender_id);
    const action = resolve_action(command?.args || []);

    switch (action.type) {
      case "guide": {
        const guide = format_subcommand_guide("task");
        await ctx.send_reply(`${mention}${guide}`);
        return true;
      }
      case "list": {
        const processes = this.access.list_active_processes();
        const tasks = this.access.list_active_tasks();
        const loops = this.access.list_active_loops();
        if (processes.length === 0 && tasks.length === 0 && loops.length === 0) {
          await ctx.send_reply(`${mention}현재 활성 작업이 없습니다.`);
          return true;
        }
        await ctx.send_reply(format_active_list(mention, processes, tasks, loops));
        return true;
      }
      case "status": {
        if (!action.task_id) {
          await ctx.send_reply(`${mention}${format_subcommand_usage("task", "status")}`);
          return true;
        }
        const process = this.access.get_process(action.task_id);
        if (process) {
          await ctx.send_reply(format_process_detail(mention, process));
          return true;
        }
        const task = await this.access.get_task(action.task_id);
        if (task) {
          await ctx.send_reply(format_task_detail(mention, task));
          return true;
        }
        const loop = this.access.list_active_loops().find((l) => l.loopId === action.task_id);
        if (loop) {
          await ctx.send_reply(format_loop_detail(mention, loop));
          return true;
        }
        await ctx.send_reply(`${mention}작업을 찾을 수 없습니다: ${action.task_id}`);
        return true;
      }
      case "cancel": {
        if (!action.task_id) {
          await ctx.send_reply(`${mention}${format_subcommand_usage("task", "cancel")}`);
          return true;
        }
        if (action.task_id === "all" || action.task_id === "전체") {
          return this.cancel_all(mention, ctx);
        }
        const proc_result = await this.access.cancel_process(action.task_id);
        if (proc_result.cancelled) {
          await ctx.send_reply(`${mention}✅ 프로세스 cascade 취소 완료\n- run_id: \`${action.task_id}\`\n- 상세: ${proc_result.details}`);
          return true;
        }
        const cancelled = await this.access.cancel_task(action.task_id, "cancelled_by_user");
        if (cancelled) {
          await ctx.send_reply(`${mention}✅ 작업이 취소되었습니다.\n- id: \`${cancelled.taskId}\`\n- status: ${cancelled.status}`);
          return true;
        }
        const stopped = this.access.stop_loop(action.task_id, "stopped_by_user");
        if (stopped) {
          await ctx.send_reply(`${mention}✅ 에이전트 루프가 중지되었습니다.\n- id: \`${stopped.loopId}\`\n- status: ${stopped.status}`);
          return true;
        }
        await ctx.send_reply(`${mention}취소할 작업을 찾을 수 없습니다: ${action.task_id}`);
        return true;
      }
      case "recent": {
        const recent = this.access.list_recent_processes(20);
        if (recent.length === 0) {
          await ctx.send_reply(`${mention}최근 완료 프로세스가 없습니다.`);
          return true;
        }
        await ctx.send_reply(format_recent_list(mention, recent));
        return true;
      }
      default:
        await ctx.send_reply(`${mention}${format_subcommand_guide("task")}`);
        return true;
    }
  }

  private async cancel_all(mention: string, ctx: CommandContext): Promise<boolean> {
    const processes = this.access.list_active_processes();
    const tasks = this.access.list_active_tasks();
    const loops = this.access.list_active_loops();
    if (processes.length === 0 && tasks.length === 0 && loops.length === 0) {
      await ctx.send_reply(`${mention}취소할 활성 작업이 없습니다.`);
      return true;
    }

    let cancelled_count = 0;
    for (const p of processes) {
      const r = await this.access.cancel_process(p.run_id);
      if (r.cancelled) cancelled_count++;
    }
    for (const t of tasks) {
      const result = await this.access.cancel_task(t.taskId, "cancelled_by_user_all");
      if (result) cancelled_count++;
    }
    for (const l of loops) {
      const result = this.access.stop_loop(l.loopId, "stopped_by_user_all");
      if (result) cancelled_count++;
    }

    const total = processes.length + tasks.length + loops.length;
    await ctx.send_reply(`${mention}🚫 전체 작업 취소 완료\n- Process: ${processes.length}개\n- Task: ${tasks.length}개\n- Agent Loop: ${loops.length}개\n- 취소됨: ${cancelled_count}/${total}`);
    return true;
  }
}

type TaskAction =
  | { type: "guide" }
  | { type: "list" }
  | { type: "status"; task_id: string | null }
  | { type: "cancel"; task_id: string | null }
  | { type: "recent" }
  | { type: "unknown" };

function resolve_action(args: string[]): TaskAction {
  if (args.length === 0) return { type: "guide" };
  const sub = args[0]?.toLowerCase() || "";
  if (sub === "list" || sub === "목록") return { type: "list" };
  if (sub === "status" || sub === "상태") return { type: "status", task_id: args[1] || null };
  if (sub === "cancel" || sub === "취소" || sub === "중지" || sub === "stop") return { type: "cancel", task_id: args[1] || null };
  if (sub === "recent" || sub === "이력" || sub === "history" || sub === "최근") return { type: "recent" };
  return { type: "unknown" };
}

function status_icon(status: string): string {
  return STATUS_EMOJI[status] || "❓";
}

function format_active_list(mention: string, processes: ProcessEntry[], tasks: TaskState[], loops: AgentLoopState[]): string {
  const lines = [`${mention}📋 활성 작업 목록`];

  if (processes.length > 0) {
    lines.push("", "**실행 흐름**");
    for (const p of processes) {
      const parts = [`${status_icon(p.status)} \`${p.run_id}\` [${p.mode}] ${p.alias}@${p.chat_id.slice(0, 8)}`];
      if (p.tool_calls_count > 0) parts.push(`tool: ${p.tool_calls_count}`);
      if (p.loop_id) parts.push(`loop: ${p.loop_id.slice(0, 16)}`);
      if (p.task_id) parts.push(`task: ${p.task_id.slice(0, 20)}`);
      if (p.subagent_ids.length > 0) parts.push(`sub: ${p.subagent_ids.length}개`);
      lines.push(parts.join(" — "));
    }
  }

  if (tasks.length > 0) {
    lines.push("", "**Task Loop**");
    for (const t of tasks) {
      lines.push(`${status_icon(t.status)} \`${t.taskId}\` ${t.title || "(제목 없음)"} [${t.status}] turn ${t.currentTurn}/${t.maxTurns}`);
    }
  }

  if (loops.length > 0) {
    lines.push("", "**Agent Loop**");
    for (const l of loops) {
      const objective = l.objective.length > 60 ? `${l.objective.slice(0, 57)}...` : l.objective;
      lines.push(`${status_icon(l.status)} \`${l.loopId}\` ${objective} [${l.status}] turn ${l.currentTurn}/${l.maxTurns}`);
    }
  }

  lines.push("", "상세: `/task status <id>` · 취소: `/task cancel <id>` · 이력: `/task recent`");
  return lines.join("\n");
}

function format_process_detail(mention: string, p: ProcessEntry): string {
  const duration = p.ended_at
    ? `${Math.round((new Date(p.ended_at).getTime() - new Date(p.started_at).getTime()) / 1000)}초`
    : `${Math.round((Date.now() - new Date(p.started_at).getTime()) / 1000)}초 (진행 중)`;

  return [
    `${mention}${status_icon(p.status)} 프로세스 상세`,
    `- run_id: \`${p.run_id}\``,
    `- mode: ${p.mode}`,
    `- status: ${p.status}`,
    `- provider: ${p.provider}`,
    `- alias: ${p.alias}`,
    `- sender: ${p.sender_id}`,
    `- duration: ${duration}`,
    `- tool_calls: ${p.tool_calls_count}`,
    p.loop_id ? `- loop_id: \`${p.loop_id}\`` : "",
    p.task_id ? `- task_id: \`${p.task_id}\`` : "",
    p.subagent_ids.length > 0 ? `- subagents: ${p.subagent_ids.map((s) => `\`${s}\``).join(", ")}` : "",
    p.error ? `- error: ${p.error.slice(0, 200)}` : "",
  ].filter(Boolean).join("\n");
}

function format_recent_list(mention: string, entries: ProcessEntry[]): string {
  const lines = [`${mention}📜 최근 완료 프로세스 (${entries.length}건)`];
  for (const p of entries) {
    const dur = p.ended_at
      ? `${Math.round((new Date(p.ended_at).getTime() - new Date(p.started_at).getTime()) / 1000)}초`
      : "?";
    lines.push(`${status_icon(p.status)} \`${p.run_id}\` [${p.mode}] ${p.alias} ${dur} tool:${p.tool_calls_count}${p.error ? " ⚠" : ""}`);
  }
  lines.push("", "상세: `/task status <run_id>`");
  return lines.join("\n");
}

function format_task_detail(mention: string, task: TaskState): string {
  const memory_keys = Object.keys(task.memory || {})
    .filter((k) => !k.startsWith("__"))
    .slice(0, 10);
  const memory_summary = memory_keys.length > 0
    ? memory_keys.map((k) => {
        const v = (task.memory as Record<string, unknown>)[k];
        const text = (v !== null && typeof v === "object") ? JSON.stringify(v) : String(v ?? "");
        return `  ${k}: ${text.slice(0, 80)}`;
      }).join("\n")
    : "  (empty)";

  return [
    `${mention}${status_icon(task.status)} Task 상세`,
    `- id: \`${task.taskId}\``,
    `- title: ${task.title}`,
    `- status: ${task.status}`,
    `- turn: ${task.currentTurn}/${task.maxTurns}`,
    task.currentStep ? `- step: ${task.currentStep}` : "",
    task.exitReason ? `- exit_reason: ${task.exitReason}` : "",
    `- memory:`,
    memory_summary,
  ].filter(Boolean).join("\n");
}

function format_loop_detail(mention: string, loop: AgentLoopState): string {
  return [
    `${mention}${status_icon(loop.status)} Agent Loop 상세`,
    `- id: \`${loop.loopId}\``,
    `- agent: ${loop.agentId}`,
    `- objective: ${loop.objective}`,
    `- status: ${loop.status}`,
    `- turn: ${loop.currentTurn}/${loop.maxTurns}`,
    loop.terminationReason ? `- reason: ${loop.terminationReason}` : "",
  ].filter(Boolean).join("\n");
}
