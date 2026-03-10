import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
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
import type { ProcessTrackerLike } from "../orchestration/process-tracker.js";
import type { TaskState } from "../contracts.js";
import type { CronScheduler } from "../cron/index.js";
import type { DispatchDlqStoreLike } from "../channels/dlq-store.js";
import type { DispatchServiceLike } from "../channels/dispatch.service.js";
import type { SecretVaultLike } from "../security/secret-vault.js";
import type { SessionStoreLike } from "../session/index.js";
import { now_iso, error_message } from "../utils/common.js";
import type { WebhookStore } from "../services/webhook-store.service.js";
import { set_no_cache } from "./route-context.js";
import { SystemMetricsCollector } from "./system-metrics.js";
import type { RouteContext, RouteHandler } from "./route-context.js";
import { SseManager } from "./sse-manager.js";
import { MediaTokenStore } from "./media-store.js";
import { build_dashboard_state, build_merged_tasks } from "./state-builder.js";
import { resolve_web_dir, serve_static } from "./static-server.js";
import { handle_bootstrap } from "./routes/bootstrap.js";
import { handle_state } from "./routes/state.js";
import { handle_process } from "./routes/process.js";
import { handle_agent } from "./routes/agent.js";
import { handle_approval } from "./routes/approval.js";
import { handle_loop } from "./routes/loop.js";
import { handle_health } from "./routes/health.js";
import { handle_cron } from "./routes/cron.js";
import { handle_task } from "./routes/task.js";
import { handle_secret } from "./routes/secret.js";
import { handle_config } from "./routes/config.js";
import { handle_skill } from "./routes/skill.js";
import { handle_template } from "./routes/template.js";
import { handle_channel } from "./routes/channel.js";
import { handle_agent_provider } from "./routes/agent-provider.js";
import { handle_promise } from "./routes/promise.js";
import { handle_memory } from "./routes/memory.js";
import { handle_workspace } from "./routes/workspace.js";
import { handle_chat } from "./routes/chat.js";
import { handle_session } from "./routes/session.js";
import { handle_oauth } from "./routes/oauth.js";
import { handle_cli_auth } from "./routes/cli-auth.js";
import { handle_models } from "./routes/models.js";
import { handle_workflow, handle_workflow_node } from "./routes/workflows.js";
import { handle_kanban } from "./routes/kanban.js";
import { handle_references } from "./routes/references.js";

const RE_MEDIA_TOKEN = /^\/media\/([a-z0-9]{16,})$/i;

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
  model_purpose: "chat" | "embedding";
  supported_modes: string[];
  settings: Record<string, unknown>;
  connection_id?: string;
  created_at: string;
  updated_at: string;
  available: boolean;
  circuit_state: string;
  capabilities: Record<string, boolean> | null;
  token_configured: boolean;
}

