/** 대시보드 상태 조립 함수. service.ts의 build_state + _build_merged_tasks 추출. */

import type { DashboardOptions, RecentMessage } from "./service.js";
import type { ProcessEntry } from "../orchestration/process-tracker.js";
import type { AgentEvent } from "../agent/agent.types.js";
import { now_seoul_iso } from "../utils/common.js";

export async function build_merged_tasks(options: DashboardOptions, team_id?: string): Promise<Array<{
  taskId: string; title: string; status: string; currentStep?: string; exitReason?: string;
  currentTurn: number; maxTurns: number; channel: string; chat_id: string; objective: string; updatedAt: string;
}>> {
  const loop_tasks = options.agent.list_runtime_tasks(team_id);
  const stored_tasks = await options.agent.list_stored_tasks(team_id);
  const task_map = new Map<string, (typeof stored_tasks)[number]>();
  for (const row of stored_tasks) task_map.set(row.taskId, row);
  for (const row of loop_tasks) task_map.set(row.taskId, row);
  let entries = [...task_map.values()];
  if (team_id !== undefined) entries = entries.filter((t) => (t as { team_id?: string }).team_id === team_id);
  return entries.map((t) => {
    const memory = (t.memory || {}) as Record<string, unknown>;
    const workflow = (memory.workflow && typeof memory.workflow === "object")
      ? (memory.workflow as Record<string, unknown>)
      : {};
    const id_parts = t.taskId.split(":");
    const channel_from_id = (id_parts[0] === "adhoc" || id_parts[0] === "task") ? id_parts[1] || "" : "";
    return {
      taskId: t.taskId, title: t.title, status: t.status,
      currentStep: t.currentStep, exitReason: t.exitReason,
      currentTurn: t.currentTurn, maxTurns: t.maxTurns,
      channel: t.channel || String(memory.channel || channel_from_id),
      chat_id: t.chatId || String(memory.chat_id || ""),
      objective: (t.objective || String(memory.objective || "")).slice(0, 200),
      updatedAt: String(memory.__updated_at_seoul || workflow.at || ""),
    };
  });
}

export async function build_dashboard_state(
  options: DashboardOptions,
  recent_messages: RecentMessage[],
  team_id?: string,
): Promise<Record<string, unknown>> {
  const queue = options.bus.get_sizes();
  const channel_status = options.channels.get_status();
  const ops = options.ops.status();
  const heartbeat = options.heartbeat.status();
  const [tasks, decisions, promises, workflow_events, agent_providers] = await Promise.all([
    build_merged_tasks(options, team_id),
    options.decisions.get_effective_decisions({ include_p2: true }),
    options.promises.get_effective_promises({ include_p2: true }),
    options.events.list({ limit: 40 }),
    options.agent_provider_ops ? options.agent_provider_ops.list() : Promise.resolve([]),
  ]);

  const subagents = options.agent.list_subagents(team_id);
  const scoped_messages = team_id !== undefined
    ? recent_messages.filter((m) => (m as { team_id?: string }).team_id === team_id)
    : recent_messages;
  const messages = scoped_messages.slice(-20).reverse();
  const lastBySender = new Map<string, string>();
  for (const m of messages) {
    if (!lastBySender.has(m.sender_id)) lastBySender.set(m.sender_id, m.content);
  }

  const agents = subagents.map((a) => ({
    id: a.id, label: a.label || a.id, role: a.role, model: a.model,
    status: a.status, session_id: a.session_id,
    created_at: a.created_at, updated_at: a.updated_at,
    last_error: a.last_error,
    last_result: a.last_result ? a.last_result.slice(0, 200) : undefined,
    last_message: lastBySender.get(`subagent:${a.id}`) || "",
  }));

  const tracker = options.process_tracker;
  const map_process = (p: ProcessEntry) => ({
    run_id: p.run_id, provider: p.provider, chat_id: p.chat_id,
    sender_id: p.sender_id, alias: p.alias, mode: p.mode, status: p.status,
    executor_provider: p.executor_provider,
    started_at: p.started_at, ended_at: p.ended_at,
    loop_id: p.loop_id, task_id: p.task_id,
    subagent_ids: p.subagent_ids,
    tool_calls_count: p.tool_calls_count, error: p.error,
  });
  const processes = {
    active: (tracker?.list_active(team_id) ?? []).map(map_process),
    recent: (tracker?.list_recent(20, team_id) ?? []).map(map_process),
  };

  const cron_sched = options.cron;
  const cron = cron_sched ? await (async () => {
    const [st, jobs] = await Promise.all([cron_sched.status(), cron_sched.list_jobs(true, team_id)]);
    return {
      ...st,
      jobs: jobs.map((j) => ({
        id: j.id, name: j.name, enabled: j.enabled,
        schedule: j.schedule, state: j.state,
        delete_after_run: j.delete_after_run, payload: j.payload,
      })),
    };
  })() : null;

  const approvals = options.agent.list_approval_requests("pending", team_id).map((a) => ({
    request_id: a.request_id, tool_name: a.tool_name, status: a.status,
    created_at: a.created_at, context: a.context,
  }));
  const active_loops = options.agent.list_active_loops(team_id).map((l) => ({
    loopId: l.loopId, agentId: l.agentId, objective: l.objective,
    currentTurn: l.currentTurn, maxTurns: l.maxTurns, status: l.status,
  }));
  const cd_score = options.stats_ops?.get_cd_score() ?? null;

  return {
    now: now_seoul_iso(),
    queue,
    channels: {
      enabled: channel_status.enabled_channels,
      mention_loop_running: channel_status.mention_loop_running,
      health: options.channels.get_channel_health(),
      active_runs: options.channels.get_active_run_count(),
    },
    heartbeat, ops, agents, tasks, messages, processes, approvals, active_loops, cd_score, cron,
    decisions: decisions.map((d) => ({ id: d.id, canonical_key: d.canonical_key, value: d.value, priority: d.priority })),
    promises: promises.map((p) => ({ id: p.id, canonical_key: p.canonical_key, value: p.value, priority: p.priority, scope: p.scope, source: p.source })),
    workflow_events: workflow_events.map((e) => ({ event_id: e.event_id, task_id: e.task_id, run_id: e.run_id, agent_id: e.agent_id, phase: e.phase, summary: e.summary, at: e.at })),
    agent_providers,
  };
}

/** AgentEvent에서 SSE 전송에 필요한 필드만 추출. */
export function pick_agent_event_fields(event: AgentEvent): Record<string, unknown> {
  switch (event.type) {
    case "tool_use": return { tool_name: event.tool_name };
    case "tool_result": return { tool_name: event.tool_name, is_error: event.is_error };
    case "content_delta": return { text: event.text.slice(0, 200) };
    case "usage": return { tokens: event.tokens, cost_usd: event.cost_usd };
    case "error": return { error: event.error.slice(0, 300) };
    case "complete": return { finish_reason: event.finish_reason };
    case "task_lifecycle": return { sdk_task_id: event.sdk_task_id, status: event.status, description: event.description };
    case "approval_request": return { request_id: event.request.request_id, tool_name: event.request.tool_name };
    case "rate_limit": return { status: event.status, utilization: event.utilization };
    default: return {};
  }
}
