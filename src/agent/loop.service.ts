import type { AgentLoopState, TaskState } from "../contracts.js";
import type { AgentLoopRunOptions, AgentLoopRunResult, TaskLoopRunOptions, TaskLoopRunResult } from "./loop.types.js";
import type { TaskStore } from "./task-store.js";

const SEOUL_TZ = "Asia/Seoul";

function now_seoul_iso(): string {
  const now = new Date();
  const format = new Intl.DateTimeFormat("sv-SE", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string => format.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+09:00`;
}

export class AgentLoopStore {
  private readonly loops = new Map<string, AgentLoopState>();
  private readonly tasks = new Map<string, TaskState>();
  private readonly task_store: TaskStore | null;

  constructor(options?: { task_store?: TaskStore | null }) {
    this.task_store = options?.task_store || null;
  }

  async initialize(): Promise<void> {
    if (!this.task_store) return;
    const rows = await this.task_store.list();
    for (const task of rows) this.tasks.set(task.taskId, task);
  }

  upsert(loop: AgentLoopState): void {
    this.loops.set(loop.loopId, loop);
  }

  get(loopId: string): AgentLoopState | null {
    return this.loops.get(loopId) || null;
  }

  list_loops(): AgentLoopState[] {
    return [...this.loops.values()];
  }

  get_task(task_id: string): TaskState | null {
    return this.tasks.get(task_id) || null;
  }

  list_tasks(): TaskState[] {
    return [...this.tasks.values()];
  }

  stop_loop(loop_id: string, reason = "stopped_by_request"): AgentLoopState | null {
    const state = this.loops.get(loop_id);
    if (!state) return null;
    state.checkShouldContinue = false;
    state.status = "stopped";
    state.terminationReason = reason;
    this.loops.set(loop_id, state);
    return state;
  }

  cancel_task(task_id: string, reason = "cancelled_by_request"): TaskState | null {
    const state = this.tasks.get(task_id);
    if (!state) return null;
    state.status = "cancelled";
    state.exitReason = reason;
    this.tasks.set(task_id, state);
    void this.persist_task(state);
    return state;
  }

  async resume_task(task_id: string, reason = "resumed"): Promise<TaskState | null> {
    const state = this.tasks.get(task_id);
    if (!state) return null;
    state.status = "running";
    state.exitReason = reason;
    this.tasks.set(task_id, state);
    await this.persist_task(state);
    return state;
  }

  async run_agent_loop(options: AgentLoopRunOptions): Promise<AgentLoopRunResult> {
    const max_turns = Math.max(1, Number(options.max_turns || 30));
    const state: AgentLoopState = {
      loopId: options.loop_id,
      agentId: options.agent_id,
      objective: options.objective,
      currentTurn: 0,
      maxTurns: max_turns,
      checkShouldContinue: true,
      status: "running",
    };
    this.loops.set(state.loopId, state);

    let current_message = options.current_message || options.objective;
    let final_content: string | null = null;

    while (state.currentTurn < state.maxTurns && state.checkShouldContinue) {
      state.currentTurn += 1;
      const response = await options.providers.run_headless_with_context({
        context_builder: options.context_builder,
        provider_id: options.provider_id,
        history_days: options.history_days || [],
        current_message,
        skill_names: options.skill_names || null,
        media: options.media || null,
        channel: options.channel || null,
        chat_id: options.chat_id || null,
        model: options.model,
        max_tokens: options.max_tokens,
        temperature: options.temperature,
        on_stream: options.on_stream,
        abort_signal: options.abort_signal,
      });

      final_content = response.content ?? null;
      if (options.on_turn) {
        await options.on_turn({ state, response, last_content: final_content });
      }

      if (response.has_tool_calls) {
        if (!options.on_tool_calls) {
          state.status = "failed";
          state.terminationReason = "tool_calls_requested_but_handler_missing";
          state.checkShouldContinue = false;
          break;
        }
        const followup = await options.on_tool_calls({
          state,
          tool_calls: response.tool_calls,
          response,
        });
        current_message = followup || "(tool execution completed; continue)";
        this.loops.set(state.loopId, { ...state });
        continue;
      }

      const should_continue = options.check_should_continue
        ? Boolean(await options.check_should_continue({ state, response, last_content: final_content }))
        : false;
      state.checkShouldContinue = should_continue;
      if (!should_continue) {
        state.status = "completed";
        state.terminationReason = "check_should_continue_false";
        break;
      }
      current_message = final_content || options.objective;
      this.loops.set(state.loopId, { ...state });
    }

    if (state.status === "running" && state.currentTurn >= state.maxTurns) {
      state.status = "max_turns_reached";
      state.terminationReason = "max_turns_reached";
      state.checkShouldContinue = false;
    }
    if (state.status === "running" && !state.checkShouldContinue) {
      state.status = "stopped";
      state.terminationReason = state.terminationReason || "stopped";
    }

    this.loops.set(state.loopId, { ...state });
    return { state: { ...state }, final_content };
  }

  async run_task_loop(options: TaskLoopRunOptions): Promise<TaskLoopRunResult> {
    const max_turns = Math.max(1, Number(options.max_turns || 40));
    const existing = this.tasks.get(options.task_id);
    const state: TaskState = existing || {
      taskId: options.task_id,
      title: options.title,
      currentTurn: 0,
      maxTurns: max_turns,
      status: "running",
      currentStep: undefined,
      exitReason: undefined,
      memory: { ...(options.initial_memory || {}) },
    };
    if (!existing) {
      state.memory.__step_index = Number(options.start_step_index || 0);
      this.tasks.set(state.taskId, state);
      await this.persist_task(state);
    }

    while (state.currentTurn < state.maxTurns && state.status === "running") {
      const current_index = Math.max(0, Number(state.memory.__step_index || 0));
      if (current_index >= options.nodes.length) {
        state.status = "completed";
        state.exitReason = "workflow_completed";
        break;
      }

      const node = options.nodes[current_index];
      state.currentTurn += 1;
      state.currentStep = node.id;

      try {
        const result = await node.run({ task_state: state, memory: state.memory });
        if (result.memory_patch) {
          state.memory = { ...state.memory, ...result.memory_patch };
        }
        if (result.current_step) {
          state.currentStep = result.current_step;
        }
        if (result.status && result.status !== "running") {
          state.status = result.status;
          state.exitReason = result.exit_reason || state.exitReason;
        }

        if (state.status === "running") {
          const next_index = result.next_step_index ?? current_index + 1;
          state.memory.__step_index = next_index;
          if (next_index >= options.nodes.length) {
            state.status = "completed";
            state.exitReason = "workflow_completed";
          }
        }
      } catch (error) {
        state.status = "failed";
        state.exitReason = error instanceof Error ? error.message : String(error);
      }

      this.tasks.set(state.taskId, { ...state, memory: { ...state.memory, __updated_at_seoul: now_seoul_iso() } });
      await this.persist_task(state);
      if (options.on_turn) await options.on_turn(state);
      if (state.status === "waiting_approval" || state.status === "failed" || state.status === "cancelled" || state.status === "completed") {
        break;
      }
    }

    if (state.status === "running" && state.currentTurn >= state.maxTurns) {
      state.status = "max_turns_reached";
      state.exitReason = "max_turns_reached";
    }

    this.tasks.set(state.taskId, { ...state, memory: { ...state.memory, __updated_at_seoul: now_seoul_iso() } });
    await this.persist_task(state);
    return { state: { ...state, memory: { ...state.memory } } };
  }

  private async persist_task(task: TaskState): Promise<void> {
    if (!this.task_store) return;
    await this.task_store.upsert(task);
  }
}
