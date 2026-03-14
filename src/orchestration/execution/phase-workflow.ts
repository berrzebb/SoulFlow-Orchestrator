/** Phase 워크플로우 경로 실행: 템플릿/동적 생성 → 래너 → 결과 반환. */

import type { OrchestrationRequest, OrchestrationResult } from "../types.js";
import type { Logger } from "../../logger.js";
import type { ProcessTrackerLike } from "../process-tracker.js";
import type { ProviderRegistry } from "../../providers/service.js";
import type { AgentRuntimeLike } from "../../agent/runtime.types.js";
import type { HitlPendingStore } from "../hitl-pending-store.js";
import { NOOP_OBSERVABILITY, type ObservabilityLike } from "../../observability/context.js";
import { error_result } from "./helpers.js";
import { now_iso, error_message, short_id } from "../../utils/common.js";
import { normalize_json_text } from "../output-contracts.js";

export type PhaseWorkflowDeps = {
  providers: ProviderRegistry;
  runtime: AgentRuntimeLike;
  logger: Logger;
  process_tracker: ProcessTrackerLike | null;
  workspace: string;
  user_dir?: string;
  subagents: import("../../agent/subagents.js").SubagentRegistry | null;
  phase_workflow_store: import("../../agent/phase-workflow-store.js").PhaseWorkflowStoreLike | null;
  bus: import("../../bus/types.js").MessageBusLike | null;
  hitl_store: HitlPendingStore;
  get_sse_broadcaster: (() => { broadcast_workflow_event(event: import("../../agent/phase-loop.types.js").PhaseLoopEvent, team_id?: string): void } | null) | undefined;
  render_hitl: (body: string, type: "choice" | "confirmation" | "question" | "escalation" | "error") => string;
  decision_service: import("../../decision/service.js").DecisionService | null;
  promise_service: import("../../decision/promise.service.js").PromiseService | null;
  embed?: (texts: string[], opts: { model?: string; dimensions?: number }) => Promise<{ embeddings: number[][]; token_usage?: number }>;
  vector_store?: (op: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  oauth_fetch?: (service_id: string, opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown }) => Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  get_webhook_data?: (path: string) => Promise<{ method: string; headers: Record<string, string>; body: unknown; query: Record<string, string> } | null>;
  wait_kanban_event?: (board_id: string, filter: { actions?: string[]; column_id?: string }) => Promise<{ card_id: string; board_id: string; action: string; actor: string; detail: Record<string, unknown>; created_at: string } | null>;
  create_task?: (opts: { title: string; objective: string; channel?: string; chat_id?: string; max_turns?: number; initial_memory?: Record<string, unknown> }) => Promise<{ task_id: string; status: string; result?: unknown; error?: string }>;
  query_db?: (datasource: string, query: string, params?: Record<string, unknown>) => Promise<{ rows: unknown[]; affected_rows: number }>;
  observability?: ObservabilityLike | null;
};

/** Phase 워크플로우 실행: 템플릿 선택 또는 동적 생성 → phase-loop-runner 실행. */
export async function run_phase_loop(
  deps: PhaseWorkflowDeps,
  req: OrchestrationRequest,
  task_with_media: string,
  workflow_hint?: string,
  node_categories?: string[],
): Promise<OrchestrationResult> {
  const obs = deps.observability ?? NOOP_OBSERVABILITY;
  const correlation = { run_id: req.run_id, provider: req.provider, chat_id: req.message.chat_id };
  const span = obs.spans.start("workflow_run", "run_phase_loop", correlation, { workflow_hint: workflow_hint ?? "" });
  const start = Date.now();

  try {
    const result = await _run_phase_loop_inner(deps, req, task_with_media, workflow_hint, node_categories);
    const status = result.error ? "error" : "ok";
    span.end(status);
    obs.metrics.counter("workflow_runs_total", 1, { status });
    obs.metrics.histogram("workflow_run_duration_ms", Date.now() - start, {});
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    span.fail(message);
    obs.metrics.counter("workflow_runs_total", 1, { status: "error" });
    obs.metrics.histogram("workflow_run_duration_ms", Date.now() - start, {});
    throw err;
  }
}

