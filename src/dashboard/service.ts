import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentInspectorLike } from "../agent/inspector.types.js";
import type { MessageBusLike } from "../bus/index.js";
import type { ChannelManager } from "../channels/index.js";
import type { DecisionService } from "../decision/index.js";
import type { WorkflowEventService } from "../events/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { OpsRuntimeService } from "../ops/index.js";
import type { Logger } from "../logger.js";
import type { ServiceLike } from "../runtime/service.types.js";
import type { ProcessTrackerLike, ProcessEntry } from "../orchestration/process-tracker.js";
import type { TaskState } from "../contracts.js";
import type { CronScheduler } from "../cron/index.js";
import type { DispatchDlqStoreLike } from "../channels/dlq-store.js";
import type { ProgressEvent } from "../bus/types.js";
import { now_iso } from "../utils/common.js";
import { get_dashboard_html } from "./assets.js";

export interface DashboardTaskOps {
  cancel_task(task_id: string, reason?: string): Promise<TaskState | null>;
  get_task(task_id: string): Promise<TaskState | null>;
  resume_task(task_id: string, user_input?: string): Promise<TaskState | null>;
}

export interface DashboardStatsOps {
  get_cd_score(): { total: number; events: Array<{ indicator: string; points: number; context: string; at: string }> };
  reset_cd_score(): void;
}

type DashboardOptions = {
  host: string;
  port: number;
  agent: AgentInspectorLike;
  bus: MessageBusLike;
  channels: ChannelManager;
  heartbeat: HeartbeatService;
  ops: OpsRuntimeService;
  decisions: DecisionService;
  events: WorkflowEventService;
  process_tracker?: ProcessTrackerLike | null;
  cron?: CronScheduler | null;
  task_ops?: DashboardTaskOps | null;
  stats_ops?: DashboardStatsOps | null;
  dlq?: DispatchDlqStoreLike | null;
  logger?: Logger | null;
};

type SseClient = {
  id: string;
  res: ServerResponse;
};

function rand_id(): string {
  return Math.random().toString(36).slice(2, 10);
}

