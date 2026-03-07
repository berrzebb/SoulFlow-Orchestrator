/**
 * Phase Loop Runner — 페이즈 순차 실행, 페이즈 내 에이전트 병렬 실행, critic 리뷰.
 * SubagentRegistry.spawn() + wait_for_completion()으로 병렬 실행.
 */

import { now_iso, error_message } from "../utils/common.js";
import type { Logger } from "../logger.js";
import type { SubagentRegistry } from "./subagents.js";
import type { PhaseWorkflowStoreLike } from "./phase-workflow-store.js";
import type {
  PhaseLoopState,
  PhaseLoopRunOptions,
  PhaseLoopRunResult,
  PhaseState,
  PhaseAgentState,
  PhaseCriticState,
  PhaseDefinition,
  PhaseAgentDefinition,
  PhaseMessage,
  PhaseLoopEvent,
  CriticReview,
} from "./phase-loop.types.js";
import {
  normalize_workflow,
  is_orche_node,
  node_to_phase,
  type PhaseNodeDefinition,
  type IfNodeDefinition,
  type SwitchNodeDefinition,
} from "./workflow-node.types.js";
import { execute_orche_node, apply_preset } from "./orche-node-executor.js";
import { get_node_handler, type RunnerContext } from "./node-registry.js";
import {
  create_worktree,
  create_isolated_directory,
  merge_worktrees,
  cleanup_worktrees,
  type WorktreeHandle,
} from "./worktree.js";

export type PhaseLoopRunnerDeps = {
  subagents: SubagentRegistry;
  store: PhaseWorkflowStoreLike;
  logger: Logger;
  on_event?: (event: PhaseLoopEvent) => void;
  /** 워크플로우 템플릿 로더 (sub_workflow 노드용). */
  load_template?: (name: string) => import("./phase-loop.types.js").WorkflowDefinition | null;
  /** LLM provider 레지스트리 (llm, analyzer 노드용). */
  providers?: import("../providers/service.js").ProviderRegistry | null;
  /** DecisionService (decision 노드용). */
  decision_service?: import("../decision/service.js").DecisionService | null;
  /** PromiseService (promise 노드용). */
  promise_service?: import("../decision/promise.service.js").PromiseService | null;
  /** 텍스트 → 벡터 (embedding 노드용). */
  embed?: (texts: string[], opts: { model?: string; dimensions?: number }) => Promise<{ embeddings: number[][]; token_usage?: number }>;
  /** 벡터 스토어 CRUD (vector_store 노드용). */
  vector_store?: (op: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** OAuth HTTP fetch (oauth 노드용). */
  oauth_fetch?: (service_id: string, opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown }) => Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  /** Webhook 수신 데이터 조회 (webhook 노드용). */
  get_webhook_data?: (path: string) => Promise<{ method: string; headers: Record<string, string>; body: unknown; query: Record<string, string> } | null>;
  /** 칸반 이벤트 대기 (kanban_trigger 노드용). */
  wait_kanban_event?: (board_id: string, filter: { actions?: string[]; column_id?: string }) => Promise<{ card_id: string; board_id: string; action: string; actor: string; detail: Record<string, unknown>; created_at: string } | null>;
  /** 태스크 생성/실행 (task 노드용). */
  create_task?: (opts: { title: string; objective: string; channel?: string; chat_id?: string; max_turns?: number; initial_memory?: Record<string, unknown> }) => Promise<{ task_id: string; status: string; result?: unknown; error?: string }>;
  /** DB 쿼리 (db 노드용). */
  query_db?: (datasource: string, query: string, params?: Record<string, unknown>) => Promise<{ rows: unknown[]; affected_rows: number }>;
  /** kanban_trigger waiting 전환 시 즉시 알림 (watcher 30초 지연 제거). */
  on_kanban_trigger_waiting?: (workflow_id: string) => void;
};