async function _run_phase_loop_inner(
  deps: PhaseWorkflowDeps,
  req: OrchestrationRequest,
  task_with_media: string,
  workflow_hint?: string,
  node_categories?: string[],
): Promise<OrchestrationResult> {
  const { run_phase_loop: exec } = await import("../../agent/phase-loop-runner.js");
  const { load_workflow_templates, load_workflow_template, substitute_variables } = await import("../workflow-loader.js");

  if (!deps.workspace) throw new Error("workspace is required for run_phase_loop");
  const workspace = deps.workspace;
  const user_dir = deps.user_dir ?? workspace;
  const store = deps.phase_workflow_store;
  const subagents = deps.subagents;
  if (!subagents || !store) {
    return error_result("phase", null, "phase_loop_deps_not_configured");
  }

  const hint_id = workflow_hint;

  let template: import("../../agent/phase-loop.types.js").WorkflowDefinition | null = null;
  if (hint_id) {
    template = load_workflow_template(user_dir, hint_id);
  }
  if (!template) {
    const templates = load_workflow_templates(user_dir);
    const lower = task_with_media.toLowerCase();
    template = templates.find((t) =>
      lower.includes(t.title.toLowerCase()) ||
      t.title.toLowerCase().split(/\s+/).some((word) => word.length > 2 && lower.includes(word)),
    ) || null;
  }
  if (!template) {
    const dynamic = await generate_dynamic_workflow(deps, task_with_media);
    if (!dynamic) {
      return error_result("phase", null, "no_matching_workflow_template");
    }
    const preview = format_workflow_preview(dynamic);
    const workflow_id = `wf-${short_id(12)}`;
    if (store) {
      store.upsert({
        workflow_id, title: dynamic.title, objective: task_with_media,
        channel: req.provider, chat_id: req.message.chat_id,
        status: "waiting_user_input", current_phase: 0, phases: [],
        memory: { origin: { channel: req.provider, chat_id: req.message.chat_id, sender_id: req.message.sender_id } },
        created_at: now_iso(), updated_at: now_iso(),
        definition: dynamic,
      }).catch((e) => deps.logger.error("workflow_upsert_failed", { workflow_id, error: error_message(e) }));
    }
    return { reply: preview, mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
  }

  const origin = { channel: req.provider, chat_id: req.message.chat_id, sender_id: req.message.sender_id };
  const definition = substitute_variables(template, {
    ...(template.variables || {}),
    objective: task_with_media,
    channel: req.provider,
    origin_channel: origin.channel,
    origin_chat_id: origin.chat_id,
    origin_sender_id: origin.sender_id,
  });
  const workflow_id = `wf-${short_id(12)}`;

  if (req.run_id) {
    deps.process_tracker?.link_workflow(req.run_id, workflow_id);
  }

  const bus = deps.bus;
  const channel_callbacks = bus ? build_phase_channel_callbacks(deps, bus, workflow_id, req.provider, req.message.chat_id) : {};

  const result = await exec({
    workflow_id,
    title: definition.title,
    objective: task_with_media,
    channel: req.provider,
    chat_id: req.message.chat_id,
    phases: definition.phases ?? [],
    nodes: definition.nodes,
    workspace,
    initial_memory: { origin, ...(node_categories?.length ? { node_categories } : {}) },
    abort_signal: req.signal,
    invoke_tool: (tool_id, params, ctx) => deps.runtime.execute_tool(tool_id, params, ctx ? { channel: ctx.channel, chat_id: ctx.chat_id, sender_id: ctx.sender_id, task_id: ctx.workflow_id } : undefined),
    ...channel_callbacks,
    on_phase_change: (state) => {
      req.on_progress?.({ task_id: workflow_id, step: state.current_phase + 1, total_steps: state.phases.length, description: `phase ${state.current_phase + 1}/${state.phases.length}`, provider: req.provider, chat_id: req.message.chat_id, at: now_iso() });
    },
  }, {
    subagents,
    store,
    logger: deps.logger,
    load_template: (name) => load_workflow_template(user_dir, name),
    providers: deps.providers,
    decision_service: deps.decision_service,
    promise_service: deps.promise_service,
    embed: deps.embed,
    vector_store: deps.vector_store,
    oauth_fetch: deps.oauth_fetch,
    get_webhook_data: deps.get_webhook_data,
    wait_kanban_event: deps.wait_kanban_event,
    create_task: deps.create_task,
    query_db: deps.query_db,
    on_event: (event) => {
      const team_id = typeof (req.message.metadata as Record<string, unknown>)?.team_id === "string"
        ? (req.message.metadata as Record<string, unknown>).team_id as string : undefined;
      deps.get_sse_broadcaster?.()?.broadcast_workflow_event(event, team_id);
      req.on_agent_event?.({ type: "content_delta", source: { backend: "phase_loop", task_id: workflow_id }, at: now_iso(), text: `[phase] ${event.type}` });
    },
  });

  if (result.status === "completed") {
    return { reply: `워크플로우 \`${definition.title}\` 완료.\n\n${format_phase_summary(result)}`, mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
  }
  if (result.status === "waiting_user_input") {
    const pending_phase = result.phases.find((p) => p.pending_user_input);
    if (pending_phase) {
      const last_agent_result = pending_phase.agents.filter((a) => a.result).pop()?.result || "";
      const context = `워크플로우 \`${definition.title}\` → **${pending_phase.phase_id}**\n\n${last_agent_result.slice(0, 500)}`;
      return { reply: deps.render_hitl(context, "question"), mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
    }
    const failed_phase = result.phases.find((p) => p.critic && !p.critic.approved);
    const critic_review = failed_phase?.critic?.review || "";
    const agent_output = failed_phase?.agents.filter((a) => a.result).pop()?.result || "";
    const context = [
      `워크플로우 \`${definition.title}\` → **${failed_phase?.phase_id || "단계"}**`,
      "",
      agent_output ? `**에이전트 결과:**\n${agent_output.slice(0, 400)}` : "",
      critic_review ? `**검토 의견:**\n${critic_review.slice(0, 300)}` : "",
    ].filter(Boolean).join("\n\n");
    return { reply: deps.render_hitl(context, "escalation"), mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
  }
  const phase_error = result.error || result.status;
  deps.logger.warn("phase_loop_terminal", { workflow_id, status: result.status, error: phase_error });
  return { reply: null, error: `phase_${result.status}:${phase_error}`, mode: "phase", tool_calls_count: 0, streamed: false, run_id: req.run_id };
}

/** 동적 워크플로우 생성: 오케스트레이터 LLM에게 워크플로우 구조 설계 요청. */
async function generate_dynamic_workflow(
  deps: PhaseWorkflowDeps,
  objective: string,
): Promise<import("../../agent/phase-loop.types.js").WorkflowDefinition | null> {
  try {
    const { get_agent_role_presets } = await import("../../agent/node-presets.js");
    const role_presets = get_agent_role_presets();
    const preset_catalog = role_presets.map((p) =>
      `  - preset_id: "${p.preset_id}" (${p.label}): ${p.description}`,
    ).join("\n");

    const agent_backend = deps.providers.get_orchestrator_provider_id();
    const planner_prompt = [
      "Design a multi-agent workflow for the following objective.",
      `Objective: "${objective}"`,
      "",
      "## Available Agent Role Presets",
      "Use these preset_ids when they match the needed role. The preset provides system_prompt and optimal settings automatically.",
      preset_catalog,
      "",
      "Constraints:",
      "- Maximum 3 phases",
      "- Maximum 4 agents per phase",
      `- Each agent needs: agent_id (snake_case), role, label, backend (use "${agent_backend}")`,
      "- If a preset matches the role, add preset_id to the agent definition (system_prompt will be auto-filled)",
      "- If no preset matches, provide a custom system_prompt",
      "- Add a critic to each phase with gate=true",
      "",
      "Return ONLY valid JSON matching this schema:",
      `{ "title": string, "objective": string, "phases": [{ "phase_id": string, "title": string, "agents": [{ "agent_id": string, "role": string, "label": string, "backend": "${agent_backend}", "preset_id"?: string, "system_prompt"?: string }], "critic": { "backend": "${agent_backend}", "system_prompt": string, "gate": true } }] }`,
    ].join("\n");

    const llm_response = await deps.providers.run_orchestrator({
      messages: [{ role: "user", content: planner_prompt }],
      max_tokens: 4096,
      temperature: 0.3,
    });
    const response = llm_response?.content;
    if (!response) return null;

    const json_match = normalize_json_text(response).match(/\{[\s\S]*"phases"[\s\S]*\}/);
    if (!json_match) return null;

    const raw = JSON.parse(json_match[0]) as Record<string, unknown>;
    if (!raw.title || !Array.isArray(raw.phases)) return null;

    return raw as unknown as import("../../agent/phase-loop.types.js").WorkflowDefinition;
  } catch (err) {
    deps.logger.warn("dynamic_workflow_generation_failed", { error: error_message(err) });
    return null;
  }
}

/** 동적 생성 워크플로우 미리보기 텍스트. */
function format_workflow_preview(def: import("../../agent/phase-loop.types.js").WorkflowDefinition): string {
  const lines = [`다음 워크플로우를 생성했습니다:\n`];
  for (let i = 0; i < (def.phases?.length ?? 0); i++) {
    const p = def.phases![i];
    const critic_note = p.critic ? " + critic" : "";
    lines.push(`**Phase ${i + 1}: ${p.title}** (${p.agents.length} agents${critic_note})`);
    for (const a of p.agents) {
      lines.push(`  - ${a.label}: ${a.system_prompt.slice(0, 80)}`);
    }
  }
  lines.push(`\n대시보드에서 워크플로우를 승인하거나 수정하세요.`);
  return lines.join("\n");
}

/** Phase Loop 내 interaction 노드용 채널 콜백 빌더. */
function build_phase_channel_callbacks(
  deps: PhaseWorkflowDeps,
  bus: import("../../bus/types.js").MessageBusLike,
  workflow_id: string,
  origin_channel: string,
  origin_chat_id: string,
) {
  const logger = deps.logger;
  const hitl = deps.hitl_store;

  const send_message: import("../../agent/phase-loop.types.js").PhaseLoopRunOptions["send_message"] = async (req) => {
    const channel = req.target === "origin" ? origin_channel : (req.channel || origin_channel);
    const chat_id = req.target === "origin" ? origin_chat_id : (req.chat_id || origin_chat_id);
    const msg_id = `wf-msg-${short_id(8)}`;
    try {
      await bus.publish_outbound({
        id: msg_id, provider: channel, channel,
        sender_id: "system", chat_id, content: req.content,
        at: now_iso(),
        metadata: { workflow_id, type: "workflow_notification", ...(req.structured ? { structured: req.structured } : {}) },
      });
      return { ok: true, message_id: msg_id };
    } catch (e) {
      logger.error("workflow_send_message_failed", { workflow_id, error: error_message(e) });
      return { ok: false };
    }
  };

  const ask_channel: import("../../agent/phase-loop.types.js").PhaseLoopRunOptions["ask_channel"] = (req, timeout_ms) => {
    const channel = req.target === "origin" ? origin_channel : (req.channel || origin_channel);
    const chat_id = req.target === "origin" ? origin_chat_id : (req.chat_id || origin_chat_id);

    bus.publish_outbound({
      id: `wf-ask-${short_id(8)}`, provider: channel, channel,
      sender_id: "system", chat_id, content: req.content,
      at: now_iso(),
      metadata: { workflow_id, type: "workflow_ask_channel", ...(req.structured ? { structured: req.structured } : {}) },
    }).catch((e) => logger.error("workflow_ask_channel_send_failed", { workflow_id, error: error_message(e) }));

    return new Promise<import("../../agent/phase-loop.types.js").ChannelResponse>((resolve) => {
      const timer = setTimeout(() => {
        hitl.delete(workflow_id);
        resolve({ response: "", responded_at: now_iso(), timed_out: true });
      }, timeout_ms);

      hitl.set(workflow_id, {
        resolve: (content: string) => {
          clearTimeout(timer);
          resolve({ response: content, responded_by: { channel, chat_id }, responded_at: now_iso(), timed_out: false });
        },
        chat_id,
      });
    });
  };

  return { send_message, ask_channel };
}

/** Phase Loop 실행 결과를 사용자 친화적 요약으로 변환. */
function format_phase_summary(result: import("../../agent/phase-loop.types.js").PhaseLoopRunResult): string {
  const lines: string[] = [];

  for (const phase of result.phases) {
    lines.push(`**${phase.title}** (${phase.status})`);
    for (const agent of phase.agents) {
      const icon = agent.status === "completed" ? "o" : agent.status === "failed" ? "x" : "-";
      lines.push(`  ${icon} ${agent.label}: ${(agent.result || agent.error || "").slice(0, 200)}`);
    }
    if (phase.critic?.review) {
      lines.push(`  Critic: ${phase.critic.approved ? "Approved" : "Rejected"} — ${phase.critic.review.slice(0, 200)}`);
    }
  }

  if (lines.length === 0 && result.memory) {
    const mem = result.memory;
    const keys = Object.keys(mem).filter((k) => k !== "origin" && k !== "node_categories");
    const last_key = keys[keys.length - 1];
    if (last_key) {
      const val = mem[last_key];
      const text = typeof val === "string" ? val : JSON.stringify(val);
      lines.push(text.slice(0, 500));
    }
  }

  return lines.join("\n");
}