export interface ProviderConnectionInfo {
  connection_id: string;
  provider_type: string;
  label: string;
  enabled: boolean;
  api_base?: string;
  token_configured: boolean;
  preset_count: number;
  created_at: string;
  updated_at: string;
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
    model_purpose?: string;
    supported_modes?: string[];
    settings?: Record<string, unknown>;
    token?: string;
    connection_id?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  update(instance_id: string, patch: {
    label?: string;
    enabled?: boolean;
    priority?: number;
    model_purpose?: string;
    supported_modes?: string[];
    settings?: Record<string, unknown>;
    token?: string;
    connection_id?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  remove(instance_id: string): Promise<{ ok: boolean; error?: string }>;
  test_availability(instance_id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
  list_provider_types(): string[];
  /** 프로바이더 타입에 대해 사용 가능한 모델 목록을 동적 조회. */
  list_models(provider_type: string, opts?: { api_key?: string; api_base?: string }): Promise<import("../services/model-catalog.js").ModelInfo[]>;

  // ── Connection (API 연결) ──
  list_connections(): Promise<ProviderConnectionInfo[]>;
  get_connection(connection_id: string): Promise<ProviderConnectionInfo | null>;
  create_connection(input: {
    connection_id: string;
    provider_type: string;
    label?: string;
    enabled?: boolean;
    api_base?: string;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  update_connection(connection_id: string, patch: {
    label?: string;
    enabled?: boolean;
    api_base?: string;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  remove_connection(connection_id: string): Promise<{ ok: boolean; error?: string }>;
  test_connection(connection_id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
}

export interface BootstrapOps {
  get_status(): { needed: boolean; providers: string[] };
  apply(input: {
    providers: Array<{ instance_id: string; provider_type: string; label?: string; enabled?: boolean; priority?: number; token?: string; settings?: Record<string, unknown> }>;
    executor?: string;
    orchestrator?: string;
    alias?: string;
    persona_name?: string;
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
  has_client_secret: boolean;
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

export interface DashboardModelOps {
  list(): Promise<Array<{ name: string; size: number; modified_at: string; digest: string; parameter_size?: string; quantization_level?: string }>>;
  pull(name: string): Promise<{ status: string; completed?: number; total?: number }>;
  pull_stream(name: string): AsyncGenerator<{ status: string; completed?: number; total?: number }>;
  delete(name: string): Promise<boolean>;
  list_active(): Promise<Array<{ name: string; size: number; size_vram: number; expires_at: string }>>;
  get_runtime_status(): Promise<Record<string, unknown>>;
  switch_model(name: string): Promise<Record<string, unknown>>;
}

export interface DashboardWorkflowOps {
  list(): Promise<import("../agent/phase-loop.types.js").PhaseLoopState[]>;
  get(workflow_id: string): Promise<import("../agent/phase-loop.types.js").PhaseLoopState | null>;
  create(input: Record<string, unknown>): Promise<{ ok: boolean; workflow_id?: string; error?: string }>;
  cancel(workflow_id: string): Promise<boolean>;
  get_messages(workflow_id: string, phase_id: string, agent_id: string): Promise<import("../agent/phase-loop.types.js").PhaseMessage[]>;
  send_message(workflow_id: string, phase_id: string, agent_id: string, content: string): Promise<{ ok: boolean; error?: string }>;
  list_templates(): import("../orchestration/workflow-loader.js").TemplateWithSlug[];
  get_template(name: string): import("../agent/phase-loop.types.js").WorkflowDefinition | null;
  save_template(name: string, definition: import("../agent/phase-loop.types.js").WorkflowDefinition): string;
  delete_template(name: string): boolean;
  import_template(yaml_content: string): { ok: boolean; name?: string; error?: string };
  export_template(name: string): string | null;
  list_roles(): Array<{ id: string; name: string; description: string; soul: string | null; heart: string | null; tools: string[] }>;
  /** 중단된 워크플로우를 영속 상태에서 재개. */
  resume(workflow_id: string): Promise<{ ok: boolean; error?: string }>;
  /** 워크플로우 자동화 설정 변경 (auto_approve, auto_resume). */
  update_settings(workflow_id: string, settings: { auto_approve?: boolean; auto_resume?: boolean }): Promise<{ ok: boolean; error?: string }>;
  /** 단일 노드 실행 (Run 모드). */
  run_single_node?(node: Record<string, unknown>, input_memory: Record<string, unknown>): Promise<{ ok: boolean; output?: unknown; duration_ms?: number; error?: string }>;
  /** 단일 노드 테스트 (Dry-run). */
  test_single_node?(node: Record<string, unknown>, input_memory: Record<string, unknown>): { ok: boolean; preview?: unknown; warnings?: string[] };
  /** 자연어 instruction으로 워크플로우 수정 제안. save:true 시 완료 후 템플릿으로 저장. */
  /** name: 파일 저장소에서 로드. workflow: 비저장 상태(미저장 변경 포함) 직접 전달. 둘 중 하나 필수. */
  suggest?(instruction: string, options: { name?: string; workflow?: Record<string, unknown>; provider_id?: string; model?: string; save?: boolean; on_patch?: (path: string, section: Record<string, unknown> | unknown[]) => void; on_stream?: (text: string) => void }): Promise<{ ok: boolean; workflow?: Record<string, unknown>; name?: string; error?: string }>;
}

export interface DashboardCliAuthOps {
  get_status(): Array<{ cli: string; authenticated: boolean; account?: string; error?: string }>;
  check(cli: string): Promise<{ cli: string; authenticated: boolean; account?: string; error?: string }>;
  check_all(): Promise<Array<{ cli: string; authenticated: boolean; account?: string; error?: string }>>;
}

export type DashboardOptions = {
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
  dispatch?: DispatchServiceLike | null;
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
  cli_auth_ops?: DashboardCliAuthOps | null;
  model_ops?: DashboardModelOps | null;
  workflow_ops?: DashboardWorkflowOps | null;
  kanban_store?: import("../services/kanban-store.js").KanbanStoreLike | null;
  kanban_rule_executor?: import("../services/kanban-rule-executor.js").KanbanRuleExecutor | (() => import("../services/kanban-rule-executor.js").KanbanRuleExecutor | null) | null;
  reference_store?: import("../services/reference-store.js").ReferenceStoreLike | null;
  default_alias?: string;
  workspace?: string;
  logger?: Logger | null;
};

export const MAX_CHAT_SESSIONS = 20;
export const MAX_MESSAGES_PER_SESSION = 500;

export type RecentMessage = { direction: "inbound" | "outbound"; sender_id: string; content: string; chat_id: string; at: string };

export type ChatMediaItem = { type: string; url: string; mime?: string; name?: string };
export type ChatSessionMessage = { direction: "user" | "assistant"; content: string; at: string; media?: ChatMediaItem[]; model?: string; provider_instance_id?: string };

export type ChatSession = {
  id: string;
  created_at: string;
  messages: ChatSessionMessage[];
  /** 사용자 지정 탭 이름 */
  name?: string;
};

export class DashboardService implements ServiceLike {
  readonly name = "dashboard";
  private readonly options: DashboardOptions;
  private readonly logger: Logger | null;
  private server: Server | null = null;
  private bound_port: number | null = null;
  private readonly _sse = new SseManager();
  private readonly web_dir: string;
  private readonly _chat_sessions = new Map<string, ChatSession>();
  private readonly session_store: SessionStoreLike | null;
  private readonly default_alias: string;
  private readonly _media: MediaTokenStore;
  private readonly _metrics = new SystemMetricsCollector();

  constructor(options: DashboardOptions) {
    this.options = options;
    this.logger = options.logger ?? null;
    this.web_dir = resolve_web_dir();
    this.session_store = options.session_store ?? null;
    this.default_alias = options.default_alias || "default";
    if (!options.workspace) throw new Error("workspace is required for DashboardService");
    const workspace_dir = resolve(options.workspace);
    this._media = new MediaTokenStore(workspace_dir);
    this._init_routes();
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
    this._sse.close_all();
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    this.bound_port = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return { ok: this.server !== null, details: { port: this.bound_port, sse_clients: this._sse.client_count } };
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

  /** SSE 브로드캐스트 접근. */
  get sse(): SseManager { return this._sse; }

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

  /** prefix → handler 라우트 맵. */
  private readonly route_map = new Map<string, RouteHandler>();
  private readonly fallback_routes: RouteHandler[] = [];

  private _init_routes(): void {
    this.route_map.set("/api/bootstrap", handle_bootstrap);
    this.route_map.set("/api/state", handle_state);
    this.route_map.set("/api/events", handle_state);
    this.route_map.set("/api/system/metrics", handle_state);
    this.route_map.set("/api/processes", handle_process);
    this.route_map.set("/api/agents", handle_agent);
    this.route_map.set("/api/approvals", handle_approval);
    this.route_map.set("/api/loops", handle_loop);
    this.route_map.set("/api/cron", handle_cron);
    this.route_map.set("/api/tasks", handle_task);
    this.route_map.set("/api/secrets", handle_secret);
    this.route_map.set("/api/config", handle_config);
    this.route_map.set("/api/locale", handle_config);
    this.route_map.set("/api/skills", handle_skill);
    this.route_map.set("/api/tools", handle_health);
    this.route_map.set("/api/templates", handle_template);
    this.route_map.set("/api/channels", handle_channel);
    this.route_map.set("/api/agents/providers", handle_agent_provider);
    this.route_map.set("/api/agents/connections", handle_agent_provider);
    this.route_map.set("/api/promises", handle_promise);
    this.route_map.set("/api/memory", handle_memory);
    this.route_map.set("/api/workspace", handle_workspace);
    this.route_map.set("/api/chat", handle_chat);
    this.route_map.set("/api/sessions", handle_session);
    this.route_map.set("/api/oauth", handle_oauth);
    this.route_map.set("/api/auth/cli", handle_cli_auth);
    this.route_map.set("/api/models", handle_models);
    this.route_map.set("/api/workflow/runs", handle_workflow);
    this.route_map.set("/api/workflow/roles", handle_workflow);
    this.route_map.set("/api/workflow/templates", handle_workflow);
    this.route_map.set("/api/workflow/suggest", handle_workflow);
    this.route_map.set("/api/workflow/suggest/stream", handle_workflow);
    this.route_map.set("/api/workflow/diagram", handle_workflow);
    this.route_map.set("/api/workflow/node", handle_workflow_node);
    this.route_map.set("/api/kanban", handle_kanban);
    this.route_map.set("/api/references", handle_references);
    this.route_map.set("/api/stats", handle_health);
    this.route_map.set("/api/dlq", handle_health);
    this.route_map.set("/api/workflow/events", handle_health);
    this.fallback_routes.push(handle_health);
  }

  private _build_route_context(req: IncomingMessage, res: ServerResponse, url: URL): RouteContext {
    return {
      req, res, url,
      options: this.options,
      json: (r, s, d) => this._json(r, s, d),
      read_body: (r) => this._read_json_body(r),
      add_sse_client: (r) => this._sse.add_client(r),
      build_state: () => build_dashboard_state(this.options, this._sse.recent_messages),
      build_merged_tasks: () => build_merged_tasks(this.options),
      recent_messages: this._sse.recent_messages,
      metrics: this._metrics,
      chat_sessions: this._chat_sessions,
      session_store: this.session_store,
      session_store_key: (id) => this._session_store_key(id),
      register_media_token: (abs) => this._media.register(abs),
      oauth_callback_handler: this._oauth_callback_handler,
      oauth_callback_html: (s, m) => this._oauth_callback_html(s, m),
      resolve_request_origin: (r) => this._resolve_request_origin(r),
      bus: this.options.bus,
      add_rich_stream_listener: (id, fn) => this._sse.add_rich_stream_listener(id, fn),
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const base_port = this.bound_port ?? this.options.port;
    const url = new URL(req.url || "/", `http://${this.options.host}:${base_port}`);

    // SPA / static
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.statusCode = 302; res.setHeader("Location", "/web/"); res.end(); return;
    }
    if (url.pathname.startsWith("/web")) { await serve_static(this.web_dir, url.pathname, res); return; }

    // 미디어 토큰
    const media_match = RE_MEDIA_TOKEN.exec(url.pathname);
    if (media_match && req.method === "GET") { await this._media.serve(media_match[1], res); return; }

    // API 라우트 디스패치: exact match 먼저, 그 다음 prefix 매칭
    const ctx = this._build_route_context(req, res, url);
    const direct = this.route_map.get(url.pathname);
    if (direct && await direct(ctx)) return;

    const segments = url.pathname.split("/").filter(Boolean);
    for (let depth = Math.min(segments.length, 3); depth >= 2; depth--) {
      const prefix = "/" + segments.slice(0, depth).join("/");
      const handler = this.route_map.get(prefix);
      if (handler && await handler(ctx)) return;
    }
    for (const handler of this.fallback_routes) {
      if (await handler(ctx)) return;
    }

    res.statusCode = 404;
    res.end("not_found");
  }

  /** SessionStore 키 생성 (session-recorder.ts의 session_key 형식과 일치). */
  /** Webhook 스토어 등록. main.ts에서 WebhookStore를 바인딩. */
  private _webhook_store?: WebhookStore;

  set_webhook_store(store: WebhookStore): void {
    this._webhook_store = store;
    // /hooks/* 경로를 fallback 라우트로 등록
    this.fallback_routes.unshift(async (ctx) => {
      if (!ctx.url.pathname.startsWith("/hooks/")) return false;
      const hook_path = ctx.url.pathname.slice(6); // "/hooks/foo" → "/foo"
      if (ctx.req.method === "GET" || ctx.req.method === "POST" || ctx.req.method === "PUT" || ctx.req.method === "DELETE") {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(ctx.req.headers)) {
          if (typeof v === "string") headers[k] = v;
        }
        const query: Record<string, string> = {};
        ctx.url.searchParams.forEach((v, k) => { query[k] = v; });

        let body: unknown = null;
        if (ctx.req.method !== "GET") {
          body = await ctx.read_body(ctx.req);
        }

        store.push(hook_path, {
          method: ctx.req.method,
          headers,
          body,
          query,
          received_at: now_iso(),
        });
        ctx.json(ctx.res, 200, { ok: true, path: hook_path });
        return true;
      }
      return false;
    });
  }

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
      this.logger?.warn(`web session restore failed: ${error_message(error)}`);
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
          const token = this._media.register(abs);
          return token ? { ...m, url: `/media/${token}` } : m;
        });
      }
      session.messages.push(msg);
      if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
        session.messages.splice(0, session.messages.length - MAX_MESSAGES_PER_SESSION);
      }
    }
  }
}