/** 페이즈 루프 메인 실행 함수. */
export async function run_phase_loop(
  options: PhaseLoopRunOptions,
  deps: PhaseLoopRunnerDeps,
): Promise<PhaseLoopRunResult> {
  const { subagents, store, logger, on_event } = deps;

  // 통합 노드 배열 정규화 (nodes[] 또는 phases[] → WorkflowNodeDefinition[])
  const normalized = normalize_workflow(options);
  const all_nodes = normalized.nodes;
  const phase_defs = normalized.phase_defs;

  // resume: 기존 state가 있으면 재사용, 없으면 새로 생성
  const is_resume = !!options.resume_state;
  const state: PhaseLoopState = options.resume_state
    ? { ...options.resume_state, status: "running", updated_at: now_iso() }
    : {
        workflow_id: options.workflow_id,
        title: options.title,
        objective: options.objective,
        channel: options.channel,
        chat_id: options.chat_id,
        status: "running",
        current_phase: 0,
        phases: phase_defs.map((p) => build_initial_phase_state(p)),
        orche_states: all_nodes.filter(is_orche_node).map((n) => ({
          node_id: n.node_id,
          node_type: n.node_type,
          status: "pending" as const,
        })),
        memory: { ...(options.initial_memory || {}) },
        created_at: now_iso(),
        updated_at: now_iso(),
        definition: {
          title: options.title,
          objective: options.objective,
          phases: phase_defs,
          nodes: options.nodes,
          field_mappings: options.field_mappings,
        },
      };

  await store.upsert(state);
  emit(on_event, { type: "workflow_started", workflow_id: state.workflow_id });
  logger.info("phase_loop_start", { workflow_id: state.workflow_id, nodes: all_nodes.length, phases: state.phases.length, resume: is_resume });

  /** goto 루프 카운터: phase_id별 goto 횟수 추적. */
  const goto_counts = new Map<string, number>();
  /** IF 분기에 의해 스킵된 노드 ID 집합. */
  const skipped_nodes = new Set<string>();

  // resume 시 이미 완료된 노드를 추적 (skip 대상)
  const completed_node_ids = new Set<string>();
  if (is_resume && state.orche_states) {
    for (const os of state.orche_states) {
      if (os.status === "completed" || os.status === "skipped") {
        completed_node_ids.add(os.node_id);
      }
    }
  }
  if (is_resume) {
    for (const ps of state.phases) {
      if (ps.status === "completed") completed_node_ids.add(ps.phase_id);
    }
  }

  try {
    let node_idx = 0;
    while (node_idx < all_nodes.length) {
      if (options.abort_signal?.aborted) {
        state.status = "cancelled";
        break;
      }

      const node = all_nodes[node_idx]!;

      // resume 시 이미 완료된 노드 skip
      if (completed_node_ids.has(node.node_id)) {
        emit(on_event, { type: "node_skipped", workflow_id: state.workflow_id, node_id: node.node_id, reason: "already_completed" });
        node_idx++;
        continue;
      }

      // IF 분기에 의해 스킵된 노드
      if (skipped_nodes.has(node.node_id)) {
        if (is_orche_node(node)) {
          const os = state.orche_states?.find((s) => s.node_id === node.node_id);
          if (os) os.status = "skipped";
          emit(on_event, { type: "node_skipped", workflow_id: state.workflow_id, node_id: node.node_id, reason: "if_branch_inactive" });
        }
        node_idx++;
        continue;
      }

      // depends_on 검사: 의존 노드가 모두 완료(또는 스킵)될 때까지 대기
      if (node.depends_on?.length) {
        const unmet = node.depends_on.filter((dep_id) => {
          if (skipped_nodes.has(dep_id)) return false; // 스킵된 노드는 해결됨으로 취급
          const phase_dep = state.phases.find((p) => p.phase_id === dep_id);
          if (phase_dep) return phase_dep.status !== "completed";
          const orche_dep = state.orche_states?.find((s) => s.node_id === dep_id);
          if (orche_dep) return orche_dep.status !== "completed" && orche_dep.status !== "skipped";
          return true;
        });
        if (unmet.length > 0) {
          node_idx++;
          continue;
        }
      }

      // ── 오케스트레이션 노드 실행 ──
      if (is_orche_node(node)) {
        const orche_state = state.orche_states?.find((s) => s.node_id === node.node_id);
        if (orche_state?.status === "completed" || orche_state?.status === "skipped") {
          node_idx++;
          continue;
        }

        if (orche_state) {
          orche_state.status = "running";
          orche_state.started_at = now_iso();
        }
        emit(on_event, { type: "node_started", workflow_id: state.workflow_id, node_id: node.node_id, node_type: node.node_type });

        try {
          // preset_id 적용 → runner_execute 또는 기본 executor
          const resolved = apply_preset(node);
          const handler = get_node_handler(resolved.node_type);
          const exec_ctx = { memory: state.memory, abort_signal: options.abort_signal, workspace: options.workspace };
          const runner_ctx: RunnerContext = {
            state, options, logger,
            emit: (evt) => emit(on_event, evt),
            all_nodes, skipped_nodes,
            execute_node: async (n, ctx) => {
              const r = apply_preset(n);
              const h = get_node_handler(r.node_type);
              if (h?.runner_execute) return h.runner_execute(r, ctx, runner_ctx);
              return execute_orche_node(r, ctx);
            },
            run_sub_workflow: deps.load_template
              ? async (workflow_name, input) => {
                  const def = deps.load_template!(workflow_name);
                  if (!def) throw new Error(`sub_workflow template '${workflow_name}' not found`);
                  const sub_result = await run_phase_loop({
                    workflow_id: `${state.workflow_id}__sub_${workflow_name}_${Date.now()}`,
                    title: def.title,
                    objective: def.objective || "",
                    channel: options.channel,
                    chat_id: options.chat_id,
                    phases: def.phases || [],
                    nodes: def.nodes,
                    initial_memory: { ...input },
                    workspace: options.workspace,
                    abort_signal: options.abort_signal,
                    send_message: options.send_message,
                    ask_channel: options.ask_channel,
                    invoke_tool: options.invoke_tool,
                  }, deps);
                  return { result: sub_result.memory, phases: sub_result.phases };
                }
              : undefined,
            services: build_runner_services(deps, state, subagents),
          };
          const result = handler?.runner_execute
            ? await handler.runner_execute(resolved, exec_ctx, runner_ctx)
            : await execute_orche_node(resolved, exec_ctx);
          state.memory[node.node_id] = result.output;

          // field_mappings 적용: 현재 노드의 출력 필드를 타겟 노드 메모리에 매핑
          if (options.field_mappings?.length) {
            apply_field_mappings(state.memory, node.node_id, result.output, options.field_mappings);
          }

          // IF 분기 스킵 처리
          if (node.node_type === "if" && result.branch) {
            const if_node = node as IfNodeDefinition;
            const inactive = result.branch === "true" ? if_node.outputs.false_branch : if_node.outputs.true_branch;
            for (const skip_id of inactive) skipped_nodes.add(skip_id);
          }

          // Switch 분기 스킵 처리: 매칭되지 않은 case의 targets를 스킵
          if (node.node_type === "switch" && result.branch) {
            const sw = node as SwitchNodeDefinition;
            const matched = sw.cases?.find((c) => c.value === result.branch);
            const active_targets = new Set(matched ? matched.targets : (sw.default_targets || []));
            const all_targets = new Set<string>();
            for (const c of sw.cases || []) for (const t of c.targets) all_targets.add(t);
            for (const t of sw.default_targets || []) all_targets.add(t);
            for (const t of all_targets) {
              if (!active_targets.has(t)) skipped_nodes.add(t);
            }
          }

          // waiting 시그널: trigger 노드가 이벤트 대기 상태 → 워크플로우 일시 중단
          const is_waiting = result.output && typeof result.output === "object" && !Array.isArray(result.output) && (result.output as Record<string, unknown>).waiting === true;
          if (is_waiting) {
            if (orche_state) {
              orche_state.status = "pending";
              orche_state.result = result.output;
            }
            // P0-6: trigger 메타를 memory에 기록 → 영속 watcher가 resume 시 활용
            if ((node as unknown as Record<string, unknown>).node_type === "kanban_trigger") {
              const tn = node as unknown as Record<string, unknown>;
              state.memory.__pending_kanban_trigger = {
                node_id: tn.node_id,
                board_id: tn.kanban_board_id,
                actions: tn.kanban_actions,
                column_id: tn.kanban_column_id,
              };
            }
            state.status = "waiting_user_input";
            state.updated_at = now_iso();
            await store.upsert(state);
            emit(on_event, { type: "node_waiting", workflow_id: state.workflow_id, node_id: node.node_id, node_type: node.node_type, reason: "trigger_timeout" });
            if (state.memory.__pending_kanban_trigger) {
              deps.on_kanban_trigger_waiting?.(state.workflow_id);
            }
            break;
          }

          if (orche_state) {
            orche_state.status = "completed";
            orche_state.result = result.output;
            orche_state.completed_at = now_iso();
          }
          const preview = typeof result.output === "string" ? result.output.slice(0, 200) : JSON.stringify(result.output).slice(0, 200);
          emit(on_event, { type: "node_completed", workflow_id: state.workflow_id, node_id: node.node_id, node_type: node.node_type, output_preview: preview });
        } catch (err) {
          if (orche_state) {
            orche_state.status = "failed";
            orche_state.error = error_message(err);
          }
          logger.warn("orche_node_error", { node_id: node.node_id, node_type: node.node_type, error: error_message(err) });
          // 오케스트레이션 노드 실패 → 워크플로우 실패
          state.status = "failed";
          state.updated_at = now_iso();
          await store.upsert(state);
          break;
        }

        state.updated_at = now_iso();
        await store.upsert(state);
        node_idx++;
        continue;
      }

      // ── Phase(Agent) 노드 실행 ──
      const phase_node = node as PhaseNodeDefinition;
      const phase_def = node_to_phase(phase_node);
      const phase_idx = state.phases.findIndex((p) => p.phase_id === phase_def.phase_id);
      if (phase_idx < 0) { node_idx++; continue; }

      state.current_phase = phase_idx;
      const phase_state = state.phases[phase_idx]!;

      // 이미 완료된 Phase는 스킵
      if (phase_state.status === "completed") {
        node_idx++;
        continue;
      }

      // 이전 Phase 결과를 컨텍스트로 구성
      const prev_phase_idx = phase_idx > 0 ? phase_idx - 1 : -1;
      const prev_context = prev_phase_idx >= 0 ? build_phase_context(state.phases[prev_phase_idx]!, phase_def.context_template) : "";

      // 페이즈 실행
      phase_state.status = "running";
      state.updated_at = now_iso();
      await store.upsert(state);
      emit(on_event, { type: "phase_started", workflow_id: state.workflow_id, phase_id: phase_def.phase_id });
      options.on_phase_change?.(state);

      // 모드에 따른 실행 분기
      const mode = phase_def.mode || "parallel";
      const agent_deps: AgentRunDeps = { subagents, store, logger, on_event, options };

      if (mode === "interactive") {
        await run_looping_phase(state, phase_def, phase_state, prev_context, agent_deps, INTERACTIVE_CONFIG);
        phase_state.status = "completed";
        state.updated_at = now_iso();
        merge_phase_results_to_memory(state, phase_state);
        await store.upsert(state);
        emit(on_event, { type: "phase_completed", workflow_id: state.workflow_id, phase_id: phase_def.phase_id });
        options.on_phase_change?.(state);
        node_idx++;
        continue;
      }

      if (mode === "sequential_loop") {
        await run_looping_phase(state, phase_def, phase_state, prev_context, agent_deps, SEQUENTIAL_LOOP_CONFIG);
      }

      // parallel 또는 sequential_loop 후
      const agent_results = mode === "sequential_loop"
        ? phase_state.agents
        : await run_phase_agents(
            state, phase_def, phase_state, prev_context,
            agent_deps,
          );

      // 실패 정책 평가
      const failed_count = agent_results.filter((r) => r.status === "failed").length;
      const success_count = agent_results.length - failed_count;
      const policy = phase_def.failure_policy || "best_effort";

      if (policy === "fail_fast" && failed_count > 0) {
        phase_state.status = "failed";
        state.status = "failed";
        state.updated_at = now_iso();
        await store.upsert(state);
        break;
      }
      if (policy === "quorum" && success_count < (phase_def.quorum_count ?? 1)) {
        phase_state.status = "failed";
        state.status = "failed";
        state.updated_at = now_iso();
        await store.upsert(state);
        break;
      }

      // Critic 리뷰 (선택적)
      if (phase_def.critic) {
        const max_retries = phase_def.critic.max_retries ?? 1;
        let retries = 0;
        let critic_passed = false;

        while (!critic_passed) {
          phase_state.status = "reviewing";
          state.updated_at = now_iso();
          await store.upsert(state);

          const critic_result = await run_critic(
            state, phase_def, phase_state,
            { subagents, store, logger, on_event },
          );

          if (critic_result.approved || !phase_def.critic.gate) {
            critic_passed = true;
            break;
          }

          // gate=true && rejected
          const rejection_policy = phase_def.critic.on_rejection || "escalate";
          retries++;

          // goto: 특정 Phase로 점프 (되돌리기)
          if (rejection_policy === "goto" && phase_def.critic.goto_phase) {
            const goto_key = `${phase_def.phase_id}->${phase_def.critic.goto_phase}`;
            const count = (goto_counts.get(goto_key) || 0) + 1;
            goto_counts.set(goto_key, count);

            if (count > max_retries) {
              // max_retries 초과 → escalate로 폴백
              state.status = "waiting_user_input";
              state.updated_at = now_iso();
              await store.upsert(state);
              logger.info("phase_loop_goto_exhausted", { workflow_id: state.workflow_id, phase_id: phase_def.phase_id, goto_phase: phase_def.critic.goto_phase, count });
              return build_result(state);
            }

            const target_idx = phase_defs.findIndex((p) => p.phase_id === phase_def.critic!.goto_phase);
            if (target_idx < 0) {
              logger.warn("phase_loop_goto_not_found", { goto_phase: phase_def.critic.goto_phase });
              critic_passed = true;
              break;
            }

            logger.info("phase_loop_goto", { workflow_id: state.workflow_id, from: phase_def.phase_id, to: phase_def.critic.goto_phase, attempt: count });
            emit(on_event, { type: "phase_goto", workflow_id: state.workflow_id, from_phase: phase_def.phase_id, to_phase: phase_def.critic.goto_phase, reason: critic_result.summary.slice(0, 200) });

            // 대상 Phase부터 현재 Phase까지 상태 리셋
            for (let j = target_idx; j <= phase_idx; j++) {
              reset_phase_state(state.phases[j]);
            }

            // goto 대상의 node_idx를 찾아 점프
            const goto_node_idx = all_nodes.findIndex((n) => n.node_id === phase_def.critic!.goto_phase);
            if (goto_node_idx >= 0) node_idx = goto_node_idx;
            break; // critic 루프 탈출 → while 루프에서 goto 대상부터 재실행
          }

          if (rejection_policy === "escalate" || retries > max_retries) {
            state.status = "waiting_user_input";
            state.updated_at = now_iso();
            await store.upsert(state);
            logger.info("phase_loop_escalate", { workflow_id: state.workflow_id, phase_id: phase_def.phase_id, retries });
            return build_result(state);
          }

          // retry_all: 전체 에이전트 재실행 (critic 피드백 주입)
          if (rejection_policy === "retry_all") {
            logger.info("phase_loop_retry_all", { workflow_id: state.workflow_id, phase_id: phase_def.phase_id, retry: retries });
            const feedback_context = `\n\n[system] The critic provided the following feedback on your previous attempt:\n---\n${critic_result.summary}\n---\nPlease improve your work incorporating this feedback.`;
            phase_state.status = "running";
            for (const a of phase_state.agents) { a.status = "pending"; a.result = undefined; a.error = undefined; a.subagent_id = undefined; }
            state.updated_at = now_iso();
            await store.upsert(state);
            await run_phase_agents(
              state, phase_def, phase_state, prev_context + feedback_context,
              { subagents, store, logger, on_event, options },
            );
            continue;
          }

          // retry_targeted: critic이 지적한 에이전트만 재실행
          if (rejection_policy === "retry_targeted") {
            logger.info("phase_loop_retry_targeted", { workflow_id: state.workflow_id, phase_id: phase_def.phase_id, retry: retries });
            const feedback_context = `\n\n[system] The critic rejected your output:\n---\n${critic_result.summary}\n---\nPlease improve.`;
            phase_state.status = "running";
            const low_quality_ids = critic_result.agent_reviews
              ?.filter((r) => r.quality !== "good")
              .map((r) => r.agent_id) ?? [];
            const retry_agents = low_quality_ids.length > 0
              ? phase_state.agents.filter((a) => low_quality_ids.includes(a.agent_id))
              : phase_state.agents.filter((a) => a.status === "failed" || a.result === undefined);
            const retry_defs = phase_def.agents.filter((d) => retry_agents.some((a) => a.agent_id === d.agent_id));
            if (retry_defs.length === 0) { critic_passed = true; break; }

            for (const a of retry_agents) { a.status = "pending"; a.result = undefined; a.error = undefined; a.subagent_id = undefined; }
            state.updated_at = now_iso();
            await store.upsert(state);

            const partial_def: PhaseDefinition = { ...phase_def, agents: retry_defs };
            await run_phase_agents(
              state, partial_def, phase_state, prev_context + feedback_context,
              { subagents, store, logger, on_event, options },
            );
            continue;
          }
        }

        // goto로 인해 critic 루프를 탈출한 경우 → node_idx가 이미 변경됨
        if (!critic_passed) continue;
      }

      // 페이즈 완료
      phase_state.status = "completed";
      state.updated_at = now_iso();
      merge_phase_results_to_memory(state, phase_state);
      await store.upsert(state);
      emit(on_event, { type: "phase_completed", workflow_id: state.workflow_id, phase_id: phase_def.phase_id });
      options.on_phase_change?.(state);
      node_idx++;
    }

    // 워크플로우 완료
    if (state.status === "running") {
      state.status = "completed";
      state.updated_at = now_iso();
      await store.upsert(state);
      emit(on_event, { type: "workflow_completed", workflow_id: state.workflow_id });
    }
  } catch (err) {
    state.status = "failed";
    state.updated_at = now_iso();
    await store.upsert(state);
    const msg = error_message(err);
    emit(on_event, { type: "workflow_failed", workflow_id: state.workflow_id, error: msg });
    logger.error("phase_loop_error", { workflow_id: state.workflow_id, error: msg });
    return { ...build_result(state), error: msg };
  }

  logger.info("phase_loop_end", { workflow_id: state.workflow_id, status: state.status });
  return build_result(state);
}

