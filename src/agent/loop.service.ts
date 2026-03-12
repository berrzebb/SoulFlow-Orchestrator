import { error_message, now_iso, now_seoul_iso } from "../utils/common.js";
import type { AgentLoopState, TaskState } from "../contracts.js";
import type { Logger } from "../logger.js";
import type { AgentLoopRunOptions, AgentLoopRunResult, TaskLoopRunOptions, TaskLoopRunResult } from "./loop.types.js";
import type { TaskStore } from "./task-store.js";
import { parse_tool_calls_from_text } from "./tool-call-parser.js";
import { ConsecutiveToolCallGuard, type ToolCallGuard } from "./tool-call-guard.js";

const TERMINAL_TASK_STATUSES = new Set(["waiting_approval", "waiting_user_input", "failed", "cancelled", "completed"]);
const MAX_TASK_TURNS = 500;
const MAX_RESUME_COUNT = 3;
const MAX_MAILBOX_SIZE = 1000;

export type CascadeCancelFn = (parent_id: string) => void;

export class AgentLoopStore {
  private readonly loops = new Map<string, AgentLoopState>();
  private readonly tasks = new Map<string, TaskState>();
  private readonly task_store: TaskStore | null;
  private readonly logger: Logger | null;
  private readonly on_cascade_cancel?: CascadeCancelFn;
  private readonly on_task_change?: (task: TaskState) => void;
  private session_id = "";
  private readonly loop_mailbox = new Map<string, string[]>();

  constructor(options?: { task_store?: TaskStore | null; logger?: Logger | null; on_cascade_cancel?: CascadeCancelFn; on_task_change?: (task: TaskState) => void }) {
    this.task_store = options?.task_store || null;
    this.logger = options?.logger || null;
    this.on_cascade_cancel = options?.on_cascade_cancel;
    this.on_task_change = options?.on_task_change;
  }

  set_session_id(id: string): void { this.session_id = id; }

  private save_loop_snapshot(state: AgentLoopState): void {
    this.loops.set(state.loopId, { ...state });
  }

  private async save_task_snapshot(state: TaskState): Promise<void> {
    state.memory = { ...state.memory, __updated_at_seoul: now_seoul_iso(), __session_id: this.session_id || undefined };
    this.tasks.set(state.taskId, { ...state });
    this.logger?.info("task_snapshot", { task_id: state.taskId, status: state.status, turn: state.currentTurn, exit: state.exitReason || null });
    await this.persist_task(state);
    try { this.on_task_change?.({ ...state }); } catch { /* SSE 실패가 실행을 차단하면 안 됨 */ }
  }

  async initialize(): Promise<void> {
    if (!this.task_store) return;
    const rows = await this.task_store.list();
    for (const task of rows) this.tasks.set(task.taskId, task);

    if (!this.session_id) return;
    const orphaned = await this.recover_orphaned_tasks();
    if (orphaned.length > 0) {
      this.logger?.info("recovered_orphaned_tasks", { count: orphaned.length, ids: orphaned.map((t) => t.taskId) });
    }
  }

