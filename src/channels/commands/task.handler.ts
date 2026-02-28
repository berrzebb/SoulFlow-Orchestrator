/**
 * /task 명령 핸들러 — Agent Loop + Task Loop 통합 상태 조회·취소.
 *
 * | 명령                | 동작                                       |
 * |---------------------|--------------------------------------------|
 * | `/task`             | 전체 활성 작업 목록 (agent + task)          |
 * | `/task list`        | 전체 활성 작업 목록 (agent + task)          |
 * | `/task status <id>` | Task/Loop 상세 조회                         |
 * | `/task cancel <id>` | Task 취소 또는 Agent Loop 중지              |
 */
import type { TaskState, AgentLoopState } from "../../contracts.js";
import { slash_name_in } from "../slash-command.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["task", "tasks", "작업"] as const;

export interface TaskAccess {
  find_waiting_task(provider: string, chat_id: string): Promise<TaskState | null>;
  get_task(task_id: string): Promise<TaskState | null>;
  cancel_task(task_id: string, reason?: string): Promise<TaskState | null>;
  list_active_tasks(): TaskState[];
  list_active_loops(): AgentLoopState[];
  stop_loop(loop_id: string, reason?: string): AgentLoopState | null;
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
      case "list": {
        const tasks = this.access.list_active_tasks();
        const loops = this.access.list_active_loops();
        if (tasks.length === 0 && loops.length === 0) {
          await ctx.send_reply(`${mention}현재 활성 작업이 없습니다.`);
          return true;
        }
        await ctx.send_reply(format_active_list(mention, tasks, loops));
        return true;
      }
      case "status": {
        if (!action.task_id) {
          await ctx.send_reply(`${mention}사용법: /task status <task_id>`);
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
          await ctx.send_reply(`${mention}사용법: /task cancel <task_id|all>`);
          return true;
        }
        if (action.task_id === "all" || action.task_id === "전체") {
          const result = await this.cancel_all(mention, ctx);
          return result;
        }
        const cancelled = await this.access.cancel_task(action.task_id, "cancelled_by_user");
        if (cancelled) {
          await ctx.send_reply(`${mention}✅ 작업이 취소되었습니다.\n- id: ${cancelled.taskId}\n- status: ${cancelled.status}`);
          return true;
        }
        const stopped = this.access.stop_loop(action.task_id, "stopped_by_user");
        if (stopped) {
          await ctx.send_reply(`${mention}✅ 에이전트 루프가 중지되었습니다.\n- id: ${stopped.loopId}\n- status: ${stopped.status}`);
          return true;
        }
        await ctx.send_reply(`${mention}취소할 작업을 찾을 수 없습니다: ${action.task_id}`);
        return true;
      }
      default:
        await ctx.send_reply(`${mention}사용법: /task [list|status <id>|cancel <id|all>]`);
        return true;
    }
  }

  private async cancel_all(mention: string, ctx: CommandContext): Promise<boolean> {
    const tasks = this.access.list_active_tasks();
    const loops = this.access.list_active_loops();
    if (tasks.length === 0 && loops.length === 0) {
      await ctx.send_reply(`${mention}취소할 활성 작업이 없습니다.`);
      return true;
    }

    let cancelled_count = 0;
    for (const t of tasks) {
      const result = await this.access.cancel_task(t.taskId, "cancelled_by_user_all");
      if (result) cancelled_count++;
    }
    for (const l of loops) {
      const result = this.access.stop_loop(l.loopId, "stopped_by_user_all");
      if (result) cancelled_count++;
    }

    const total = tasks.length + loops.length;
    await ctx.send_reply(`${mention}🚫 전체 작업 취소 완료\n- Task: ${tasks.length}개\n- Agent Loop: ${loops.length}개\n- 취소됨: ${cancelled_count}/${total}`);
    return true;
  }
}

type TaskAction =
  | { type: "list" }
  | { type: "status"; task_id: string | null }
  | { type: "cancel"; task_id: string | null }
  | { type: "unknown" };

function resolve_action(args: string[]): TaskAction {
  if (args.length === 0) return { type: "list" };
  const sub = args[0]?.toLowerCase() || "";
  if (sub === "list" || sub === "목록") return { type: "list" };
  if (sub === "status" || sub === "상태") return { type: "status", task_id: args[1] || null };
  if (sub === "cancel" || sub === "취소" || sub === "중지" || sub === "stop") return { type: "cancel", task_id: args[1] || null };
  return { type: "unknown" };
}

const STATUS_EMOJI: Record<string, string> = {
  running: "🔄",
  waiting_approval: "🔐",
  waiting_user_input: "💬",
  failed: "❌",
  max_turns_reached: "⚠️",
  stopped: "⏹️",
  completed: "✅",
  cancelled: "🚫",
};

function status_icon(status: string): string {
  return STATUS_EMOJI[status] || "❓";
}

function format_active_list(mention: string, tasks: TaskState[], loops: AgentLoopState[]): string {
  const lines = [`${mention}📋 활성 작업 목록`];

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

  lines.push("", "상세: `/task status <id>` · 취소: `/task cancel <id>`");
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