// ── 에이전트 병렬 실행 ──────────────────────────────

type AgentRunDeps = {
  subagents: SubagentRegistry;
  store: PhaseWorkflowStoreLike;
  logger: Logger;
  on_event?: (event: PhaseLoopEvent) => void;
  options: PhaseLoopRunOptions;
};

async function run_phase_agents(
  state: PhaseLoopState,
  phase_def: PhaseDefinition,
  phase_state: PhaseState,
  prev_context: string,
  deps: AgentRunDeps,
): Promise<PhaseAgentState[]> {
  const { subagents, store, logger, on_event, options } = deps;

  // 격리 준비: worktree/directory 핸들 수집
  const worktree_handles: WorktreeHandle[] = [];
  const isolation_paths = new Map<string, string>();
  const ws = options.workspace;
  if (!ws) throw new Error("workspace is required for phase agent execution");

  for (const agent_def of phase_def.agents) {
    const isolation = agent_def.filesystem_isolation || "none";
    if (isolation === "worktree") {
      const handle = await create_worktree({
        workspace: ws,
        workflow_id: state.workflow_id,
        agent_id: agent_def.agent_id,
      });
      if (handle) {
        worktree_handles.push(handle);
        isolation_paths.set(agent_def.agent_id, handle.path);
        logger.debug("worktree_created", { agent_id: agent_def.agent_id, path: handle.path, branch: handle.branch });
      } else {
        logger.warn("worktree_create_failed", { agent_id: agent_def.agent_id });
      }
    } else if (isolation === "directory") {
      const dir = await create_isolated_directory({
        workspace: ws,
        workflow_id: state.workflow_id,
        agent_id: agent_def.agent_id,
      });
      isolation_paths.set(agent_def.agent_id, dir);
    }
  }

  const promises = phase_def.agents.map(async (agent_def, idx) => {
    const agent_state = phase_state.agents[idx];
    agent_state.status = "running";
    state.updated_at = now_iso();
    emit(on_event, { type: "agent_started", workflow_id: state.workflow_id, phase_id: phase_def.phase_id, agent_id: agent_def.agent_id });
    options.on_agent_update?.(phase_def.phase_id, agent_def.agent_id, agent_state);

    try {
      // 격리 경로가 있으면 태스크에 워크스페이스 지시 추가
      const workspace_path = isolation_paths.get(agent_def.agent_id);
      const isolation_instruction = workspace_path
        ? `\n\n## Workspace\nYour isolated workspace directory: ${workspace_path}\nAll file operations must be within this directory.`
        : "";

      const { subagent_id } = await subagents.spawn({
        task: build_agent_task(agent_def, state.objective, prev_context, merge_tools(agent_def.tools, phase_def.tools), state.memory) + isolation_instruction,
        role: agent_def.role,
        label: agent_def.label,
        model: agent_def.model,
        provider_id: backend_to_provider(agent_def.backend),
        max_iterations: agent_def.max_turns === 0 ? 999 : (agent_def.max_turns || 10),
        origin_channel: state.channel,
        origin_chat_id: state.chat_id,
        announce: false,
        parent_id: `workflow:${state.workflow_id}`,
        skip_controller: true,
        skill_names: phase_def.skills,
        allowed_tools: merge_tools(agent_def.tools, phase_def.tools),
      });
      agent_state.subagent_id = subagent_id;

      const result = await subagents.wait_for_completion(subagent_id, 5 * 60_000);

      if (result?.status === "completed") {
        agent_state.status = "completed";
        agent_state.result = result.content || "";
        const msg: PhaseMessage = { role: "assistant", content: agent_state.result, at: now_iso() };
        agent_state.messages.push(msg);
        await store.insert_message(state.workflow_id, phase_def.phase_id, agent_def.agent_id, msg);
        emit(on_event, {
          type: "agent_completed", workflow_id: state.workflow_id,
          phase_id: phase_def.phase_id, agent_id: agent_def.agent_id,
          result: agent_state.result.slice(0, 500),
        });
      } else {
        agent_state.status = "failed";
        agent_state.error = result?.error || "agent_failed";
        emit(on_event, {
          type: "agent_failed", workflow_id: state.workflow_id,
          phase_id: phase_def.phase_id, agent_id: agent_def.agent_id,
          error: agent_state.error,
        });
      }
    } catch (err) {
      agent_state.status = "failed";
      agent_state.error = error_message(err);
      emit(on_event, {
        type: "agent_failed", workflow_id: state.workflow_id,
        phase_id: phase_def.phase_id, agent_id: agent_def.agent_id,
        error: agent_state.error,
      });
      logger.warn("phase_agent_error", { agent_id: agent_def.agent_id, error: agent_state.error });
    }

    options.on_agent_update?.(phase_def.phase_id, agent_def.agent_id, agent_state);
    state.updated_at = now_iso();
    await store.upsert(state);
    return agent_state;
  });

  const agent_results = await Promise.all(promises);

  // Phase 완료 후 worktree 병합 + 정리
  if (worktree_handles.length > 0) {
    const merge_results = await merge_worktrees(ws, worktree_handles);
    for (const mr of merge_results) {
      if (mr.conflict) {
        logger.warn("worktree_merge_conflict", { agent_id: mr.agent_id, error: mr.error });
        emit(on_event, {
          type: "agent_failed", workflow_id: state.workflow_id,
          phase_id: phase_def.phase_id, agent_id: mr.agent_id,
          error: `merge conflict: ${mr.error}`,
        });
      } else if (mr.merged && mr.files_changed > 0) {
        logger.info("worktree_merged", { agent_id: mr.agent_id, files_changed: mr.files_changed });
      }
    }
    await cleanup_worktrees(ws, worktree_handles);
  }

  return agent_results;
}

