import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, extname, resolve, relative, isAbsolute } from "node:path";
import { accessSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AgentInspectorLike } from "../agent/inspector.types.js";
import type { MessageBusLike } from "../bus/index.js";
import type { ChannelManager } from "../channels/index.js";
import type { DecisionService } from "../decision/index.js";
import type { PromiseService } from "../decision/promise.service.js";
import type { WorkflowEventService } from "../events/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { OpsRuntimeService } from "../ops/index.js";
import type { Logger } from "../logger.js";
import type { ServiceLike } from "../runtime/service.types.js";
import type { ProcessTrackerLike, ProcessEntry } from "../orchestration/process-tracker.js";
import type { TaskState } from "../contracts.js";
import type { CronScheduler } from "../cron/index.js";
import type { DispatchDlqStoreLike } from "../channels/dlq-store.js";
import type { SecretVaultLike } from "../security/secret-vault.js";
import type { ProgressEvent } from "../bus/types.js";
import type { SessionStoreLike } from "../session/index.js";
import { now_iso } from "../utils/common.js";
import { SystemMetricsCollector } from "./system-metrics.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".zip": "application/zip", ".gif": "image/gif",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mp3": "audio/mpeg",
};

const __dirname = join(fileURLToPath(import.meta.url), "..");
const PROJECT_ROOT = join(__dirname, "..", "..");

function resolve_web_dir(): string {
  const candidates = [
    join(PROJECT_ROOT, "dist", "web"),  // tsx dev: src/dashboard/ → ../../dist/web
    join(__dirname, "..", "web"),         // compiled: dist/dashboard/ → ../web
  ];
  for (const dir of candidates) {
    try { accessSync(join(dir, "index.html")); return dir; } catch { /* next */ }
  }
  return candidates[0];
}

export interface DashboardTaskOps {
  cancel_task(task_id: string, reason?: string): Promise<TaskState | null>;
  get_task(task_id: string): Promise<TaskState | null>;
  resume_task(task_id: string, user_input?: string): Promise<TaskState | null>;
}

export interface DashboardConfigOps {
  get_current_config(): Record<string, unknown>;
  get_sections(): Promise<Array<{ id: string; label: string; fields: unknown[] }>>;
  get_section(section: string): Promise<{ id: string; label: string; fields: unknown[] } | null>;
  set_value(path: string, value: unknown): Promise<void>;
  remove_value(path: string): Promise<void>;
}

export interface DashboardSkillOps {
  list_skills(): Array<Record<string, string>>;
  get_skill_detail(name: string): { metadata: Record<string, unknown> | null; content: string | null; references: Array<{ name: string; content: string }> | null };
  refresh(): void;
  upload_skill(name: string, zip_buffer: Buffer): { ok: boolean; path: string; error?: string };
  write_skill_file(name: string, file: string, content: string): { ok: boolean; error?: string };
}

export interface DashboardToolOps {
  tool_names(): string[];
  get_definitions(): Array<Record<string, unknown>>;
  list_mcp_servers(): Array<{ name: string; connected: boolean; tools: string[]; error?: string }>;
}

export interface DashboardTemplateOps {
  list(): Array<{ name: string; exists: boolean }>;
  read(name: string): string | null;
  write(name: string, content: string): { ok: boolean };
}

export interface DashboardStatsOps {
  get_cd_score(): { total: number; events: Array<{ indicator: string; points: number; context: string; at: string }> };
  reset_cd_score(): void;
}

export interface DashboardMemoryOps {
  read_longterm(): Promise<string>;
  write_longterm(content: string): Promise<void>;
  list_daily(): Promise<string[]>;
  read_daily(day?: string): Promise<string>;
  write_daily(content: string, day?: string): Promise<void>;
}

export interface DashboardWorkspaceOps {
  list_files(rel_path?: string): Promise<Array<{ name: string; rel: string; is_dir: boolean; size: number; mtime: number }>>;
  read_file(rel_path: string): Promise<string | null>;
}

