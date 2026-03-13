import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import type { Logger } from "../logger.js";
import type { ServiceLike } from "../runtime/service.types.js";
import { now_iso, error_message } from "../utils/common.js";
import type { WebhookStore } from "../services/webhook-store.service.js";
// 타입 정의는 service.types.ts로 분리 — 하위 호환성을 위해 여기서 re-export
export type {
  DashboardTaskOps, DashboardConfigOps, DashboardSkillOps, DashboardToolOps,
  DashboardTemplateOps, DashboardStatsOps, DashboardMemoryOps, DashboardWorkspaceOps,
  ChannelStatusInfo, DashboardChannelOps, AgentProviderStatusInfo, ProviderConnectionInfo,
  DashboardAgentProviderOps, BootstrapOps, OAuthIntegrationInfo, DashboardOAuthOps,
  DashboardModelOps, DashboardWorkflowOps, DashboardCliAuthOps, DashboardPromptOps, DashboardUsageOps,
  DashboardOptions, RecentMessage, ChatMediaItem, ChatSessionMessage, ChatSession,
} from "./service.types.js";
import { MAX_CHAT_SESSIONS, MAX_MESSAGES_PER_SESSION } from "./service.types.js";
import type { DashboardOptions, ChatSession, ChatSessionMessage, ChatMediaItem } from "./service.types.js";
import type { SessionStoreLike } from "../session/index.js";
import { set_no_cache } from "./route-context.js";
import { SystemMetricsCollector } from "./system-metrics.js";
import type { RouteContext, RouteHandler } from "./route-context.js";
import { create_correlation } from "../observability/correlation.js";
import { NOOP_OBSERVABILITY, type ObservabilityLike } from "../observability/context.js";
import { correlation_to_log_context } from "../logger.js";
import { SseManager } from "./sse-manager.js";
import { MediaTokenStore } from "./media-store.js";
import { build_dashboard_state, build_merged_tasks } from "./state-builder.js";
import { ScopedMemoryOpsCache } from "./ops/memory.js";
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
import { handle_agent_definition } from "./routes/agent-definition.js";
import { handle_prompt } from "./routes/prompt.js";
import { handle_usage } from "./routes/usage.js";
import { dispatch_webhook } from "./routes/webhook.js";
import { handle_auth } from "./routes/auth.js";
import { handle_admin } from "./routes/admin.js";
import { handle_team_providers } from "./routes/team-providers.js";
import { extract_token } from "../auth/auth-middleware.js";
import { TeamStore } from "../auth/team-store.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const RE_MEDIA_TOKEN = /^\/media\/([a-z0-9]{16,})$/i;