// ── Critic 실행 ─────────────────────────────────────

type CriticDeps = {
  subagents: SubagentRegistry;
  store: PhaseWorkflowStoreLike;
  logger: Logger;
  on_event?: (event: PhaseLoopEvent) => void;
};

async function run_critic(
  state: PhaseLoopState,
  phase_def: PhaseDefinition,
  phase_state: PhaseState,
  deps: CriticDeps,
): Promise<CriticReview> {
  const { subagents, store, logger, on_event } = deps;
  const critic_def = phase_def.critic!;

  const critic_state: PhaseCriticState = phase_state.critic || {
    agent_id: `critic-${phase_def.phase_id}`,
    model: critic_def.model || "",
    status: "pending",
    messages: [],
  };
  phase_state.critic = critic_state;

  critic_state.status = "running";
  emit(on_event, { type: "critic_started", workflow_id: state.workflow_id, phase_id: phase_def.phase_id });

  try {
    const agent_summaries = phase_state.agents
      .filter((a) => a.status === "completed")
      .map((a) => `### ${a.label} (${a.role})\n${truncate_for_critic(a.result)}`)
      .join("\n\n");

    const failed_agents = phase_state.agents.filter((a) => a.status === "failed");
    const failed_notice = failed_agents.length > 0
      ? `\n\n### Failed Agents\n${failed_agents.map((a) => `- ${a.label}: ${a.error}`).join("\n")}`
      : "";

    const critic_prompt = [
      critic_def.system_prompt,
      "",
      "## Agent Results",
      agent_summaries,
      failed_notice,
      "",
      "Respond with JSON: { \"approved\": boolean, \"summary\": string, \"agent_reviews\": [{ \"agent_id\": string, \"quality\": \"good\"|\"needs_improvement\"|\"low_quality\", \"feedback\": string }] }",
    ].join("\n");

    const { subagent_id } = await subagents.spawn({
      task: critic_prompt,
      role: "critic",
      label: `Critic: ${phase_def.title}`,
      model: critic_def.model,
      provider_id: backend_to_provider(critic_def.backend),
      max_iterations: 3,
      origin_channel: state.channel,
      origin_chat_id: state.chat_id,
      announce: false,
      parent_id: `workflow:${state.workflow_id}`,
      skip_controller: true,
    });

    const result = await subagents.wait_for_completion(subagent_id, 3 * 60_000);
    const content = result?.content || "";

    const parsed = parse_critic_response(content);
    critic_state.status = "completed";
    critic_state.approved = parsed.approved;
    critic_state.review = parsed.summary;
    const msg: PhaseMessage = { role: "assistant", content, at: now_iso() };
    critic_state.messages.push(msg);
    await store.insert_message(state.workflow_id, phase_def.phase_id, critic_state.agent_id, msg);

    emit(on_event, {
      type: "critic_completed", workflow_id: state.workflow_id,
      phase_id: phase_def.phase_id, approved: parsed.approved,
      review: parsed.summary.slice(0, 500),
    });

    return { approved: parsed.approved, summary: parsed.summary, agent_reviews: parsed.agent_reviews };
  } catch (err) {
    critic_state.status = "failed";
    const msg = error_message(err);
    logger.warn("critic_error", { phase_id: phase_def.phase_id, error: msg });
    return { approved: true, summary: `Critic failed: ${msg}` };
  }
}