function set_no_cache(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

type RecentMessage = { direction: "inbound" | "outbound"; sender_id: string; content: string; chat_id: string; at: string };

const MAX_RECENT_MESSAGES = 40;

export class DashboardService implements ServiceLike {
  readonly name = "dashboard";
  private readonly options: DashboardOptions;
  private readonly logger: Logger | null;
  private server: Server | null = null;
  private bound_port: number | null = null;
  private readonly sse_clients = new Map<string, SseClient>();
  private readonly html_cache: string;
  private readonly _recent_messages: RecentMessage[] = [];

  constructor(options: DashboardOptions) {
    this.options = options;
    this.logger = options.logger ?? null;
    this.html_cache = get_dashboard_html();
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    try {
      await this.listen_on_port(this.options.port);
    } catch (error) {
      const code = String((error as { code?: string } | null)?.code || "");
      const allow_fallback = String(process.env.DASHBOARD_PORT_FALLBACK || "0").trim() === "1";
      if (!allow_fallback || (code !== "EACCES" && code !== "EADDRINUSE")) {
        this.server.close();
        this.server = null;
        throw error;
      }
      this.logger?.warn(`listen failed ${this.options.host}:${this.options.port} code=${code}; retry on ephemeral port`);
      try {
        await this.listen_on_port(0);
      } catch (fallback_error) {
        this.server?.close();
        this.server = null;
        throw fallback_error;
      }
    }
  }

  async stop(): Promise<void> {
    for (const client of this.sse_clients.values()) {
      client.res.end();
    }
    this.sse_clients.clear();
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    this.bound_port = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return { ok: this.server !== null, details: { port: this.bound_port, sse_clients: this.sse_clients.size } };
  }

  get_url(): string {
    const port = this.bound_port ?? this.options.port;
    return `http://${this.options.host}:${port}`;
  }

  private async listen_on_port(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, this.options.host, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    const addr = this.server?.address();
    if (addr && typeof addr === "object") {
      this.bound_port = Number((addr as AddressInfo).port || 0) || port;
    } else {
      this.bound_port = port;
    }
  }

  /** ProcessTracker on_change 콜백에서 호출. */
  broadcast_process_event(type: "start" | "end", entry: ProcessEntry): void {
    this._broadcast_sse(`event: process\ndata: ${JSON.stringify({ type, run_id: entry.run_id, alias: entry.alias, mode: entry.mode, status: entry.status, at: now_iso() })}\n\n`);
  }

  /** MessageBus on_publish 콜백에서 호출. */
  broadcast_message_event(direction: "inbound" | "outbound", sender_id: string, content?: string, chat_id?: string): void {
    const at = now_iso();
    this._recent_messages.push({ direction, sender_id, content: String(content || "").slice(0, 200), chat_id: chat_id || "", at });
    while (this._recent_messages.length > MAX_RECENT_MESSAGES) this._recent_messages.shift();
    this._broadcast_sse(`event: message\ndata: ${JSON.stringify({ direction, sender_id, at })}\n\n`);
  }

  /** CronService on_change 콜백에서 호출. */
  broadcast_cron_event(type: string, job_id?: string): void {
    this._broadcast_sse(`event: cron\ndata: ${JSON.stringify({ type, job_id: job_id ?? null, at: now_iso() })}\n\n`);
  }

  /** MessageBus progress 이벤트를 SSE로 릴레이. */
  broadcast_progress_event(event: ProgressEvent): void {
    this._broadcast_sse(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
  }

  /** Task 상태 변경을 SSE로 릴레이. */
  broadcast_task_event(type: "status_change", task: TaskState): void {
    this._broadcast_sse(`event: task\ndata: ${JSON.stringify({ type, taskId: task.taskId, status: task.status, exitReason: task.exitReason, currentStep: task.currentStep, at: now_iso() })}\n\n`);
  }

  /** AgentEvent(도구 실행, 완료, 에러 등)를 SSE로 릴레이. */
  broadcast_agent_event(event: import("../agent/agent.types.js").AgentEvent): void {
    const slim = { type: event.type, backend: event.source.backend, task_id: event.source.task_id, at: event.at, ..._pick_agent_event_fields(event) };
    this._broadcast_sse(`event: agent\ndata: ${JSON.stringify(slim)}\n\n`);
  }

  private _broadcast_sse(payload: string): void {
    const dead: string[] = [];
    for (const [id, client] of this.sse_clients.entries()) {
      try { client.res.write(payload); } catch { dead.push(id); }
    }
    for (const id of dead) this.sse_clients.delete(id);
  }

  private async _build_merged_tasks(): Promise<Array<{ taskId: string; title: string; status: string; currentStep?: string; exitReason?: string; currentTurn: number; maxTurns: number; chat_id: string; objective: string; updatedAt: string }>> {
    const loop_tasks = this.options.agent.list_runtime_tasks();
    const stored_tasks = await this.options.agent.list_stored_tasks();
    const task_map = new Map<string, (typeof stored_tasks)[number]>();
    for (const row of stored_tasks) task_map.set(row.taskId, row);
    for (const row of loop_tasks) task_map.set(row.taskId, row);
    return [...task_map.values()].map((t) => {
      const memory = (t.memory || {}) as Record<string, unknown>;
      const workflow = (memory.workflow && typeof memory.workflow === "object")
        ? (memory.workflow as Record<string, unknown>)
        : {};
      return {
        taskId: t.taskId,
        title: t.title,
        status: t.status,
        currentStep: t.currentStep,
        exitReason: t.exitReason,
        currentTurn: t.currentTurn,
        maxTurns: t.maxTurns,
        chat_id: String(memory.chat_id || ""),
        objective: String(memory.objective || "").slice(0, 200),
        updatedAt: String(memory.__updated_at_seoul || workflow.at || ""),
      };
    });
  }

  private async build_state(): Promise<Record<string, unknown>> {
    const queue = this.options.bus.get_sizes();
    const channel_status = this.options.channels.get_status();
    const ops = this.options.ops.status();
    const heartbeat = this.options.heartbeat.status();
    const tasks = await this._build_merged_tasks();
    const subagents = this.options.agent.list_subagents();
    const messages = this._recent_messages.slice(-20).reverse();
    const lastBySender = new Map<string, string>();
    for (const m of messages) {
      if (!lastBySender.has(m.sender_id)) lastBySender.set(m.sender_id, m.content);
    }

    const agents = subagents.map((a) => ({
      id: a.id,
      label: a.label || a.id,
      role: a.role,
      model: a.model,
      status: a.status,
      session_id: a.session_id,
      created_at: a.created_at,
      updated_at: a.updated_at,
      last_error: a.last_error,
      last_result: a.last_result ? a.last_result.slice(0, 200) : undefined,
      last_message: lastBySender.get(`subagent:${a.id}`) || "",
    }));
    const decisions = await this.options.decisions.get_effective_decisions({ include_p2: true });
    const workflow_events = await this.options.events.list({ limit: 40 });

    const tracker = this.options.process_tracker;
    const _map_process = (p: ProcessEntry) => ({
      run_id: p.run_id, provider: p.provider, chat_id: p.chat_id,
      sender_id: p.sender_id, alias: p.alias, mode: p.mode, status: p.status,
      executor_provider: p.executor_provider,
      started_at: p.started_at, ended_at: p.ended_at,
      loop_id: p.loop_id, task_id: p.task_id,
      subagent_ids: p.subagent_ids,
      tool_calls_count: p.tool_calls_count, error: p.error,
    });
    const processes = {
      active: (tracker?.list_active() ?? []).map(_map_process),
      recent: (tracker?.list_recent(20) ?? []).map(_map_process),
    };

    const cron_sched = this.options.cron;
    const cron = cron_sched ? await (async () => {
      const st = await cron_sched.status();
      const jobs = await cron_sched.list_jobs(true);
      return {
        ...st,
        jobs: jobs.map((j) => ({
          id: j.id, name: j.name, enabled: j.enabled,
          schedule: j.schedule, state: j.state,
          delete_after_run: j.delete_after_run,
          payload: j.payload,
        })),
      };
    })() : null;

    const approvals = this.options.agent.list_approval_requests("pending").map((a) => ({
      request_id: a.request_id, tool_name: a.tool_name, status: a.status,
      created_at: a.created_at, context: a.context,
    }));
    const active_loops = this.options.agent.list_active_loops().map((l) => ({
      loopId: l.loopId, agentId: l.agentId, objective: l.objective,
      currentTurn: l.currentTurn, maxTurns: l.maxTurns, status: l.status,
    }));
    const cd_score = this.options.stats_ops?.get_cd_score() ?? null;

    return {
      now: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false }).replace(" ", "T") + "+09:00",
      queue,
      channels: {
        enabled: channel_status.enabled_channels,
        mention_loop_running: channel_status.mention_loop_running,
        health: this.options.channels.get_channel_health(),
        active_runs: this.options.channels.get_active_run_count(),
      },
      heartbeat,
      ops,
      agents,
      tasks,
      messages,
      processes,
      approvals,
      active_loops,
      cd_score,
      cron,
      decisions: decisions.map((d) => ({
        id: d.id,
        canonical_key: d.canonical_key,
        value: d.value,
        priority: d.priority,
      })),
      workflow_events: workflow_events.map((e) => ({
        event_id: e.event_id,
        task_id: e.task_id,
        run_id: e.run_id,
        agent_id: e.agent_id,
        phase: e.phase,
        summary: e.summary,
        at: e.at,
      })),
    };
  }

  private _serve_html(res: ServerResponse): void {
    set_no_cache(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(this.html_cache);
  }

  private add_sse_client(res: ServerResponse): void {
    const id = rand_id();
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Connection", "keep-alive");
    set_no_cache(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ id, at: now_iso() })}\n\n`);
    const client: SseClient = { id, res };
    this.sse_clients.set(id, client);
    res.on("close", () => {
      this.sse_clients.delete(id);
    });
  }

  private _json(res: ServerResponse, status: number, data: unknown): void {
    set_no_cache(res);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
  }

  private _read_json_body(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      });
      req.on("error", () => resolve(null));
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const base_port = this.bound_port ?? this.options.port;
    const url = new URL(req.url || "/", `http://${this.options.host}:${base_port}`);

    // --- 대시보드 HTML ---
    if (url.pathname === "/" || url.pathname === "/index.html") {
      this._serve_html(res);
      return;
    }

    // --- API: state / events ---
    if (url.pathname === "/api/state") {
      this._json(res, 200, await this.build_state());
      return;
    }
    if (url.pathname === "/api/events") {
      this.add_sse_client(res);
      return;
    }

    // --- 프로세스 관리 API ---
    if (url.pathname === "/api/processes") {
      const tracker = this.options.process_tracker;
      this._json(res, 200, { active: tracker?.list_active() ?? [], recent: tracker?.list_recent(20) ?? [] });
      return;
    }
    const process_cancel_match = url.pathname.match(/^\/api\/processes\/([^/]+)\/cancel$/);
    if (req.method === "POST" && process_cancel_match) {
      const tracker = this.options.process_tracker;
      if (!tracker) { this._json(res, 503, { error: "process_tracker_unavailable" }); return; }
      const result = await tracker.cancel(process_cancel_match[1]);
      this._json(res, result.cancelled ? 200 : 404, result);
      return;
    }
    const process_id_match = url.pathname.match(/^\/api\/processes\/([^/]+)$/);
    if (process_id_match) {
      const entry = this.options.process_tracker?.get(process_id_match[1]);
      this._json(res, entry ? 200 : 404, entry ?? { error: "not_found" });
      return;
    }

    // --- 에이전트 관리 API ---
    if (url.pathname === "/api/agents") {
      this._json(res, 200, this.options.agent.list_subagents());
      return;
    }
    const agent_cancel_match = url.pathname.match(/^\/api\/agents\/([^/]+)\/cancel$/);
    if (req.method === "POST" && agent_cancel_match) {
      const ok = this.options.agent.cancel_subagent(agent_cancel_match[1]);
      this._json(res, ok ? 200 : 404, { cancelled: ok });
      return;
    }
    const agent_send_match = url.pathname.match(/^\/api\/agents\/([^/]+)\/send$/);
    if (req.method === "POST" && agent_send_match) {
      const body = await this._read_json_body(req);
      const text = String(body?.text || "").trim();
      if (!text) { this._json(res, 400, { error: "text_required" }); return; }
      const ok = this.options.agent.send_input_to_subagent(agent_send_match[1], text);
      this._json(res, ok ? 200 : 404, { sent: ok });
      return;
    }

    // --- 승인 관리 API ---
    if (url.pathname === "/api/approvals" && req.method === "GET") {
      const status = url.searchParams.get("status") || undefined;
      this._json(res, 200, this.options.agent.list_approval_requests(status as never));
      return;
    }
    const approval_id_match = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
    if (approval_id_match && req.method === "GET") {
      const item = this.options.agent.get_approval_request(decodeURIComponent(approval_id_match[1]));
      this._json(res, item ? 200 : 404, item ?? { error: "not_found" });
      return;
    }
    const approval_resolve_match = url.pathname.match(/^\/api\/approvals\/([^/]+)\/resolve$/);
    if (req.method === "POST" && approval_resolve_match) {
      const approval_id = decodeURIComponent(approval_resolve_match[1]);
      const body = await this._read_json_body(req);
      const text = String(body?.text || "approve").trim();
      const result = this.options.agent.resolve_approval_request(approval_id, text);
      if (!result.ok) { this._json(res, 404, result); return; }
      if (result.decision === "approve") {
        const exec = await this.options.agent.execute_approved_request(approval_id);
        this._json(res, 200, { ...result, execution: exec });
        return;
      }
      // 거부/취소 → 좀비 방지: 연결된 Task 즉시 취소
      if (result.status === "denied" || result.status === "cancelled") {
        const request = this.options.agent.get_approval_request(approval_id);
        const task_id = request?.context?.task_id;
        if (task_id) {
          await this.options.task_ops?.cancel_task(task_id, `dashboard_approval_${result.status}`);
        }
      }
      this._json(res, 200, result);
      return;
    }

    // --- Loop 관리 API ---
    if (url.pathname === "/api/loops" && req.method === "GET") {
      this._json(res, 200, this.options.agent.list_active_loops());
      return;
    }
    const loop_stop_match = url.pathname.match(/^\/api\/loops\/([^/]+)\/stop$/);
    if (req.method === "POST" && loop_stop_match) {
      const body = await this._read_json_body(req);
      const reason = String(body?.reason || "stopped_from_dashboard").trim();
      const result = this.options.agent.stop_loop(decodeURIComponent(loop_stop_match[1]), reason);
      this._json(res, result ? 200 : 404, result ?? { error: "not_found" });
      return;
    }

    // --- Stats API ---
    if (url.pathname === "/api/stats/cd-score" && req.method === "GET") {
      const stats = this.options.stats_ops;
      if (!stats) { this._json(res, 503, { error: "stats_unavailable" }); return; }
      this._json(res, 200, stats.get_cd_score());
      return;
    }
    if (url.pathname === "/api/stats/cd-score/reset" && req.method === "POST") {
      const stats = this.options.stats_ops;
      if (!stats) { this._json(res, 503, { error: "stats_unavailable" }); return; }
      stats.reset_cd_score();
      this._json(res, 200, { ok: true });
      return;
    }

    // --- 크론 관리 API ---
    if (url.pathname === "/api/cron/jobs" && req.method === "GET") {
      const cron = this.options.cron;
      if (!cron) { this._json(res, 503, { error: "cron_unavailable" }); return; }
      const include_disabled = url.searchParams.get("include_disabled") === "1";
      this._json(res, 200, await cron.list_jobs(include_disabled));
      return;
    }
    if (url.pathname === "/api/cron/status" && req.method === "GET") {
      const cron = this.options.cron;
      if (!cron) { this._json(res, 503, { error: "cron_unavailable" }); return; }
      this._json(res, 200, await cron.status());
      return;
    }
    const cron_enable_match = url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)\/enable$/);
    if (req.method === "POST" && cron_enable_match) {
      const cron = this.options.cron;
      if (!cron) { this._json(res, 503, { error: "cron_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const enabled = body?.enabled !== false;
      const job = await cron.enable_job(cron_enable_match[1], enabled);
      this._json(res, job ? 200 : 404, job ?? { error: "not_found" });
      return;
    }
    const cron_run_match = url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)\/run$/);
    if (req.method === "POST" && cron_run_match) {
      const cron = this.options.cron;
      if (!cron) { this._json(res, 503, { error: "cron_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const force = body?.force === true;
      const ok = await cron.run_job(cron_run_match[1], force);
      this._json(res, ok ? 200 : 404, { ok });
      return;
    }
    const cron_delete_match = url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)$/);
    if (req.method === "DELETE" && cron_delete_match) {
      const cron = this.options.cron;
      if (!cron) { this._json(res, 503, { error: "cron_unavailable" }); return; }
      const removed = await cron.remove_job(cron_delete_match[1]);
      this._json(res, removed ? 200 : 404, { removed });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cron/pause") {
      const cron = this.options.cron;
      if (!cron) { this._json(res, 503, { error: "cron_unavailable" }); return; }
      await cron.pause();
      this._json(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cron/resume") {
      const cron = this.options.cron;
      if (!cron) { this._json(res, 503, { error: "cron_unavailable" }); return; }
      await cron.resume();
      this._json(res, 200, { ok: true });
      return;
    }

    // --- 태스크 관리 API ---
    if (url.pathname === "/api/tasks" && req.method === "GET") {
      this._json(res, 200, await this._build_merged_tasks());
      return;
    }
    const task_cancel_match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
    if (req.method === "POST" && task_cancel_match) {
      const ops = this.options.task_ops;
      if (!ops) { this._json(res, 503, { error: "task_ops_unavailable" }); return; }
      const result = await ops.cancel_task(task_cancel_match[1], "cancelled_from_dashboard");
      this._json(res, result ? 200 : 404, result ?? { error: "not_found" });
      return;
    }
    const task_resume_match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/resume$/);
    if (req.method === "POST" && task_resume_match) {
      const ops = this.options.task_ops;
      if (!ops) { this._json(res, 503, { error: "task_ops_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const text = String(body?.text || "").trim() || undefined;
      const result = await ops.resume_task(decodeURIComponent(task_resume_match[1]), text);
      this._json(res, result ? 200 : 404, result ?? { error: "not_found" });
      return;
    }
    const task_id_match = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (task_id_match && req.method === "GET") {
      const ops = this.options.task_ops;
      if (!ops) { this._json(res, 503, { error: "task_ops_unavailable" }); return; }
      const task = await ops.get_task(task_id_match[1]);
      this._json(res, task ? 200 : 404, task ?? { error: "not_found" });
      return;
    }

    // --- DLQ API ---
    if (url.pathname === "/api/dlq" && req.method === "GET") {
      const dlq = this.options.dlq;
      if (!dlq) { this._json(res, 503, { error: "dlq_unavailable" }); return; }
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50)));
      this._json(res, 200, await dlq.list(limit));
      return;
    }

    // --- Workflow Events API ---
    if (url.pathname === "/api/workflow-events" && req.method === "GET") {
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      const filter: import("../events/index.js").ListWorkflowEventsFilter = { limit, offset };
      const phase = url.searchParams.get("phase");
      if (phase) filter.phase = phase as import("../events/index.js").WorkflowPhase;
      const task_id = url.searchParams.get("task_id");
      if (task_id) filter.task_id = task_id;
      const run_id_param = url.searchParams.get("run_id");
      if (run_id_param) filter.run_id = run_id_param;
      const chat_id = url.searchParams.get("chat_id");
      if (chat_id) filter.chat_id = chat_id;
      this._json(res, 200, await this.options.events.list(filter));
      return;
    }

    // --- Task Detail API ---
    const task_detail_match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/detail$/);
    if (task_detail_match && req.method === "GET") {
      const detail = await this.options.events.read_task_detail(decodeURIComponent(task_detail_match[1]));
      this._json(res, 200, { task_id: task_detail_match[1], content: detail });
      return;
    }

    // --- healthz ---
    if (url.pathname === "/healthz") {
      this._json(res, 200, { ok: true, at: now_iso() });
      return;
    }

    res.statusCode = 404;
    res.end("not_found");
  }
}

/** AgentEvent에서 SSE 전송에 필요한 필드만 추출. 이벤트 타입별 핵심 정보. */
function _pick_agent_event_fields(event: import("../agent/agent.types.js").AgentEvent): Record<string, unknown> {
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