export interface ChannelStatusInfo {
  provider: string;
  instance_id: string;
  label: string;
  enabled: boolean;
  running: boolean;
  healthy: boolean;
  last_error?: string;
  token_configured: boolean;
  default_target: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DashboardChannelOps {
  list(): Promise<ChannelStatusInfo[]>;
  get(instance_id: string): Promise<ChannelStatusInfo | null>;
  create(input: {
    instance_id: string;
    provider: string;
    label: string;
    enabled: boolean;
    settings: Record<string, unknown>;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  update(instance_id: string, patch: {
    label?: string;
    enabled?: boolean;
    settings?: Record<string, unknown>;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  remove(instance_id: string): Promise<{ ok: boolean; error?: string }>;
  test_connection(instance_id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
  list_providers(): string[];
}

export interface AgentProviderStatusInfo {
  instance_id: string;
  provider_type: string;
  label: string;
  enabled: boolean;
  priority: number;
  supported_modes: string[];
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  available: boolean;
  circuit_state: string;
  capabilities: Record<string, boolean> | null;
  token_configured: boolean;
}

export interface DashboardAgentProviderOps {
  list(): Promise<AgentProviderStatusInfo[]>;
  get(instance_id: string): Promise<AgentProviderStatusInfo | null>;
  create(input: {
    instance_id: string;
    provider_type: string;
    label?: string;
    enabled?: boolean;
    priority?: number;
    supported_modes?: string[];
    settings?: Record<string, unknown>;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  update(instance_id: string, patch: {
    label?: string;
    enabled?: boolean;
    priority?: number;
    supported_modes?: string[];
    settings?: Record<string, unknown>;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  remove(instance_id: string): Promise<{ ok: boolean; error?: string }>;
  test_availability(instance_id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
  list_provider_types(): string[];
}

export interface BootstrapOps {
  get_status(): { needed: boolean; providers: string[] };
  apply(input: {
    providers: Array<{ instance_id: string; provider_type: string; label?: string; enabled?: boolean; priority?: number; token?: string; settings?: Record<string, unknown> }>;
    executor?: string;
    orchestrator?: string;
    alias?: string;
  }): Promise<{ ok: boolean; error?: string }>;
}

export interface OAuthIntegrationInfo {
  instance_id: string;
  service_type: string;
  label: string;
  enabled: boolean;
  scopes: string[];
  token_configured: boolean;
  expired: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardOAuthOps {
  list(): Promise<OAuthIntegrationInfo[]>;
  get(id: string): Promise<OAuthIntegrationInfo | null>;
  create(input: {
    service_type: string;
    label: string;
    client_id: string;
    client_secret?: string;
    scopes: string[];
    auth_url?: string;
    token_url?: string;
  }): Promise<{ ok: boolean; instance_id?: string; error?: string }>;
  update(id: string, patch: {
    label?: string;
    enabled?: boolean;
    scopes?: string[];
  }): Promise<{ ok: boolean; error?: string }>;
  remove(id: string): Promise<{ ok: boolean; error?: string }>;
  /** Connect 버튼 클릭 시 client_secret(없으면 기존 vault 값 사용)으로 auth URL 반환. */
  start_auth(id: string, client_secret?: string, origin?: string): Promise<{ ok: boolean; auth_url?: string; error?: string }>;
  refresh(id: string): Promise<{ ok: boolean; error?: string }>;
  test(id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
  list_presets(): Array<{ service_type: string; label: string; auth_url: string; token_url: string; scopes_available: string[]; default_scopes: string[]; supports_refresh: boolean; is_builtin?: boolean; token_auth_method?: "basic" | "body"; scope_separator?: " " | ","; test_url?: string }>;
  register_preset(preset: {
    service_type: string; label: string; auth_url: string; token_url: string;
    scopes_available?: string[]; default_scopes?: string[]; supports_refresh?: boolean;
    token_auth_method?: "basic" | "body"; scope_separator?: " " | ","; test_url?: string;
    extra_auth_params?: Record<string, string>;
  }): Promise<{ ok: boolean; error?: string }>;
  update_preset(service_type: string, patch: {
    scopes_available?: string[]; default_scopes?: string[]; supports_refresh?: boolean;
    token_auth_method?: "basic" | "body"; scope_separator?: " " | ","; test_url?: string;
    auth_url?: string; token_url?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  unregister_preset(service_type: string): Promise<{ ok: boolean; error?: string }>;
}

type DashboardOptions = {
  host: string;
  port: number;
  port_fallback?: boolean;
  agent: AgentInspectorLike;
  bus: MessageBusLike;
  channels: ChannelManager;
  heartbeat: HeartbeatService;
  ops: OpsRuntimeService;
  decisions: DecisionService;
  promises: PromiseService;
  events: WorkflowEventService;
  process_tracker?: ProcessTrackerLike | null;
  cron?: CronScheduler | null;
  task_ops?: DashboardTaskOps | null;
  stats_ops?: DashboardStatsOps | null;
  dlq?: DispatchDlqStoreLike | null;
  secrets?: SecretVaultLike | null;
  config_ops?: DashboardConfigOps | null;
  skill_ops?: DashboardSkillOps | null;
  tool_ops?: DashboardToolOps | null;
  template_ops?: DashboardTemplateOps | null;
  channel_ops?: DashboardChannelOps | null;
  agent_provider_ops?: DashboardAgentProviderOps | null;
  bootstrap_ops?: BootstrapOps | null;
  session_store?: SessionStoreLike | null;
  memory_ops?: DashboardMemoryOps | null;
  workspace_ops?: DashboardWorkspaceOps | null;
  oauth_ops?: DashboardOAuthOps | null;
  default_alias?: string;
  workspace?: string;
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

type ChatMediaItem = { type: string; url: string; mime?: string; name?: string };
type ChatSessionMessage = { direction: "user" | "assistant"; content: string; at: string; media?: ChatMediaItem[] };

type ChatSession = {
  id: string;
  created_at: string;
  messages: ChatSessionMessage[];
};

const MAX_CHAT_SESSIONS = 20;

export class DashboardService implements ServiceLike {
  readonly name = "dashboard";
  private readonly options: DashboardOptions;
  private readonly logger: Logger | null;
  private server: Server | null = null;
  private bound_port: number | null = null;
  private readonly sse_clients = new Map<string, SseClient>();
  private readonly web_dir: string;
  private readonly _recent_messages: RecentMessage[] = [];
  private readonly _chat_sessions = new Map<string, ChatSession>();
  private readonly session_store: SessionStoreLike | null;
  private readonly default_alias: string;
  private readonly workspace_dir: string;
  private readonly _media_tokens = new Map<string, { abs_path: string; name: string; mime: string; created_at: number }>();
  private static readonly MEDIA_TOKEN_TTL_MS = 3_600_000;
  private readonly _metrics = new SystemMetricsCollector();

  constructor(options: DashboardOptions) {
    this.options = options;
    this.logger = options.logger ?? null;
    this.web_dir = resolve_web_dir();
    this.session_store = options.session_store ?? null;
    this.default_alias = options.default_alias || "default";
    this.workspace_dir = options.workspace ? resolve(options.workspace) : process.cwd();
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
      const allow_fallback = this.options.port_fallback ?? false;
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
    await this._restore_web_sessions();
    this._metrics.start();
  }

  async stop(): Promise<void> {
    this._metrics.stop();
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
    this._broadcast_sse(`event: task\ndata: ${JSON.stringify({ type, taskId: task.taskId, title: task.title, status: task.status, exitReason: task.exitReason, currentStep: task.currentStep, currentTurn: task.currentTurn, maxTurns: task.maxTurns, channel: task.channel, chatId: task.chatId, objective: (task.objective || "").slice(0, 200), at: now_iso() })}\n\n`);
  }

  /** 웹 채팅 스트리밍 청크를 SSE로 릴레이. */
  broadcast_web_stream(chat_id: string, content: string, done: boolean): void {
    this._broadcast_sse(`event: web_stream\ndata: ${JSON.stringify({ chat_id, content, done })}\n\n`);
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

  private async _build_merged_tasks(): Promise<Array<{ taskId: string; title: string; status: string; currentStep?: string; exitReason?: string; currentTurn: number; maxTurns: number; channel: string; chat_id: string; objective: string; updatedAt: string }>> {
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
      // taskId 패턴 "adhoc|task:${provider}:${chat_id}:..." 에서 provider 추출
      const id_parts = t.taskId.split(":");
      const channel_from_id = (id_parts[0] === "adhoc" || id_parts[0] === "task") ? id_parts[1] || "" : "";
      return {
        taskId: t.taskId,
        title: t.title,
        status: t.status,
        currentStep: t.currentStep,
        exitReason: t.exitReason,
        currentTurn: t.currentTurn,
        maxTurns: t.maxTurns,
        channel: t.channel || String(memory.channel || channel_from_id),
        chat_id: t.chatId || String(memory.chat_id || ""),
        objective: (t.objective || String(memory.objective || "")).slice(0, 200),
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
    const promises = await this.options.promises.get_effective_promises({ include_p2: true });
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
      promises: promises.map((p) => ({
        id: p.id,
        canonical_key: p.canonical_key,
        value: p.value,
        priority: p.priority,
        scope: p.scope,
        source: p.source,
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
      agent_providers: this.options.agent_provider_ops
        ? await this.options.agent_provider_ops.list()
        : [],
    };
  }

  /** workspace 내부 경로인지 확인. relative()로 경로 탈출 차단. */
  private _is_within_workspace(abs: string): boolean {
    const rel = relative(this.workspace_dir, abs);
    return !rel.startsWith("..") && !isAbsolute(rel);
  }

  /** 로컬 파일을 1회용 토큰으로 등록. workspace 외부는 등록 거부. */
  private _register_media_token(abs_path: string): string | null {
    if (!this._is_within_workspace(abs_path)) return null;
    this._prune_media_tokens();
    const token = rand_id() + rand_id();
    const ext = extname(abs_path).toLowerCase();
    const name = abs_path.split(/[\\/]/).pop() || "file";
    this._media_tokens.set(token, { abs_path, name, mime: MIME_TYPES[ext] || "application/octet-stream", created_at: Date.now() });
    return token;
  }

  private _prune_media_tokens(): void {
    const now = Date.now();
    for (const [token, entry] of this._media_tokens) {
      if (now - entry.created_at > DashboardService.MEDIA_TOKEN_TTL_MS) this._media_tokens.delete(token);
    }
  }

  /** 토큰으로 등록된 파일 서빙. 만료/미존재 → 404. */
  private async _serve_media_token(token: string, res: ServerResponse): Promise<void> {
    const entry = this._media_tokens.get(token);
    if (!entry || Date.now() - entry.created_at > DashboardService.MEDIA_TOKEN_TTL_MS) {
      this._media_tokens.delete(token);
      res.statusCode = 404; res.end("not_found"); return;
    }
    try {
      const data = await readFile(entry.abs_path);
      res.statusCode = 200;
      res.setHeader("Content-Type", entry.mime);
      res.setHeader("Content-Disposition", `attachment; filename="${entry.name}"`);
      res.setHeader("Cache-Control", "no-store");
      res.end(data);
    } catch {
      res.statusCode = 404; res.end("not_found");
    }
  }

  /** dist/web/ 정적 파일 서빙. 파일 없으면 index.html (SPA fallback). */
  private async _serve_static(pathname: string, res: ServerResponse): Promise<void> {
    const rel = pathname.replace(/^\/web\/?/, "") || "index.html";
    const safe = rel.replace(/\.\./g, "");
    const file_path = join(this.web_dir, safe);
    try {
      const data = await readFile(file_path);
      const ext = extname(file_path);
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
      if (ext === ".html") set_no_cache(res);
      else res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(data);
    } catch {
      // SPA fallback → index.html
      try {
        const index = await readFile(join(this.web_dir, "index.html"));
        set_no_cache(res);
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(index);
      } catch {
        res.statusCode = 404;
        res.end("not_found");
      }
    }
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

  private _resolve_request_origin(req: IncomingMessage): string {
    const proto = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "";
    if (host) return `${proto}://${host}`;
    const port = this.bound_port ?? this.options.port;
    return `http://localhost:${port}`;
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

    // --- 대시보드 SPA ---
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.statusCode = 302;
      res.setHeader("Location", "/web/");
      res.end();
      return;
    }
    if (url.pathname.startsWith("/web")) {
      await this._serve_static(url.pathname, res);
      return;
    }

    // --- Bootstrap API ---
    if (url.pathname === "/api/bootstrap/status" && req.method === "GET") {
      const ops = this.options.bootstrap_ops;
      if (!ops) { this._json(res, 503, { error: "bootstrap_unavailable" }); return; }
      this._json(res, 200, ops.get_status());
      return;
    }
    if (url.pathname === "/api/bootstrap" && req.method === "POST") {
      const ops = this.options.bootstrap_ops;
      if (!ops) { this._json(res, 503, { error: "bootstrap_unavailable" }); return; }
      const body = await this._read_json_body(req);
      if (!body) { this._json(res, 400, { error: "invalid_body" }); return; }
      const result = await ops.apply(body as Parameters<typeof ops.apply>[0]);
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }

    // --- API: 시스템 메트릭 ---
    if (url.pathname === "/api/system-metrics") {
      this._json(res, 200, this._metrics.get_latest() ?? {});
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

    // --- Secrets API ---
    if (url.pathname === "/api/secrets" && req.method === "GET") {
      const vault = this.options.secrets;
      if (!vault) { this._json(res, 503, { error: "secrets_unavailable" }); return; }
      const names = await vault.list_names();
      this._json(res, 200, { names });
      return;
    }
    if (url.pathname === "/api/secrets" && req.method === "POST") {
      const vault = this.options.secrets;
      if (!vault) { this._json(res, 503, { error: "secrets_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const name = String(body?.name || "").trim();
      const value = String(body?.value ?? "");
      if (!name) { this._json(res, 400, { error: "name_required" }); return; }
      const result = await vault.put_secret(name, value);
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }
    const secret_name_match = url.pathname.match(/^\/api\/secrets\/([^/]+)$/);
    if (secret_name_match && req.method === "DELETE") {
      const vault = this.options.secrets;
      if (!vault) { this._json(res, 503, { error: "secrets_unavailable" }); return; }
      const removed = await vault.remove_secret(decodeURIComponent(secret_name_match[1]));
      this._json(res, removed ? 200 : 404, { removed });
      return;
    }

    // --- Config API ---
    if (url.pathname === "/api/config" && req.method === "GET") {
      const ops = this.options.config_ops;
      if (!ops) { this._json(res, 503, { error: "config_unavailable" }); return; }
      this._json(res, 200, { raw: ops.get_current_config(), sections: await ops.get_sections() });
      return;
    }
    const config_section_match = url.pathname.match(/^\/api\/config\/sections\/([^/]+)$/);
    if (config_section_match && req.method === "GET") {
      const ops = this.options.config_ops;
      if (!ops) { this._json(res, 503, { error: "config_unavailable" }); return; }
      const section = await ops.get_section(decodeURIComponent(config_section_match[1]));
      this._json(res, section ? 200 : 404, section ?? { error: "section_not_found" });
      return;
    }
    if (url.pathname === "/api/config/values" && req.method === "PUT") {
      const ops = this.options.config_ops;
      if (!ops) { this._json(res, 503, { error: "config_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const { path: field_path, value } = (body ?? {}) as { path?: string; value?: unknown };
      if (!field_path) { this._json(res, 400, { error: "path_required" }); return; }
      await ops.set_value(field_path, value);
      this._json(res, 200, { ok: true, path: field_path });
      return;
    }
    const config_value_match = url.pathname.match(/^\/api\/config\/values\/(.+)$/);
    if (config_value_match && req.method === "DELETE") {
      const ops = this.options.config_ops;
      if (!ops) { this._json(res, 503, { error: "config_unavailable" }); return; }
      await ops.remove_value(decodeURIComponent(config_value_match[1]));
      this._json(res, 200, { ok: true, restored: "default" });
      return;
    }

    // --- Skills API ---
    if (url.pathname === "/api/skills" && req.method === "GET") {
      const ops = this.options.skill_ops;
      if (!ops) { this._json(res, 503, { error: "skills_unavailable" }); return; }
      this._json(res, 200, ops.list_skills());
      return;
    }
    if (url.pathname === "/api/skills/refresh" && req.method === "POST") {
      const ops = this.options.skill_ops;
      if (!ops) { this._json(res, 503, { error: "skills_unavailable" }); return; }
      ops.refresh();
      this._json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/skills/import" && req.method === "POST") {
      const ops = this.options.skill_ops;
      if (!ops) { this._json(res, 503, { error: "skills_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const name = String(body?.name || "").trim();
      const zip_b64 = String(body?.zip_b64 || "").trim();
      if (!name || !/^[\w][\w.-]*$/.test(name)) { this._json(res, 400, { error: "invalid_name" }); return; }
      if (!zip_b64) { this._json(res, 400, { error: "zip_required" }); return; }
      const zip_buffer = Buffer.from(zip_b64, "base64");
      const result = ops.upload_skill(name, zip_buffer);
      this._json(res, result.ok ? 200 : 500, result);
      return;
    }
    const skill_detail_match = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
    if (skill_detail_match && req.method === "GET") {
      const ops = this.options.skill_ops;
      if (!ops) { this._json(res, 503, { error: "skills_unavailable" }); return; }
      const detail = ops.get_skill_detail(decodeURIComponent(skill_detail_match[1]));
      this._json(res, detail.metadata ? 200 : 404, detail);
      return;
    }
    if (skill_detail_match && req.method === "PUT") {
      const ops = this.options.skill_ops;
      if (!ops) { this._json(res, 503, { error: "skills_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const file = String(body?.file || "").trim();
      const content = String(body?.content ?? "");
      if (!file) { this._json(res, 400, { error: "file_required" }); return; }
      const result = ops.write_skill_file(decodeURIComponent(skill_detail_match[1]), file, content);
      this._json(res, result.ok ? 200 : 500, result);
      return;
    }

    // --- Tools API ---
    if (url.pathname === "/api/tools" && req.method === "GET") {
      const ops = this.options.tool_ops;
      if (!ops) { this._json(res, 503, { error: "tools_unavailable" }); return; }
      // Claude Code SDK가 제공하는 네이티브 도구 (claude_sdk/codex_appserver 백엔드)
      const CLAUDE_CODE_NATIVE_TOOLS = [
        "Bash", "Read", "Write", "Edit", "Glob", "Grep",
        "Agent", "WebFetch", "WebSearch",
        "NotebookRead", "NotebookEdit",
        "TodoWrite", "TodoRead",
      ];
      this._json(res, 200, {
        names: ops.tool_names(),
        definitions: ops.get_definitions(),
        mcp_servers: ops.list_mcp_servers(),
        native_tools: CLAUDE_CODE_NATIVE_TOOLS,
      });
      return;
    }

    // --- Templates API ---
    if (url.pathname === "/api/templates" && req.method === "GET") {
      const ops = this.options.template_ops;
      if (!ops) { this._json(res, 503, { error: "templates_unavailable" }); return; }
      this._json(res, 200, ops.list());
      return;
    }
    const template_name_match = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
    if (template_name_match && req.method === "GET") {
      const ops = this.options.template_ops;
      if (!ops) { this._json(res, 503, { error: "templates_unavailable" }); return; }
      const content = ops.read(decodeURIComponent(template_name_match[1]));
      this._json(res, content !== null ? 200 : 404, { name: template_name_match[1], content });
      return;
    }
    if (template_name_match && req.method === "PUT") {
      const ops = this.options.template_ops;
      if (!ops) { this._json(res, 503, { error: "templates_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const content = String(body?.content ?? "");
      const result = ops.write(decodeURIComponent(template_name_match[1]), content);
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }

    // --- Channel Instances API ---
    if (url.pathname === "/api/channel-instances" && req.method === "GET") {
      const ops = this.options.channel_ops;
      if (!ops) { this._json(res, 503, { error: "channel_ops_unavailable" }); return; }
      this._json(res, 200, await ops.list());
      return;
    }
    if (url.pathname === "/api/channel-instances/providers" && req.method === "GET") {
      const ops = this.options.channel_ops;
      if (!ops) { this._json(res, 503, { error: "channel_ops_unavailable" }); return; }
      this._json(res, 200, ops.list_providers());
      return;
    }
    if (url.pathname === "/api/channel-instances" && req.method === "POST") {
      const ops = this.options.channel_ops;
      if (!ops) { this._json(res, 503, { error: "channel_ops_unavailable" }); return; }
      const body = await this._read_json_body(req);
      if (!body) { this._json(res, 400, { error: "invalid_body" }); return; }
      const result = await ops.create(body as Parameters<typeof ops.create>[0]);
      this._json(res, result.ok ? 201 : 400, result);
      return;
    }
    const ci_match = url.pathname.match(/^\/api\/channel-instances\/([^/]+)$/);
    if (ci_match) {
      const ops = this.options.channel_ops;
      if (!ops) { this._json(res, 503, { error: "channel_ops_unavailable" }); return; }
      const id = decodeURIComponent(ci_match[1]);
      if (req.method === "GET") {
        const info = await ops.get(id);
        if (!info) { this._json(res, 404, { error: "not_found" }); return; }
        this._json(res, 200, info);
        return;
      }
      if (req.method === "PUT") {
        const body = await this._read_json_body(req);
        if (!body) { this._json(res, 400, { error: "invalid_body" }); return; }
        const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
        this._json(res, result.ok ? 200 : 400, result);
        return;
      }
      if (req.method === "DELETE") {
        const result = await ops.remove(id);
        this._json(res, result.ok ? 200 : 404, result);
        return;
      }
    }
    const ci_test_match = url.pathname.match(/^\/api\/channel-instances\/([^/]+)\/test$/);
    if (req.method === "POST" && ci_test_match) {
      const ops = this.options.channel_ops;
      if (!ops) { this._json(res, 503, { error: "channel_ops_unavailable" }); return; }
      const result = await ops.test_connection(decodeURIComponent(ci_test_match[1]));
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }
    // Legacy channel-status (후방 호환)
    if (url.pathname === "/api/channel-status" && req.method === "GET") {
      const ops = this.options.channel_ops;
      if (!ops) { this._json(res, 503, { error: "channel_ops_unavailable" }); return; }
      this._json(res, 200, await ops.list());
      return;
    }

    // --- Agent Providers API ---
    if (url.pathname === "/api/agent-providers" && req.method === "GET") {
      const ops = this.options.agent_provider_ops;
      if (!ops) { this._json(res, 503, { error: "agent_provider_ops_unavailable" }); return; }
      this._json(res, 200, await ops.list());
      return;
    }
    if (url.pathname === "/api/agent-providers/types" && req.method === "GET") {
      const ops = this.options.agent_provider_ops;
      if (!ops) { this._json(res, 503, { error: "agent_provider_ops_unavailable" }); return; }
      this._json(res, 200, ops.list_provider_types());
      return;
    }
    if (url.pathname === "/api/agent-providers" && req.method === "POST") {
      const ops = this.options.agent_provider_ops;
      if (!ops) { this._json(res, 503, { error: "agent_provider_ops_unavailable" }); return; }
      const body = await this._read_json_body(req);
      if (!body) { this._json(res, 400, { error: "invalid_body" }); return; }
      const result = await ops.create(body as Parameters<typeof ops.create>[0]);
      this._json(res, result.ok ? 201 : 400, result);
      return;
    }
    const ap_match = url.pathname.match(/^\/api\/agent-providers\/([^/]+)$/);
    if (ap_match) {
      const ops = this.options.agent_provider_ops;
      if (!ops) { this._json(res, 503, { error: "agent_provider_ops_unavailable" }); return; }
      const id = decodeURIComponent(ap_match[1]);
      if (req.method === "GET") {
        const info = await ops.get(id);
        if (!info) { this._json(res, 404, { error: "not_found" }); return; }
        this._json(res, 200, info);
        return;
      }
      if (req.method === "PUT") {
        const body = await this._read_json_body(req);
        if (!body) { this._json(res, 400, { error: "invalid_body" }); return; }
        const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
        this._json(res, result.ok ? 200 : 400, result);
        return;
      }
      if (req.method === "DELETE") {
        const result = await ops.remove(id);
        this._json(res, result.ok ? 200 : 404, result);
        return;
      }
    }
    const ap_test_match = url.pathname.match(/^\/api\/agent-providers\/([^/]+)\/test$/);
    if (req.method === "POST" && ap_test_match) {
      const ops = this.options.agent_provider_ops;
      if (!ops) { this._json(res, 503, { error: "agent_provider_ops_unavailable" }); return; }
      const result = await ops.test_availability(decodeURIComponent(ap_test_match[1]));
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }

    // --- Promises API ---
    if (url.pathname === "/api/promises" && req.method === "GET") {
      const all = await this.options.promises.list_promises({ status: "active", limit: 100 });
      this._json(res, 200, all.map((p) => ({ id: p.id, canonical_key: p.canonical_key, value: p.value, priority: p.priority, scope: p.scope, source: p.source, rationale: p.rationale })));
      return;
    }
    if (url.pathname === "/api/promises" && req.method === "POST") {
      const body = await this._read_json_body(req);
      if (!body || !body.key || !body.value) { this._json(res, 400, { error: "key_and_value_required" }); return; }
      const result = await this.options.promises.append_promise({
        scope: (body.scope as "global") || "global",
        key: String(body.key),
        value: String(body.value),
        priority: (typeof body.priority === "number" && [0, 1, 2, 3].includes(body.priority) ? body.priority : 0) as 0 | 1 | 2 | 3,
        source: "user",
        rationale: body.rationale ? String(body.rationale) : undefined,
      });
      this._json(res, 201, { action: result.action, id: result.record.id });
      return;
    }
    const promise_delete_match = url.pathname.match(/^\/api\/promises\/([^/]+)$/);
    if (req.method === "DELETE" && promise_delete_match) {
      const id = decodeURIComponent(promise_delete_match[1]);
      const ok = await this.options.promises.archive_promise(id);
      this._json(res, ok ? 200 : 404, ok ? { archived: true } : { error: "not_found" });
      return;
    }

    // --- 미디어 토큰 다운로드 (토큰이 유일한 접근 경로 — 경로 직접 노출 없음) ---
    const media_token_match = url.pathname.match(/^\/media\/([a-z0-9]{16,})$/i);
    if (media_token_match && req.method === "GET") {
      await this._serve_media_token(media_token_match[1], res);
      return;
    }

    // --- Memory API ---
    if (url.pathname === "/api/memory/longterm" && req.method === "GET") {
      if (!this.options.memory_ops) { this._json(res, 503, { error: "memory_unavailable" }); return; }
      const content = await this.options.memory_ops.read_longterm();
      this._json(res, 200, { content });
      return;
    }
    if (url.pathname === "/api/memory/longterm" && req.method === "PUT") {
      if (!this.options.memory_ops) { this._json(res, 503, { error: "memory_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const content = String(body?.content ?? "");
      await this.options.memory_ops.write_longterm(content);
      this._json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/memory/daily" && req.method === "GET") {
      if (!this.options.memory_ops) { this._json(res, 503, { error: "memory_unavailable" }); return; }
      const days = await this.options.memory_ops.list_daily();
      this._json(res, 200, { days });
      return;
    }
    const memory_daily_match = url.pathname.match(/^\/api\/memory\/daily\/([^/]+)$/);
    if (memory_daily_match && req.method === "GET") {
      if (!this.options.memory_ops) { this._json(res, 503, { error: "memory_unavailable" }); return; }
      const day = decodeURIComponent(memory_daily_match[1]);
      const content = await this.options.memory_ops.read_daily(day);
      this._json(res, 200, { content, day });
      return;
    }
    if (memory_daily_match && req.method === "PUT") {
      if (!this.options.memory_ops) { this._json(res, 503, { error: "memory_unavailable" }); return; }
      const day = decodeURIComponent(memory_daily_match[1]);
      const body = await this._read_json_body(req);
      const content = String(body?.content ?? "");
      await this.options.memory_ops.write_daily(content, day);
      this._json(res, 200, { ok: true });
      return;
    }

    // --- Workspace API ---
    if (url.pathname === "/api/workspace/ls" && req.method === "GET") {
      if (!this.options.workspace_ops) { this._json(res, 503, { error: "workspace_unavailable" }); return; }
      const rel = url.searchParams.get("path") ?? "";
      const entries = await this.options.workspace_ops.list_files(rel);
      this._json(res, 200, { entries });
      return;
    }
    if (url.pathname === "/api/workspace/read" && req.method === "GET") {
      if (!this.options.workspace_ops) { this._json(res, 503, { error: "workspace_unavailable" }); return; }
      const rel = url.searchParams.get("path") ?? "";
      const content = await this.options.workspace_ops.read_file(rel);
      if (content === null) { this._json(res, 404, { error: "not_found" }); return; }
      this._json(res, 200, { content, path: rel });
      return;
    }

    // --- Chat API (HTTP 기반) ---
    if (url.pathname === "/api/chat/sessions" && req.method === "GET") {
      const sessions = [...this._chat_sessions.values()].map((s) => ({
        id: s.id,
        created_at: s.created_at,
        message_count: s.messages.length,
      }));
      this._json(res, 200, sessions);
      return;
    }
    if (url.pathname === "/api/chat/sessions" && req.method === "POST") {
      const id = `web_${rand_id()}`;
      const session: ChatSession = { id, created_at: now_iso(), messages: [] };
      this._chat_sessions.set(id, session);
      if (this._chat_sessions.size > MAX_CHAT_SESSIONS) {
        const oldest = this._chat_sessions.keys().next().value;
        if (oldest) this._chat_sessions.delete(oldest);
      }
      if (this.session_store) {
        const store_session = await this.session_store.get_or_create(this._session_store_key(id));
        await this.session_store.save(store_session);
      }
      this._json(res, 200, { id, created_at: session.created_at });
      return;
    }
    const chat_session_match = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)$/);
    if (chat_session_match && req.method === "GET") {
      const session = this._chat_sessions.get(chat_session_match[1]);
      this._json(res, session ? 200 : 404, session ?? { error: "not_found" });
      return;
    }
    if (chat_session_match && req.method === "DELETE") {
      const deleted = this._chat_sessions.delete(chat_session_match[1]);
      await this.session_store?.delete?.(this._session_store_key(chat_session_match[1]));
      this._json(res, deleted ? 200 : 404, { deleted });
      return;
    }
    const chat_send_match = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/send$/);
    if (req.method === "POST" && chat_send_match) {
      const session = this._chat_sessions.get(chat_send_match[1]);
      if (!session) { this._json(res, 404, { error: "session_not_found" }); return; }
      const body = await this._read_json_body(req);
      const text = String(body?.content || "").trim();
      const media_raw = Array.isArray(body?.media) ? (body.media as unknown[]) : [];
      const media: ChatMediaItem[] = media_raw
        .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        .map((m) => ({ type: String(m.type || "file"), url: String(m.url || ""), mime: m.mime ? String(m.mime) : undefined, name: m.name ? String(m.name) : undefined }))
        .filter((m) => m.url);
      if (!text && media.length === 0) { this._json(res, 400, { error: "content_or_media_required" }); return; }
      const user_msg: ChatSessionMessage = { direction: "user", content: text, at: now_iso() };
      if (media.length > 0) user_msg.media = media;
      session.messages.push(user_msg);
      // bus에 인바운드 메시지 발행 → 채널 매니저가 처리
      await this.options.bus.publish_inbound({
        id: `web_msg_${rand_id()}`,
        provider: "web",
        channel: "web",
        sender_id: "web_user",
        chat_id: session.id,
        content: text,
        at: now_iso(),
        media: media.length > 0 ? media.map((m) => ({ type: m.type as import("../bus/types.js").MediaItemType, url: m.url, mime: m.mime, name: m.name })) : undefined,
      });
      this._json(res, 200, { ok: true, message_count: session.messages.length });
      return;
    }

    // --- Sessions API (전체 채널) ---
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      const store = this.session_store;
      if (!store?.list_by_prefix) { this._json(res, 200, []); return; }
      const provider_filter = url.searchParams.get("provider") ?? "";
      const prefix = provider_filter ? `${provider_filter}:` : "";
      const entries = await store.list_by_prefix(prefix, 200);
      const list = entries.map((e) => {
        const parts = e.key.split(":");
        return {
          key: e.key,
          provider: parts[0] ?? "",
          chat_id: parts[1] ?? "",
          alias: parts[2] ?? "",
          thread: parts[3] ?? "main",
          created_at: e.created_at,
          updated_at: e.updated_at,
          message_count: e.message_count,
        };
      });
      this._json(res, 200, list);
      return;
    }
    const sessions_key_match = url.pathname.match(/^\/api\/sessions\/(.+)$/);
    if (sessions_key_match && req.method === "GET") {
      const store = this.session_store;
      if (!store) { this._json(res, 503, { error: "session_store_unavailable" }); return; }
      const key = decodeURIComponent(sessions_key_match[1]);
      const session = await store.get_or_create(key);
      const parts = key.split(":");
      const messages = session.messages.map((m) => ({
        direction: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: String(m.content || ""),
        at: String((m as Record<string, unknown>).timestamp || (m as Record<string, unknown>).at || session.created_at),
      }));
      this._json(res, 200, {
        key,
        provider: parts[0] ?? "",
        chat_id: parts[1] ?? "",
        created_at: session.created_at,
        messages,
      });
      return;
    }

    // --- OAuth API ---
    if (url.pathname === "/api/oauth/presets" && req.method === "GET") {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      this._json(res, 200, ops.list_presets());
      return;
    }
    if (url.pathname === "/api/oauth/presets" && req.method === "POST") {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      const body = await this._read_json_body(req);
      if (!body || typeof (body as Record<string, unknown>).service_type !== "string") {
        this._json(res, 400, { error: "service_type required" }); return;
      }
      const result = await ops.register_preset(body as Parameters<typeof ops.register_preset>[0]);
      this._json(res, result.ok ? 201 : 400, result);
      return;
    }
    const oauth_preset_match = url.pathname.match(/^\/api\/oauth\/presets\/([^/]+)$/);
    if (oauth_preset_match && req.method === "PUT") {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      const body = await this._read_json_body(req);
      if (!body) { this._json(res, 400, { error: "invalid_body" }); return; }
      const result = await ops.update_preset(decodeURIComponent(oauth_preset_match[1]), body as Parameters<typeof ops.update_preset>[1]);
      this._json(res, result.ok ? 200 : 404, result);
      return;
    }
    if (oauth_preset_match && req.method === "DELETE") {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      const result = await ops.unregister_preset(decodeURIComponent(oauth_preset_match[1]));
      this._json(res, result.ok ? 200 : 404, result);
      return;
    }
    if (url.pathname === "/api/oauth/integrations" && req.method === "GET") {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      this._json(res, 200, await ops.list());
      return;
    }
    if (url.pathname === "/api/oauth/integrations" && req.method === "POST") {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      const body = await this._read_json_body(req);
      if (!body) { this._json(res, 400, { error: "invalid_body" }); return; }
      const result = await ops.create(body as Parameters<typeof ops.create>[0]);
      this._json(res, result.ok ? 201 : 400, result);
      return;
    }
    const oauth_match = url.pathname.match(/^\/api\/oauth\/integrations\/([^/]+)$/);
    if (oauth_match) {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      const id = decodeURIComponent(oauth_match[1]);
      if (req.method === "GET") {
        const info = await ops.get(id);
        if (!info) { this._json(res, 404, { error: "not_found" }); return; }
        this._json(res, 200, info);
        return;
      }
      if (req.method === "PUT") {
        const body = await this._read_json_body(req);
        if (!body) { this._json(res, 400, { error: "invalid_body" }); return; }
        const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
        this._json(res, result.ok ? 200 : 400, result);
        return;
      }
      if (req.method === "DELETE") {
        const result = await ops.remove(id);
        this._json(res, result.ok ? 200 : 404, result);
        return;
      }
    }
    const oauth_auth_match = url.pathname.match(/^\/api\/oauth\/integrations\/([^/]+)\/auth$/);
    if (req.method === "POST" && oauth_auth_match) {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      const body = await this._read_json_body(req);
      const client_secret = (body as Record<string, unknown>)?.client_secret as string | undefined;
      const origin = this._resolve_request_origin(req);
      const result = await ops.start_auth(decodeURIComponent(oauth_auth_match[1]), client_secret, origin);
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }
    const oauth_refresh_match = url.pathname.match(/^\/api\/oauth\/integrations\/([^/]+)\/refresh$/);
    if (req.method === "POST" && oauth_refresh_match) {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      const result = await ops.refresh(decodeURIComponent(oauth_refresh_match[1]));
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }
    const oauth_test_match = url.pathname.match(/^\/api\/oauth\/integrations\/([^/]+)\/test$/);
    if (req.method === "POST" && oauth_test_match) {
      const ops = this.options.oauth_ops;
      if (!ops) { this._json(res, 503, { error: "oauth_ops_unavailable" }); return; }
      const result = await ops.test(decodeURIComponent(oauth_test_match[1]));
      this._json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (url.pathname === "/api/oauth/callback" && req.method === "GET") {
      const ops = this.options.oauth_ops;
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error_param = url.searchParams.get("error");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (error_param) {
        res.statusCode = 400;
        res.end(this._oauth_callback_html(false, error_param));
        return;
      }
      if (!ops || !code || !state) {
        res.statusCode = 400;
        res.end(this._oauth_callback_html(false, "missing code or state"));
        return;
      }
      // handle_callback은 DashboardOAuthOps에는 없으므로 start_auth의 콜백 체인으로 처리
      // 하지만 실제로는 ops에 노출되지 않은 내부 로직이므로 별도 처리 필요
      // → main.ts에서 callback_handler를 주입하는 방식으로 처리
      const cb = (this as unknown as { _oauth_callback_handler?: (code: string, state: string) => Promise<{ ok: boolean; instance_id?: string; error?: string }> })._oauth_callback_handler;
      if (!cb) {
        res.statusCode = 503;
        res.end(this._oauth_callback_html(false, "callback handler not configured"));
        return;
      }
      const result = await cb(code, state);
      res.statusCode = result.ok ? 200 : 400;
      res.end(this._oauth_callback_html(result.ok, result.ok ? "Authorization successful" : (result.error || "unknown error")));
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

  /** SessionStore 키 생성 (session-recorder.ts의 session_key 형식과 일치). */
  /** OAuth 콜백 핸들러 등록. main.ts에서 OAuthFlowService.handle_callback을 바인딩. */
  _oauth_callback_handler?: (code: string, state: string) => Promise<{ ok: boolean; instance_id?: string; error?: string }>;

  set_oauth_callback_handler(handler: (code: string, state: string) => Promise<{ ok: boolean; instance_id?: string; error?: string }>): void {
    this._oauth_callback_handler = handler;
  }

  private _oauth_callback_html(success: boolean, message: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>OAuth ${success ? "Success" : "Error"}</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.box{text-align:center;padding:2rem;border-radius:12px;background:#16213e;max-width:400px}
.icon{font-size:3rem;margin-bottom:1rem}
.msg{color:${success ? "#4ade80" : "#f87171"};font-size:1.1rem;margin-bottom:1rem}</style></head>
<body><div class="box"><div class="icon">${success ? "&#10004;" : "&#10006;"}</div>
<div class="msg">${message.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)}</div>
<p>이 창은 자동으로 닫힙니다.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`;
  }

  private _session_store_key(chat_id: string): string {
    return `web:${chat_id}:${this.default_alias}:main`;
  }

  /** SessionStore에서 web 세션을 복원하여 _chat_sessions에 로드. */
  private async _restore_web_sessions(): Promise<void> {
    const store = this.session_store;
    if (!store?.list_by_prefix) return;
    try {
      const entries = await store.list_by_prefix("web:", MAX_CHAT_SESSIONS);
      for (const entry of entries) {
        // key 형식: "web:{chat_id}:{alias}:main"
        const parts = entry.key.split(":");
        if (parts.length < 2) continue;
        const chat_id = parts[1];
        if (!chat_id || this._chat_sessions.has(chat_id)) continue;
        const session = await store.get_or_create(entry.key);
        const messages: ChatSession["messages"] = session.messages.map((m) => ({
          direction: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
          content: String(m.content || ""),
          at: String(m.timestamp || session.created_at),
        }));
        this._chat_sessions.set(chat_id, { id: chat_id, created_at: session.created_at, messages });
      }
      if (this._chat_sessions.size > 0) {
        this.logger?.info(`restored ${this._chat_sessions.size} web chat session(s)`);
      }
    } catch (error) {
      this.logger?.warn(`web session restore failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 아웃바운드 메시지를 chat 세션에 추가 (provider=web인 메시지 캡처용). */
  capture_web_outbound(chat_id: string, content: string, media?: ChatMediaItem[]): void {
    const session = this._chat_sessions.get(chat_id);
    if (session) {
      const msg: ChatSessionMessage = { direction: "assistant", content, at: now_iso() };
      if (media && media.length > 0) {
        msg.media = media.map((m) => {
          if (!m.url || m.url.startsWith("http://") || m.url.startsWith("https://")) return m;
          const abs = resolve(m.url);
          const token = this._register_media_token(abs);
          return token ? { ...m, url: `/media/${token}` } : m;
        });
      }
      session.messages.push(msg);
    }
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