// ── Looping Phase (interactive + sequential_loop 통합) ──

interface LoopPhaseConfig {
  /** 루프 종료 토큰. */
  done_token: string;
  /** 최대 반복 기본값. */
  default_max: number;
  /** 누적 컨텍스트 제목. */
  history_header: string;
  /** 현재 반복 라벨. */
  iteration_label: string;
  /** 누적 히스토리 포맷터. */
  format_history: (results: string[]) => string;
  /** ASK_USER 응답 기록 포맷터. */
  format_ask_entry: (iteration: number, content: string, user_response: string) => string;
}

const INTERACTIVE_CONFIG: LoopPhaseConfig = {
  done_token: "[SPEC_COMPLETE]",
  default_max: 20,
  history_header: "Conversation History",
  iteration_label: "Current Turn",
  format_history: (results) => results.join("\n---\n"),
  format_ask_entry: (_i, content, response) => `Agent: ${content.replace(/\[ASK_USER\]/g, "").trim()}\nUser: ${response}`,
};

const SEQUENTIAL_LOOP_CONFIG: LoopPhaseConfig = {
  done_token: "[DONE]",
  default_max: 50,
  history_header: "Previous Iterations",
  iteration_label: "Current Iteration",
  format_history: (results) => results.map((r, idx) => `### Iteration ${idx + 1}\n${r}`).join("\n\n"),
  format_ask_entry: (i, content, response) => `[Iteration ${i}]\n${content}\n\nUser: ${response}`,
};