  /** 이전 세션에서 running 상태로 남은 고아 작업을 정리. task-mode는 resume 가능하게, adhoc은 실패 처리. */
  private async recover_orphaned_tasks(): Promise<TaskState[]> {
    const recovered: TaskState[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== "running") continue;
      const task_session = task.memory.__session_id as string | undefined;
      if (task_session === this.session_id) continue;

      if (task.taskId.startsWith("task:")) {
        task.status = "waiting_user_input";
        task.exitReason = "session_expired";
        task.memory.__interrupted = true;
      } else {
        task.status = "failed";
        task.exitReason = "session_expired";
      }

      this.tasks.set(task.taskId, task);
      await this.persist_task(task);
      try { this.on_task_change?.({ ...task }); } catch { /* broadcast 실패가 복구를 차단하면 안 됨 */ }
      recovered.push(task);
    }
    return recovered;
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
    this.on_cascade_cancel?.(loop_id);
    return state;
  }

  /** 실행 중인 루프에 외부 메시지 주입. 다음 턴에서 소비된다. 상한 초과 시 가장 오래된 메시지를 폐기. */
  inject_message(loop_id: string, message: string): boolean {
    const loop_state = this.loops.get(loop_id);
    if (!loop_state || loop_state.status !== "running") return false;
    const queue = this.loop_mailbox.get(loop_id) || [];
    queue.push(message);
    while (queue.length > MAX_MAILBOX_SIZE) queue.shift();
    this.loop_mailbox.set(loop_id, queue);
    return true;
  }

  /** 지정 루프의 대기 메시지를 모두 꺼내고 큐를 비운다. */
  drain_mailbox(loop_id: string): string[] {
    const msgs = this.loop_mailbox.get(loop_id) || [];
    if (msgs.length > 0) this.loop_mailbox.delete(loop_id);
    return msgs;
  }

  /** waiting_approval/waiting_user_input 상태에서 TTL을 초과한 작업을 자동 취소. 이미 종료된 엔트리도 Map에서 제거. */
  expire_stale_tasks(ttl_ms = 600_000): TaskState[] {
    const now = Date.now();
    const expired: TaskState[] = [];
    const terminal_to_remove: string[] = [];

    for (const [id, state] of this.tasks) {
      const updated = state.memory?.__updated_at_seoul as string | undefined;
      const updated_ms = updated ? new Date(updated).getTime() : 0;

      // 이미 종료된 작업 — DB에 persist 완료됐으므로 메모리에서 제거
      if (state.status === "completed" || state.status === "cancelled") {
        if (updated_ms && !Number.isNaN(updated_ms) && now - updated_ms > ttl_ms) {
          terminal_to_remove.push(id);
        }
        continue;
      }

      if (state.status !== "waiting_approval" && state.status !== "waiting_user_input") continue;
      if (!updated_ms || Number.isNaN(updated_ms) || now - updated_ms < ttl_ms) continue;
      state.status = "cancelled";
      state.exitReason = "expired_stale";
      this.tasks.set(id, state);
      this.persist_task(state).catch((e) => {
        this.logger?.error("expire_stale persist failed", { task_id: id, error: error_message(e) });
      });
      try { this.on_task_change?.({ ...state }); } catch { /* broadcast 실패가 만료 처리를 차단하면 안 됨 */ }
      expired.push(state);
    }

    for (const id of terminal_to_remove) this.tasks.delete(id);

    // 종료된 루프도 정리
    for (const [id, loop] of this.loops) {
      if (loop.status === "stopped" || loop.status === "failed") {
        this.loops.delete(id);
        this.loop_mailbox.delete(id);
      }
    }

    return expired;
  }

  async cancel_task(task_id: string, reason = "cancelled_by_request"): Promise<TaskState | null> {
    const state = this.tasks.get(task_id) ?? await this.task_store?.get(task_id) ?? null;
    if (!state) return null;
    this.logger?.info("task_cancel", { task_id, reason });
    state.status = "cancelled";
    state.exitReason = reason;
    this.tasks.set(task_id, state);
    this.on_cascade_cancel?.(task_id);
    this.persist_task(state).catch((e) => {
      this.logger?.error("cancel_task persist failed", { task_id, error: error_message(e) });
    });
    try { this.on_task_change?.({ ...state }); } catch { /* broadcast 실패가 취소를 차단하면 안 됨 */ }
    return state;
  }

  async resume_task(task_id: string, user_input?: string, reason = "resumed", channel_context?: { channel: string; chat_id: string }): Promise<TaskState | null> {
    const state = this.tasks.get(task_id) ?? await this.task_store?.get(task_id) ?? null;
    if (!state) return null;
    if (state.status === "completed" || state.status === "cancelled") return state;

    // 채널 정보 복원: 핫 리로드 등으로 유실된 경우 현재 요청의 채널 정보로 재연결
    if (channel_context) {
      if (!state.channel && channel_context.channel) {
        state.channel = channel_context.channel;
        state.memory.channel = channel_context.channel;
      }
      if (!state.chatId && channel_context.chat_id) {
        state.chatId = channel_context.chat_id;
        state.memory.chat_id = channel_context.chat_id;
      }
    }

    // 무한 재시도 방지: MAX_RESUME_COUNT 초과 시 강제 종료
    const resume_count = Number(state.memory.__resume_count || 0) + 1;
    if (resume_count > MAX_RESUME_COUNT) {
      this.logger?.warn("task_resume_max_exceeded", { task_id, resume_count, reason });
      state.status = "cancelled";
      state.exitReason = "max_resume_exceeded";
      this.tasks.set(task_id, state);
      await this.persist_task(state);
      return state;
    }
    state.memory.__resume_count = resume_count;

    if (state.currentTurn >= state.maxTurns) {
      const extend_by = Math.max(1, Math.ceil(Math.max(1, state.maxTurns) * 0.25));
      state.maxTurns = Math.min(state.currentTurn + extend_by, MAX_TASK_TURNS);
    }
    if (user_input !== undefined) {
      state.memory.__user_input = user_input;
      state.memory.__resumed_at = now_iso();
    }
    state.status = "running";
    state.exitReason = reason;
    this.logger?.info("task_resume", { task_id, reason, resume_count, has_input: user_input !== undefined });
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
    const tool_call_guard: ToolCallGuard = new ConsecutiveToolCallGuard(2);

    // Compaction flush 상태 — 1 compaction 주기당 최대 1회
    let compaction_flushed = false;
    const flush_cfg = options.compaction_flush;
    const flush_trigger = flush_cfg
      ? flush_cfg.context_window - (flush_cfg.reserve_floor ?? 20_000) - (flush_cfg.soft_threshold ?? 4_000)
      : Infinity;

    while (state.currentTurn < state.maxTurns && state.checkShouldContinue) {
      if (options.abort_signal?.aborted) {
        state.status = "stopped";
        state.terminationReason = "aborted";
        state.checkShouldContinue = false;
        break;
      }
      state.currentTurn += 1;
      const response = await options.providers.run_headless_with_context({
        context_builder: options.context_builder,
        tools: options.tools,
        runtime_policy: options.runtime_policy,
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
        on_stream_event: options.on_stream_event,
        abort_signal: options.abort_signal,
      });

      final_content = response.content ?? null;

      // Compaction flush: 토큰 사용량이 임계점 도달 시 메모리 저장
      if (!compaction_flushed && flush_cfg && (response.usage?.prompt_tokens ?? 0) >= flush_trigger) {
        compaction_flushed = true;
        try { await flush_cfg.flush(); } catch (e) {
          this.logger?.warn("compaction_flush_failed", { loop_id: state.loopId, error: error_message(e) });
        }
      }

      if (options.on_turn) {
        await options.on_turn({ state, response, last_content: final_content });
      }

      const effective_tool_calls = response.has_tool_calls
        ? response.tool_calls
        : parse_tool_calls_from_text(final_content);

      if (effective_tool_calls.length > 0) {
        const guard = tool_call_guard.observe(effective_tool_calls);
        if (guard.blocked) {
          state.status = "failed";
          state.terminationReason = guard.reason || "tool_calls_guard_blocked";
          state.checkShouldContinue = false;
          final_content = [
            "동일한 도구 호출이 반복되어 작업을 중단했습니다.",
            "요청을 더 구체화하거나 필요한 도구/입력을 명시한 뒤 다시 시도해주세요.",
          ].join("\n");
          break;
        }
        if (!options.on_tool_calls) {
          state.status = "failed";
          state.terminationReason = "tool_calls_requested_but_handler_missing";
          state.checkShouldContinue = false;
          break;
        }
        const followup = await options.on_tool_calls({
          state,
          tool_calls: effective_tool_calls,
          response,
        });
        const injected_after_tool = this.drain_mailbox(state.loopId);
        const followup_parts = [followup || "(tool execution completed; continue)", ...injected_after_tool];
        current_message = followup_parts.join("\n\n");
        this.save_loop_snapshot(state);
        continue;
      }
      tool_call_guard.reset();

      const injected_text_turn = this.drain_mailbox(state.loopId);
      if (injected_text_turn.length > 0) {
        current_message = injected_text_turn.join("\n\n");
        this.save_loop_snapshot(state);
        continue;
      }

      const continue_result = options.check_should_continue
        ? await options.check_should_continue({ state, response, last_content: final_content })
        : false;
      const should_continue = typeof continue_result === "string" ? continue_result.length > 0 : Boolean(continue_result);
      state.checkShouldContinue = should_continue;
      if (!should_continue) {
        state.status = "completed";
        state.terminationReason = "check_should_continue_false";
        break;
      }
      current_message = typeof continue_result === "string"
        ? continue_result
        : (final_content || options.objective);
      this.save_loop_snapshot(state);
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

    this.save_loop_snapshot(state);
    return { state: { ...state }, final_content };
  }

  async run_task_loop(options: TaskLoopRunOptions): Promise<TaskLoopRunResult> {
    const max_turns = Math.max(1, Number(options.max_turns || 40));
    const existing = this.tasks.get(options.task_id);
    const state: TaskState = existing || {
      taskId: options.task_id,
      title: options.title,
      objective: options.objective,
      channel: options.channel,
      chatId: options.chat_id,
      currentTurn: 0,
      maxTurns: max_turns,
      status: "running",
      currentStep: undefined,
      exitReason: undefined,
      memory: { ...(options.initial_memory || {}) },
    };
    // 기존 TaskState의 channel/chatId가 빈 경우 options 값으로 복원 (핫 리로드 후 DB 복원 시 유실 대응)
    if (!state.channel && options.channel) state.channel = options.channel;
    if (!state.chatId && options.chat_id) state.chatId = options.chat_id;
    if (!existing) {
      state.memory.__step_index = Number(options.start_step_index || 0);
      this.tasks.set(state.taskId, state);
      await this.persist_task(state);
    } else if (Number(state.memory.__step_index || 0) >= options.nodes.length) {
      // 재개 시 노드 배열이 축소된 경우 (continue_task_loop: 1노드 vs 원래 3노드)
      // __step_index가 범위를 벗어나면 0으로 리셋하여 즉시 completed 방지
      state.memory.__step_index = 0;
    }
    this.logger?.info("task_loop_start", { task_id: state.taskId, title: state.title, max_turns: state.maxTurns, node_count: options.nodes.length, channel: state.channel });

    while (state.currentTurn < state.maxTurns && state.status === "running") {
      if (options.abort_signal?.aborted) {
        state.status = "cancelled";
        state.exitReason = "aborted";
        break;
      }
      const injected_task = this.drain_mailbox(state.taskId);
      if (injected_task.length > 0) {
        state.memory.__injected_message = injected_task.join("\n\n");
      }
      const current_index = Math.max(0, Number(state.memory.__step_index || 0));
      if (current_index >= options.nodes.length) {
        state.status = "completed";
        state.exitReason = "workflow_completed";
        break;
      }

      const node = options.nodes[current_index];
      state.currentTurn += 1;
      state.currentStep = node.id;
      this.logger?.debug("task_node_start", { task_id: state.taskId, turn: state.currentTurn, node_id: node.id });

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
        state.exitReason = error_message(error);
        this.logger?.error("task_node_failed", { task_id: state.taskId, turn: state.currentTurn, node_id: state.currentStep, error: state.exitReason });
      }

      await this.save_task_snapshot(state);
      if (options.on_turn) await options.on_turn(state);
      if (TERMINAL_TASK_STATUSES.has(state.status)) break;
    }

    if (state.status === "running" && state.currentTurn >= state.maxTurns) {
      state.status = "max_turns_reached";
      state.exitReason = "max_turns_reached";
    }

    await this.save_task_snapshot(state);
    this.logger?.info("task_loop_end", { task_id: state.taskId, status: state.status, exit_reason: state.exitReason, turns: state.currentTurn });
    return { state: { ...state, memory: { ...state.memory } } };
  }

  private async persist_task(task: TaskState): Promise<void> {
    if (!this.task_store) return;
    await this.task_store.upsert(task);
  }
}