// --- 하위 호환성 상수 재노출 ---
export { MAX_CHAT_SESSIONS, MAX_MESSAGES_PER_SESSION };

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
  private readonly _obs: ObservabilityLike;
  private readonly _memory_cache: ScopedMemoryOpsCache | null;

  constructor(options: DashboardOptions) {
    this.options = options;
    this.logger = options.logger ?? null;
    this._obs = options.observability ?? NOOP_OBSERVABILITY;
    this.web_dir = resolve_web_dir();
    this.session_store = options.session_store ?? null;
    this.default_alias = options.default_alias || "default";
    if (!options.workspace) throw new Error("workspace is required for DashboardService");
    const workspace_dir = resolve(options.workspace);
    this._media = new MediaTokenStore(workspace_dir);
    this._memory_cache = options.memory_store_factory
      ? new ScopedMemoryOpsCache(options.memory_store_factory)
      : null;
    this._init_routes();
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        this.logger?.error("handle_request_error", { url: req.url, error: error_message(err) });
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("internal_server_error");
        }
      });
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

  private _read_json_body(req: IncomingMessage, res: ServerResponse, max_bytes = 1_048_576): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > max_bytes) {
          req.destroy();
          if (!res.headersSent) {
            res.statusCode = 413;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "payload_too_large" }));
          }
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
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
    // auth 라우트는 인증 검사 전에 처리해야 하므로 가장 먼저 등록
    this.route_map.set("/api/auth", handle_auth);
    this.route_map.set("/api/admin", handle_admin);
    this.route_map.set("/api/teams", handle_team_providers);
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
    this.route_map.set("/api/agent-definitions", handle_agent_definition);
    this.route_map.set("/api/prompt", handle_prompt);
    this.route_map.set("/api/usage", handle_usage);
    this.route_map.set("/api/stats", handle_health);
    this.route_map.set("/api/dlq", handle_health);
    this.route_map.set("/api/workflow/events", handle_health);
    this.fallback_routes.push(handle_health);
  }

  private _build_route_context(req: IncomingMessage, res: ServerResponse, url: URL): RouteContext {
    const auth_user = ((req as unknown as Record<string, unknown>)["_auth_user"] as import("../auth/auth-service.js").JwtPayload | undefined) ?? null;
    const team_context = ((req as unknown as Record<string, unknown>)["_team_context"] as import("./route-context.js").TeamContext | undefined) ?? null;
    const resolver = this.options.workspace_resolver;
    const workspace_layers = resolver ? resolver.layers_for_jwt(auth_user) : [this.options.workspace ?? ""];
    const personal_dir = resolver ? resolver.personal_dir(auth_user) : (this.options.workspace ?? "");
    const tid = auth_user?.tid ?? "";
    const uid = auth_user?.sub ?? "";
    return {
      req, res, url,
      options: this.options,
      auth_user,
      team_context,
      workspace_runtime: (tid && uid && this.options.workspace_registry)
        ? this.options.workspace_registry.get_or_create({ team_id: tid, user_id: uid })
        : null,
      workspace_layers,
      personal_dir,
      json: (r, s, d) => this._json(r, s, d),
      read_body: (r) => this._read_json_body(r, res),
      add_sse_client: (r, tid) => this._sse.add_client(r, tid),
      build_state: (team_id?: string) => build_dashboard_state(this.options, this._sse.recent_messages, team_id),
      build_merged_tasks: (team_id?: string) => build_merged_tasks(this.options, team_id),
      recent_messages: this._sse.recent_messages,
      metrics: this._metrics,
      chat_sessions: this._chat_sessions,
      session_store: this.session_store,
      session_store_key: (id) => this._session_store_key(tid, uid, id),
      register_media_token: (abs) => this._media.register(abs),
      oauth_callback_handler: this._oauth_callback_handler,
      oauth_callback_html: (s, m) => this._oauth_callback_html(s, m),
      resolve_request_origin: (r) => this._resolve_request_origin(r),
      bus: this.options.bus,
      add_rich_stream_listener: (id, fn) => this._sse.add_rich_stream_listener(id, fn),
      get_scoped_memory_ops: () => {
        if (this._memory_cache && personal_dir && personal_dir !== (this.options.workspace ?? "")) {
          return this._memory_cache.get(personal_dir);
        }
        return this.options.memory_ops ?? null;
      },
      correlation: create_correlation({
        team_id: tid || undefined,
        user_id: uid || undefined,
        workspace_dir: this.options.workspace,
      }),
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const base_port = this.bound_port ?? this.options.port;
    const url = new URL(req.url || "/", `http://${this.options.host}:${base_port}`);

    // SPA / static
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.statusCode = 302; res.setHeader("Location", "/web/"); res.end(); return;
    }
    if (url.pathname.startsWith("/web") || url.pathname.startsWith("/assets/")) {
      const web_path = url.pathname.startsWith("/assets/") ? `/web${url.pathname}` : url.pathname;
      await serve_static(this.web_dir, web_path, res); return;
    }

    // 미디어 토큰
    const media_match = RE_MEDIA_TOKEN.exec(url.pathname);
    if (media_match && req.method === "GET") { await this._media.serve(media_match[1], res); return; }

    // JWT 인증 미들웨어 (auth_svc 설정 시에만 적용)
    if (this.options.auth_svc && url.pathname.startsWith("/api/")) {
      const is_public = url.pathname === "/api/auth/status"
        || url.pathname === "/api/auth/setup"
        || url.pathname === "/api/auth/login";
      if (!is_public) {
        const token = extract_token(req);
        const payload = token ? this.options.auth_svc.verify_token(token) : null;
        if (!payload) {
          this._json(res, 401, { error: "unauthorized" });
          return;
        }
        // 1단계: wdir 구조 무결성 — DB 불필요, O(1)
        const expected_wdir = `tenants/${payload.tid}/users/${payload.sub}`;
        if (payload.wdir !== expected_wdir) {
          this._json(res, 401, { error: "invalid_token" });
          return;
        }
        // 2단계: DB 신선도 — 삭제된/비활성 사용자 감지
        const db_user = this.options.auth_svc.get_user_by_id(payload.sub);
        if (!db_user || db_user.disabled_at) {
          this._json(res, 401, { error: "unauthorized" });
          return;
        }
        // 3단계: 팀 멤버십 검증 — JWT의 tid가 실제 멤버십인지 확인 (팀 전환 후에도 유효)
        // superadmin은 모든 팀 접근 허용. 일반 유저는 TeamStore 멤버십 필수.
        let team_role: import("../auth/team-store.js").TeamRole = "member";
        if (db_user.system_role !== "superadmin" && payload.tid && payload.tid !== "default") {
          const workspace = this.options.workspace ?? "";
          const team_db = join(workspace, "tenants", payload.tid, "team.db");
          if (!existsSync(team_db)) {
            this._json(res, 403, { error: "team_not_found" });
            return;
          }
          const membership = new TeamStore(team_db, payload.tid).get_membership(payload.sub);
          if (!membership) {
            this._json(res, 403, { error: "not_a_member" });
            return;
          }
          team_role = membership.role;
        } else if (db_user.system_role === "superadmin") {
          team_role = "owner";
        }
        // 검증된 페이로드를 요청 객체에 첨부 (라우트 핸들러에서 접근 가능)
        (req as unknown as Record<string, unknown>)["_auth_user"] = payload;
        // Phase 8-23: team_context 주입
        if (payload.tid) {
          (req as unknown as Record<string, unknown>)["_team_context"] = { team_id: payload.tid, team_role };
        }
        // workspace_middleware: 개인 워크스페이스 디렉토리 보장 (lazy init)
        this.options.workspace_registry?.get_or_create({ team_id: payload.tid, user_id: payload.sub });
      }
    }

    // OB-5: API 라우트 디스패치 — span + metrics 계측
    const ctx = this._build_route_context(req, res, url);
    const method = req.method || "GET";
    const route_start = Date.now();
    const span = this._obs.spans.start("dashboard_route", `${method} ${url.pathname}`, ctx.correlation, { method, path: url.pathname });

    try {
      const direct = this.route_map.get(url.pathname);
      if (direct && await direct(ctx)) { span.end("ok"); this._record_request_metrics(method, url.pathname, route_start); return; }

      const segments = url.pathname.split("/").filter(Boolean);
      for (let depth = Math.min(segments.length, 3); depth >= 2; depth--) {
        const prefix = "/" + segments.slice(0, depth).join("/");
        const handler = this.route_map.get(prefix);
        if (handler && await handler(ctx)) { span.end("ok"); this._record_request_metrics(method, url.pathname, route_start); return; }
      }
      for (const handler of this.fallback_routes) {
        if (await handler(ctx)) { span.end("ok"); this._record_request_metrics(method, url.pathname, route_start); return; }
      }

      res.statusCode = 404;
      res.end("not_found");
      span.end("ok", { status_code: 404 });
      this._record_request_metrics(method, url.pathname, route_start);
    } catch (err) {
      span.fail(error_message(err));
      this._obs.metrics.counter("http_requests_total", 1, { method, status: "error" });
      this._obs.metrics.histogram("http_request_duration_ms", Date.now() - route_start, { method });
      throw err;
    }
  }

  private _record_request_metrics(method: string, _path: string, start: number): void {
    this._obs.metrics.counter("http_requests_total", 1, { method });
    this._obs.metrics.histogram("http_request_duration_ms", Date.now() - start, { method });
  }

  /** Webhook 스토어 + /hooks/wake, /hooks/agent 엔드포인트 등록. */
  private _webhook_store?: WebhookStore;

  set_webhook_store(store: WebhookStore): void {
    this._webhook_store = store;
    const bus = this.options.bus;
    const webhook_secret = this.options.webhookSecret;
    this.fallback_routes.unshift(async (ctx) => {
      if (!ctx.url.pathname.startsWith("/hooks/")) return false;
      return dispatch_webhook(
        {
          webhook_store: store,
          webhook_secret,
          publish_inbound: (msg) => bus ? bus.publish_inbound(msg) : Promise.resolve(),
          json: ctx.json,
          read_body: ctx.read_body,
        },
        ctx.req, ctx.res, ctx.url,
      );
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

  private _session_store_key(team_id: string, user_id: string, chat_id: string): string {
    return `web:${team_id}:${user_id}:${chat_id}:${this.default_alias}:main`;
  }

  /** SessionStore에서 web 세션을 복원하여 _chat_sessions에 로드. */
  private async _restore_web_sessions(): Promise<void> {
    const store = this.session_store;
    if (!store?.list_by_prefix) return;
    try {
      const entries = await store.list_by_prefix("web:", MAX_CHAT_SESSIONS);
      for (const entry of entries) {
        // key 형식: "web:{team_id}:{user_id}:{chat_id}:{alias}:main"
        const parts = entry.key.split(":");
        if (parts.length < 5) continue;
        const team_id = parts[1] ?? "";
        const user_id = parts[2] ?? "";
        const chat_id = parts[3];
        if (!chat_id || this._chat_sessions.has(chat_id)) continue;
        const session = await store.get_or_create(entry.key);
        const messages: ChatSession["messages"] = session.messages.map((m) => ({
          direction: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
          content: String(m.content || ""),
          at: String(m.timestamp || session.created_at),
        }));
        this._chat_sessions.set(chat_id, { id: chat_id, user_id, team_id, created_at: session.created_at, messages });
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
      const store_key = this._session_store_key(session.team_id, session.user_id, chat_id);
      this.session_store?.append_message(store_key, { role: "assistant", content, timestamp: now_iso() }).catch(() => {});
    }
  }
}