async function run_looping_phase(
  state: PhaseLoopState,
  phase_def: PhaseDefinition,
  phase_state: PhaseState,
  prev_context: string,
  deps: AgentRunDeps,
  config: LoopPhaseConfig,
): Promise<void> {
  const agent_def = phase_def.agents[0];
  const agent_state = phase_state.agents[0];
  const max = phase_def.max_loop_iterations || config.default_max;

  phase_state.loop_results = [];
  phase_state.loop_iteration = 0;

  for (let i = 0; i < max; i++) {
    if (deps.options.abort_signal?.aborted) break;

    const history = config.format_history(phase_state.loop_results);
    const merged = merge_tools(agent_def.tools, phase_def.tools);
    const task = build_agent_task(agent_def, state.objective, prev_context, merged, state.memory);
    const full_task = history
      ? `${task}\n\n## ${config.history_header}\n${history}\n\n## ${config.iteration_label}: ${i + 1}/${max}`
      : task;

    agent_state.status = "running";
    emit(deps.on_event, { type: "agent_started", workflow_id: state.workflow_id, phase_id: phase_def.phase_id, agent_id: agent_def.agent_id });

    const { subagent_id } = await deps.subagents.spawn({
      task: full_task,
      role: agent_def.role,
      label: agent_def.label,
      model: agent_def.model,
      provider_id: backend_to_provider(agent_def.backend),
      max_iterations: agent_def.max_turns === 0 ? 999 : (agent_def.max_turns || 10),
      origin_channel: state.channel,
      origin_chat_id: state.chat_id,
      announce: false,
      parent_id: `workflow:${state.workflow_id}`,
      skip_controller: true,
      skill_names: phase_def.skills,
      allowed_tools: merged?.length ? merged : undefined,
    });
    agent_state.subagent_id = subagent_id;

    const result = await deps.subagents.wait_for_completion(subagent_id, 5 * 60_000);
    const content = result?.content || "";
    const msg: PhaseMessage = { role: "assistant", content, at: now_iso() };
    agent_state.messages.push(msg);
    await deps.store.insert_message(state.workflow_id, phase_def.phase_id, agent_def.agent_id, msg);

    if (content.includes(config.done_token)) {
      agent_state.result = content.replace(config.done_token, "").trim();
      agent_state.status = "completed";
      emit(deps.on_event, {
        type: "agent_completed", workflow_id: state.workflow_id,
        phase_id: phase_def.phase_id, agent_id: agent_def.agent_id,
        result: agent_state.result.slice(0, 500),
      });
      break;
    }

    if (content.includes("[ASK_USER]") && deps.options.ask_user) {
      const question = content.replace(/\[ASK_USER\]/g, "").trim();
      state.status = "waiting_user_input";
      phase_state.pending_user_input = true;
      await deps.store.upsert(state);
      emit(deps.on_event, { type: "user_input_requested", workflow_id: state.workflow_id, phase_id: phase_def.phase_id, question });

      const user_response = await deps.options.ask_user(question);

      state.status = "running";
      phase_state.pending_user_input = false;
      emit(deps.on_event, { type: "user_input_received", workflow_id: state.workflow_id, phase_id: phase_def.phase_id });
      phase_state.loop_results.push(config.format_ask_entry(i + 1, content, user_response));
    } else {
      phase_state.loop_results.push(content);
    }

    phase_state.loop_iteration = i + 1;
    emit(deps.on_event, { type: "loop_iteration", workflow_id: state.workflow_id, phase_id: phase_def.phase_id, iteration: i + 1 });
    state.updated_at = now_iso();
    await deps.store.upsert(state);
  }

  if (agent_state.status !== "completed") {
    agent_state.result = phase_state.loop_results.at(-1) || "";
    agent_state.status = "completed";
  }
}

// ── Helpers ──────────────────────────────────────────

function build_initial_phase_state(def: PhaseDefinition): PhaseState {
  return {
    phase_id: def.phase_id,
    title: def.title,
    status: "pending",
    agents: def.agents.map((a) => ({
      agent_id: a.agent_id,
      role: a.role,
      label: a.label,
      model: a.model || "",
      status: "pending" as const,
      messages: [],
    })),
    critic: def.critic ? {
      agent_id: `critic-${def.phase_id}`,
      model: def.critic.model || "",
      status: "pending" as const,
      messages: [],
    } : undefined,
  };
}

/** goto 시 Phase 상태를 리셋하여 재실행 가능하게 만듦. */
function reset_phase_state(phase_state: PhaseState): void {
  phase_state.status = "pending";
  phase_state.loop_iteration = undefined;
  phase_state.loop_results = undefined;
  phase_state.pending_user_input = undefined;
  for (const a of phase_state.agents) {
    a.status = "pending";
    a.result = undefined;
    a.error = undefined;
    a.subagent_id = undefined;
  }
  if (phase_state.critic) {
    phase_state.critic.status = "pending";
    phase_state.critic.review = undefined;
    phase_state.critic.approved = undefined;
  }
}

/** 에이전트 도구와 Phase 도구를 합산 (중복 제거). */
function merge_tools(agent_tools?: string[], phase_tools?: string[]): string[] | undefined {
  if (!agent_tools?.length && !phase_tools?.length) return undefined;
  return [...new Set([...(agent_tools || []), ...(phase_tools || [])])];
}

function build_agent_task(agent_def: PhaseAgentDefinition, objective: string, prev_context: string, tools?: string[], memory?: Record<string, unknown>): string {
  const parts = [agent_def.system_prompt];
  if (tools?.length) parts.push(`\n## Available Tools\n${tools.join(", ")}`);
  if (prev_context) parts.push(`\n## Previous Phase Context\n${prev_context}`);
  if (memory?.origin) parts.push(`\n## Origin Channel\n${JSON.stringify(memory.origin)}`);
  parts.push(`\n## Objective\n${objective}`);
  return parts.join("\n");
}

function build_phase_context(prev_phase: PhaseState, template?: string): string {
  if (template) {
    // 간단 변수 치환: {{prev_phase.agents}}, {{prev_phase.critic.review}}
    let result = template;
    const agent_block = prev_phase.agents
      .filter((a) => a.status === "completed")
      .map((a) => `### ${a.label}\n${truncate_for_critic(a.result)}`)
      .join("\n\n");
    result = result.replace(/\{\{#each prev_phase\.agents\}\}[\s\S]*?\{\{\/each\}\}/g, agent_block);
    result = result.replace(/\{\{prev_phase\.critic\.review\}\}/g, prev_phase.critic?.review || "(no review)");
    return result;
  }

  // 기본 컨텍스트 포맷
  const parts = [`## ${prev_phase.title} Results`];
  for (const agent of prev_phase.agents) {
    if (agent.status === "completed") {
      parts.push(`### ${agent.label}\n${truncate_for_critic(agent.result)}`);
    }
  }
  if (prev_phase.critic?.review) {
    parts.push(`### Critic Review\n${prev_phase.critic.review}`);
  }
  return parts.join("\n\n");
}

function merge_phase_results_to_memory(state: PhaseLoopState, phase: PhaseState): void {
  const results: Record<string, string> = {};
  for (const agent of phase.agents) {
    if (agent.result) results[agent.agent_id] = agent.result;
  }
  state.memory[phase.phase_id] = {
    agents: results,
    critic_review: phase.critic?.review || null,
    critic_approved: phase.critic?.approved ?? null,
  };
}

/** 에이전트 결과를 critic 프롬프트 크기 내로 제한. JSON은 구조 보존, 텍스트는 끝부분 우선. */
const CRITIC_MAX_CHARS = 3000;

function truncate_for_critic(result: string | undefined): string {
  if (!result) return "(no result)";
  if (result.length <= CRITIC_MAX_CHARS) return result;

  // JSON 응답이면 구조를 보존하며 value 잘라내기
  try {
    const parsed = JSON.parse(result);
    const compact = JSON.stringify(parsed, (_k, v) =>
      typeof v === "string" && v.length > 500 ? v.slice(0, 500) + "…[truncated]" : v,
    );
    if (compact.length <= CRITIC_MAX_CHARS) return compact;
    return compact.slice(0, CRITIC_MAX_CHARS) + "\n…[truncated, total " + result.length + " chars]";
  } catch { /* not JSON */ }

  // 텍스트: 마지막 부분이 보통 최종 결론이므로 끝부분 우선
  const head = result.slice(0, 800);
  const tail = result.slice(-(CRITIC_MAX_CHARS - 800 - 60));
  return head + "\n\n…[middle truncated, total " + result.length + " chars]…\n\n" + tail;
}

function parse_critic_response(content: string): CriticReview {
  try {
    // 중첩 JSON 허용 (agent_reviews 배열 포함)
    const json_match = content.match(/\{[\s\S]*"approved"[\s\S]*\}/);
    if (json_match) {
      const parsed = JSON.parse(json_match[0]) as Record<string, unknown>;
      const agent_reviews = Array.isArray(parsed.agent_reviews)
        ? (parsed.agent_reviews as Array<Record<string, unknown>>).map((r) => ({
            agent_id: String(r.agent_id || ""),
            quality: (["good", "needs_improvement", "low_quality"].includes(String(r.quality)) ? r.quality : "good") as "good" | "needs_improvement" | "low_quality",
            feedback: String(r.feedback || ""),
          }))
        : undefined;
      return {
        approved: Boolean(parsed.approved),
        summary: String(parsed.summary || parsed.review || content).slice(0, 2000),
        agent_reviews,
      };
    }
  } catch { /* fallback */ }
  const lower = content.toLowerCase();
  const approved = lower.includes("approved") || lower.includes("pass") || !lower.includes("rejected");
  return { approved, summary: content.slice(0, 2000) };
}

function build_result(state: PhaseLoopState): PhaseLoopRunResult {
  return {
    workflow_id: state.workflow_id,
    status: state.status,
    phases: state.phases,
    memory: state.memory,
  };
}

function emit(handler: ((event: PhaseLoopEvent) => void) | undefined, event: PhaseLoopEvent): void {
  if (handler) {
    try { handler(event); } catch { /* noop */ }
  }
}

/** YAML backend ID → SubagentRegistry provider_id 매핑. */
function backend_to_provider(backend?: string): import("../providers/types.js").ProviderId | undefined {
  if (!backend) return undefined;
  const map: Record<string, string> = {
    codex_cli: "chatgpt",
    claude_cli: "claude_code",
    claude_sdk: "claude_code",
    gemini_cli: "gemini",
    openrouter: "openrouter",
    orchestrator_llm: "orchestrator_llm",
  };
  return (map[backend] ?? backend) as import("../providers/types.js").ProviderId;
}

/** deps에서 RunnerServices 구성. */
function build_runner_services(
  deps: PhaseLoopRunnerDeps,
  state: PhaseLoopState,
  subagents: SubagentRegistry,
): import("./node-registry.js").RunnerServices {
  const services: import("./node-registry.js").RunnerServices = {};

  // LLM 호출
  if (deps.providers) {
    const providers = deps.providers;
    services.invoke_llm = async (opts) => {
      const provider_id = backend_to_provider(opts.provider_id) || "openrouter";
      const messages: import("../providers/types.js").ChatMessage[] = [];
      if (opts.system) messages.push({ role: "system", content: opts.system });

      let user_content = opts.prompt;
      if (opts.output_json_schema) {
        user_content += `\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(opts.output_json_schema)}`;
      }
      messages.push({ role: "user", content: user_content });

      const result = await providers.run_headless({
        provider_id,
        messages,
        model: opts.model,
        temperature: opts.temperature,
        max_tokens: opts.max_tokens,
        abort_signal: opts.abort_signal,
      });
      const content = result.content || "";
      let parsed: unknown = undefined;
      if (opts.output_json_schema && content) {
        try { parsed = JSON.parse(content); } catch { /* not JSON */ }
      }
      return { content, parsed, usage: result.usage as Record<string, number> | undefined };
    };
  }

  // 에이전트 스폰 + 대기
  services.spawn_agent = async (opts) => {
    const result = await subagents.spawn({
      ...opts,
      provider_id: backend_to_provider(opts.provider_id as string | undefined),
      parent_id: opts.parent_id || `workflow:${state.workflow_id}`,
    });
    return { agent_id: result.subagent_id, status: result.status };
  };
  services.wait_agent = (agent_id, timeout_ms) => subagents.wait_for_completion(agent_id, timeout_ms).then((r) => ({
    status: r?.status ?? "failed",
    result: r?.content ?? null,
    error: r?.error,
  }));

  // Decision/Promise
  if (deps.decision_service) {
    const ds = deps.decision_service;
    services.decision = {
      append: (input) => ds.append_decision({
        ...input,
        scope: input.scope as "global" | "team" | "agent",
        priority: (input.priority ?? 1) as 0 | 1 | 2 | 3,
        source: (input.source ?? "system") as "user" | "leader" | "system" | "agent",
      }),
      list: (filter) => ds.list_decisions(filter as Parameters<typeof ds.list_decisions>[0]),
      get_effective: (ctx) => ds.get_effective_decisions(ctx),
      archive: (id) => ds.archive_decision(id),
    };
  }
  if (deps.promise_service) {
    const ps = deps.promise_service;
    services.promise = {
      append: (input) => ps.append_promise({
        ...input,
        scope: input.scope as "global" | "team" | "agent",
        priority: (input.priority ?? 1) as 0 | 1 | 2 | 3,
        source: (input.source ?? "system") as "user" | "leader" | "system" | "agent",
      }),
      list: (filter) => ps.list_promises(filter as Parameters<typeof ps.list_promises>[0]),
      get_effective: (ctx) => ps.get_effective_promises(ctx),
      archive: (id) => ps.archive_promise(id),
    };
  }

  // Embedding
  if (deps.embed) services.embed = deps.embed;

  // Vector Store
  if (deps.vector_store) services.vector_store = deps.vector_store;

  // OAuth fetch
  if (deps.oauth_fetch) services.oauth_fetch = deps.oauth_fetch;

  // Webhook data
  if (deps.get_webhook_data) services.get_webhook_data = deps.get_webhook_data;

  // Kanban event
  if (deps.wait_kanban_event) services.wait_kanban_event = deps.wait_kanban_event;

  // Task 생성
  if (deps.create_task) services.create_task = deps.create_task;

  // DB 쿼리
  if (deps.query_db) services.query_db = deps.query_db;

  return services;
}

/** field_mappings 적용: from_node의 출력 필드를 to_node 메모리 슬롯에 매핑. */
function apply_field_mappings(
  memory: Record<string, unknown>,
  from_node_id: string,
  output: unknown,
  mappings: import("./phase-loop.types.js").FieldMapping[],
): void {
  for (const m of mappings) {
    if (m.from_node !== from_node_id) continue;
    const value = resolve_field(output, m.from_field);
    if (value === undefined) continue;

    // to_node 메모리 슬롯에 필드 주입 (기존 객체에 머지, 없으면 생성)
    const target = memory[m.to_node];
    if (m.to_field) {
      const obj = (target && typeof target === "object" && !Array.isArray(target) ? target : {}) as Record<string, unknown>;
      set_nested_field(obj, m.to_field, value);
      memory[m.to_node] = obj;
    } else {
      memory[m.to_node] = value;
    }
  }
}

/** dot-notation 경로로 중첩 값 조회. "body.data[0].id" 형태 지원. */
function resolve_field(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const key of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** dot-notation 경로로 중첩 값 설정. */
function set_nested_field(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/\[(\d+)]/g, ".$1").split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] === null || current[key] === undefined || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
