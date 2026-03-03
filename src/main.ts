import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentDomain } from "./agent/index.js";
import { create_agent_inspector } from "./agent/inspector.service.js";
import { create_agent_runtime } from "./agent/runtime.service.js";
import { CronTool, MemoryTool, DecisionTool, SecretTool, PromiseTool, TaskQueryTool } from "./agent/tools/index.js";
import { MessageBus } from "./bus/index.js";
import {
  ChannelManager,
  SqliteDispatchDlqStore,
  ChannelInstanceStore,
  create_channels_from_store,
  create_channel_instance,
  type ChannelRegistryLike,
} from "./channels/index.js";
import { ApprovalService } from "./channels/approval.service.js";
import {
  CommandRouter,
  HelpHandler,
  StopHandler,
  RenderHandler,
  SecretHandler,
  MemoryHandler,
  DecisionHandler,
  CronHandler,
  PromiseHandler,
  ReloadHandler,
  StatusHandler,
  TaskHandler,
  SkillHandler,
  DoctorHandler,
  AgentHandler,
  StatsHandler,
  VerifyHandler,
} from "./channels/commands/index.js";
import { TaskResumeService } from "./channels/task-resume.service.js";
import { DispatchService } from "./channels/dispatch.service.js";
import { MediaCollector } from "./channels/media-collector.js";
import { DefaultOutboundDedupePolicy } from "./channels/outbound-dedupe.js";
import { sanitize_provider_output } from "./channels/output-sanitizer.js";
import { DefaultRuntimePolicyResolver } from "./channels/runtime-policy.js";
import { SessionRecorder } from "./channels/session-recorder.js";
import { get_config_defaults, load_config_merged, set_nested } from "./config/schema.js";
import { ConfigStore } from "./config/config-store.js";
import { SECTION_ORDER, SECTION_LABELS, type ConfigSection } from "./config/config-meta.js";
import { get_shared_secret_vault } from "./security/secret-vault-factory.js";
import { create_cron_job_handler, CronService } from "./cron/index.js";
import { DashboardService } from "./dashboard/service.js";
import { DecisionService } from "./decision/index.js";
import { WorkflowEventService } from "./events/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { create_logger } from "./logger.js";
import { OpsRuntimeService } from "./ops/index.js";
import { OrchestrationService } from "./orchestration/service.js";
import { resolve_reply_to } from "./orchestration/service.js";
import { ProcessTracker } from "./orchestration/process-tracker.js";
import { parse_executor_preference, resolve_executor_provider, type ProviderCapabilities } from "./providers/executor.js";
import { Phi4RuntimeManager, ProviderRegistry } from "./providers/index.js";
import { Phi4ServiceAdapter } from "./providers/phi4-service.adapter.js";
import { acquire_runtime_instance_lock } from "./runtime/instance-lock.js";
import { ServiceManager } from "./runtime/service-manager.js";
import { SessionStore, type SessionStoreLike } from "./session/index.js";
import { McpClientManager, create_mcp_tool_adapters } from "./mcp/index.js";
import { FileMcpServerStore } from "./agent/tools/mcp-store.js";
import { AgentBackendRegistry } from "./agent/agent-registry.js";
import { AgentSessionStore } from "./agent/agent-session-store.js";
import { AgentProviderStore } from "./agent/provider-store.js";
import { create_agent_provider, list_registered_provider_types } from "./agent/provider-factory.js";
import { randomUUID } from "node:crypto";
import { init_log_level } from "./logger.js";
import { OAuthIntegrationStore } from "./oauth/integration-store.js";
import { OAuthFlowService } from "./oauth/flow-service.js";
import { list_presets as list_oauth_presets, get_preset as get_oauth_preset } from "./oauth/presets.js";
import { OAuthFetchTool } from "./agent/tools/oauth-fetch.js";

export interface RuntimeApp {
  agent: AgentDomain;
  bus: MessageBus;
  channels: ChannelRegistryLike;
  channel_manager: ChannelManager;
  cron: CronService;
  heartbeat: HeartbeatService;
  mcp: McpClientManager;
  providers: ProviderRegistry;
  agent_backends: AgentBackendRegistry;
  phi4_runtime: Phi4RuntimeManager;
  sessions: SessionStoreLike;
  dashboard: DashboardService | null;
  decisions: DecisionService;
  events: WorkflowEventService;
  ops: OpsRuntimeService;
  services: ServiceManager;
  session_prune_timer: ReturnType<typeof setInterval>;
}

function resolve_from_workspace(workspace: string, path_value: string, fallback: string): string {
  const raw = String(path_value || "").trim();
  if (!raw) return fallback;
  return resolve(workspace, raw);
}

export async function createRuntime(): Promise<RuntimeApp> {
  const workspace = resolve_workspace();

  // ConfigStore: 하드코딩 기본값 위에 영속 오버라이드 + vault 민감 설정 병합
  const bootstrap_data_dir = join(workspace, "runtime");
  const shared_vault = get_shared_secret_vault(workspace);
  const config_store = new ConfigStore(join(bootstrap_data_dir, "config", "config.db"), shared_vault);
  const app_config = await load_config_merged(config_store);

  init_log_level(app_config.logging.level);

  const logger = create_logger("runtime");
  const data_dir = resolve_from_workspace(workspace, app_config.dataDir, join(workspace, "runtime"));
  const decisions_dir = join(data_dir, "decisions");
  const events_dir = join(data_dir, "events");
  const sessions_dir = join(data_dir, "sessions");
  const bus = new MessageBus();
  const decisions = new DecisionService(workspace, decisions_dir);
  const events = new WorkflowEventService(workspace, events_dir, null, app_config.taskLoopMaxTurns);
  // 에이전트 프로바이더 스토어: SQLite 영속화 + vault 토큰 관리
  const provider_store = new AgentProviderStore(
    join(data_dir, "agent-providers", "providers.db"),
    shared_vault,
  );
  // OAuth 연동 스토어 + 플로우 서비스
  const oauth_store = new OAuthIntegrationStore(
    join(data_dir, "oauth", "integrations.db"),
    shared_vault,
  );
  const oauth_flow = new OAuthFlowService(oauth_store);
  oauth_flow.load_custom_presets();

  // vault에서 API 키 읽기
  const openrouter_config = provider_store.get("openrouter");
  const openrouter_key = await provider_store.get_token("openrouter");
  const phi4_config = provider_store.get("phi4_local");
  const phi4_key = await provider_store.get_token("phi4_local");

  // CLI provider별 command/args/timeout/permission 설정 조립
  const cli_permission_config: import("./providers/cli-permission.js").CliPermissionConfig = {
    workspace_dir: workspace,
    codex_bypass_sandbox: Boolean(provider_store.get("codex_cli")?.settings.bypass_sandbox),
    codex_sandbox_mode: String(provider_store.get("codex_cli")?.settings.sandbox_mode || ""),
    codex_add_dirs: String(provider_store.get("codex_cli")?.settings.additional_dirs || ""),
    claude_permission_mode: String(provider_store.get("claude_cli")?.settings.permission_mode || ""),
    gemini_approval_mode: String(provider_store.get("gemini_cli")?.settings.approval_mode || ""),
    mcp_enabled: app_config.mcp.enabled,
  };
  const codex_settings = (provider_store.get("codex_cli")?.settings || {}) as Record<string, unknown>;
  const claude_settings = (provider_store.get("claude_cli")?.settings || {}) as Record<string, unknown>;
  const gemini_settings = (provider_store.get("gemini_cli")?.settings || {}) as Record<string, unknown>;

  const providers = new ProviderRegistry({
    orchestrator_max_tokens: app_config.orchestration.orchestratorMaxTokens,
    orchestrator_provider: app_config.orchestration.orchestratorProvider,
    openrouter_api_key: openrouter_key,
    openrouter_api_base: (openrouter_config?.settings.api_base as string) || undefined,
    openrouter_model: (openrouter_config?.settings.model as string) || undefined,
    openrouter_http_referer: (openrouter_config?.settings.http_referer as string) || undefined,
    openrouter_app_title: (openrouter_config?.settings.app_title as string) || undefined,
    phi4_api_key: phi4_key,
    phi4_api_base: (phi4_config?.settings.api_base as string) || undefined,
    phi4_model: (phi4_config?.settings.model as string) || undefined,
    cli_configs: {
      chatgpt: {
        command: String(codex_settings.command || "codex"),
        args: String(codex_settings.args || ""),
        timeout_ms: Number(codex_settings.timeout_ms) || undefined,
        permission_config: cli_permission_config,
      },
      claude_code: {
        command: String(claude_settings.command || "claude"),
        args: String(claude_settings.args || ""),
        timeout_ms: Number(claude_settings.timeout_ms) || undefined,
        permission_config: cli_permission_config,
      },
      gemini: {
        command: String(gemini_settings.command || "gemini"),
        args: String(gemini_settings.args || ""),
        timeout_ms: Number(gemini_settings.timeout_ms) || undefined,
        permission_config: cli_permission_config,
      },
    },
  });

  // 팩토리 기반 백엔드 생성
  const factory_deps = { provider_registry: providers, workspace };
  const agent_backends: import("./agent/agent.types.js").AgentBackend[] = [];
  for (const config of provider_store.list()) {
    if (!config.enabled) continue;
    const token = await provider_store.get_token(config.instance_id);
    const backend = create_agent_provider(config, token, factory_deps);
    if (backend?.is_available()) agent_backends.push(backend);
  }

  const agent_session_store = new AgentSessionStore(join(data_dir, "agent-sessions.db"));
  const agent_backend_registry = new AgentBackendRegistry({
    provider_registry: providers,
    backends: agent_backends,
    config: {
      claude_backend: (provider_store.get("claude_sdk")?.enabled ? "claude_sdk" : "claude_cli") as "claude_cli" | "claude_sdk",
      codex_backend: (provider_store.get("codex_appserver")?.enabled ? "codex_appserver" : "codex_cli") as "codex_cli" | "codex_appserver",
    },
    provider_store,
    session_store: agent_session_store,
    logger: logger.child("agent-registry"),
  });
  // provider_configs 동기화: store → registry
  for (const config of provider_store.list()) {
    const backend = agent_backend_registry.get_backend(config.instance_id);
    if (backend) agent_backend_registry.register(backend, config);
  }
  // provider 가용성 caps (store 기반)
  const codex_config = provider_store.get("codex_cli");
  const claude_config = provider_store.get("claude_cli") || provider_store.get("claude_sdk");
  const provider_caps: ProviderCapabilities = {
    chatgpt_available: codex_config?.enabled ?? false,
    claude_available: claude_config?.enabled ?? false,
    openrouter_available: Boolean(openrouter_key),
  };

  const agent = new AgentDomain(workspace, { providers, bus, data_dir, events, agent_backends: agent_backend_registry, secret_vault: providers.get_secret_vault(), logger: logger.child("agent"), provider_caps, on_task_change: (task) => dashboard?.broadcast_task_event("status_change", task) });
  agent.context.set_oauth_summary_provider(async () => {
    const configs = oauth_store.list();
    const results = [];
    for (const c of configs) {
      if (!c.enabled) continue;
      const connected = await oauth_store.has_access_token(c.instance_id);
      results.push({
        instance_id: c.instance_id,
        service_type: c.service_type,
        label: c.label,
        scopes: c.scopes,
        connected,
      });
    }
    return results;
  });
  const agent_inspector = create_agent_inspector(agent);
  const agent_runtime = create_agent_runtime(agent);
  const sessions = new SessionStore(workspace, sessions_dir);

  const cron = new CronService(join(data_dir, "cron"), create_cron_job_handler({
    config: {
      agent_loop_max_turns: app_config.agentLoopMaxTurns,
      default_alias: app_config.channel.defaultAlias,
      executor_provider: app_config.orchestration.executorProvider || "chatgpt",
      provider_caps,
      resolve_default_target: () => {
        if (!default_chat_id) return null;
        return { provider: primary_provider, chat_id: default_chat_id };
      },
    },
    bus,
    events,
    agent_runtime,
    agent_backends: agent_backend_registry,
    secret_vault: providers.get_secret_vault(),
  }), {
    on_change: (type, job_id) => dashboard?.broadcast_cron_event(type, job_id),
  });
  events.bind_task_store(agent.task_store);

  const instance_store = new ChannelInstanceStore(join(data_dir, "channels", "instances.db"), shared_vault);

  const channels = await create_channels_from_store(instance_store);

  // 기본 채널 타겟 해석
  const primary_channel = instance_store.list().find((c) => c.enabled);
  const primary_provider = primary_channel?.provider || "slack";
  const default_chat_id = primary_channel
    ? String(
        (primary_channel.settings as Record<string, unknown>).default_channel
        || (primary_channel.settings as Record<string, unknown>).default_chat_id
        || "",
      ).trim()
    : "";

  const dlq_store = app_config.channel.dispatch.dlqEnabled
    ? new SqliteDispatchDlqStore(app_config.channel.dispatch.dlqPath)
    : null;
  const dispatch = new DispatchService({
    bus,
    registry: channels,
    retry_config: app_config.channel.dispatch,
    dedupe_config: app_config.channel.outboundDedupe,
    dlq_store,
    dedupe_policy: new DefaultOutboundDedupePolicy(),
    logger: logger.child("dispatch"),
    on_direct_send: (msg) => dashboard?.broadcast_message_event("outbound", msg.sender_id, msg.content, msg.chat_id),
  });

  const session_recorder = new SessionRecorder({
    sessions,
    daily_memory: agent_runtime,
    sanitize_for_storage: sanitize_provider_output,
    logger: logger.child("session"),
  });

  const slack_token = await instance_store.get_token("slack") || "";
  const telegram_token = await instance_store.get_token("telegram") || "";
  const telegram_settings = (instance_store.get("telegram")?.settings as Record<string, unknown>) || {};
  const media_collector = new MediaCollector({
    workspace_dir: workspace,
    tokens: {
      slack_bot_token: slack_token,
      telegram_bot_token: telegram_token,
      telegram_api_base: String(telegram_settings.api_base || "https://api.telegram.org"),
    },
    logger,
  });

  const approval = new ApprovalService({
    agent_runtime,
    send_reply: (provider, message) => dispatch.send(provider, message),
    resolve_reply_to,
    logger: logger.child("approval"),
  });

  const mcp = new McpClientManager({ logger: logger.child("mcp") });

  let channel_manager_ref: ChannelManager | null = null;
  let dashboard: DashboardService | null = null;

  const process_tracker = new ProcessTracker({
    max_history: 100,
    cancel_strategy: {
      abort_run: (provider, chat_id, alias) => {
        const key = `${provider}:${chat_id}:${alias}`.toLowerCase();
        return (channel_manager_ref?.cancel_active_runs(key) ?? 0) > 0;
      },
      stop_loop: (loop_id) => !!agent_runtime.stop_loop(loop_id),
      cancel_task: async (task_id) => !!(await agent_runtime.cancel_task(task_id)),
      cancel_subagent: (id) => agent.subagents.cancel(id),
    },
    on_change: (type, entry) => dashboard?.broadcast_process_event(type, entry),
  });

  const orchestration = new OrchestrationService({
    providers,
    agent_runtime,
    secret_vault: providers.get_secret_vault(),
    runtime_policy_resolver: new DefaultRuntimePolicyResolver(),
    config: {
      executor_provider: resolve_executor_provider(
        parse_executor_preference(app_config.orchestration.executorProvider || "chatgpt"),
        provider_caps,
      ),
      agent_loop_max_turns: app_config.agentLoopMaxTurns,
      task_loop_max_turns: app_config.taskLoopMaxTurns,
      streaming_enabled: app_config.channel.streaming.enabled,
      streaming_interval_ms: app_config.channel.streaming.intervalMs,
      streaming_min_chars: app_config.channel.streaming.minChars,
      max_tool_result_chars: app_config.orchestration.maxToolResultChars,
      orchestrator_max_tokens: app_config.orchestration.orchestratorMaxTokens,
    },
    logger: logger.child("orchestration"),
    agent_backends: agent_backend_registry,
    process_tracker,
    get_mcp_configs: () => mcp.get_server_configs(),
    events,
  });

  const command_router = new CommandRouter([
    new HelpHandler(),
    new StopHandler(async (provider, chat_id) => {
      const key = `${provider}:${chat_id}`;
      return channel_manager_ref?.cancel_active_runs(key) ?? 0;
    }),
    new RenderHandler({
      get: (provider, chat_id) => channel_manager_ref!.get_render_profile(provider, chat_id),
      set: (provider, chat_id, patch) => channel_manager_ref!.set_render_profile(provider, chat_id, patch),
      reset: (provider, chat_id) => channel_manager_ref!.reset_render_profile(provider, chat_id),
    }),
    new SecretHandler(providers.get_secret_vault()),
    new MemoryHandler({ get_memory_store: () => agent.context.memory_store }),
    new DecisionHandler({ get_decision_service: () => decisions }),
    new PromiseHandler({ get_promise_service: () => agent.context.promise_service }),
    new CronHandler(cron),
    new ReloadHandler({
      reload_config: async () => {
        // config 리로드는 config_store에서 자동 반영됨
      },
      reload_tools: async () => {
        agent.tool_reloader.reload_now();
        return agent.tools.get_definitions().length;
      },
      reload_skills: async () => {
        agent.context.skills_loader.refresh();
        return agent.context.skills_loader.list_skills().length;
      },
    }),
    new TaskHandler({
      find_waiting_task: (provider, chat_id) => agent_runtime.find_waiting_task(provider, chat_id),
      get_task: (task_id) => agent_runtime.get_task(task_id),
      cancel_task: (task_id, reason) => agent_runtime.cancel_task(task_id, reason),
      list_active_tasks: () => agent_runtime.list_active_tasks(),
      list_active_loops: () => agent_runtime.list_active_loops(),
      stop_loop: (loop_id, reason) => agent_runtime.stop_loop(loop_id, reason),
      list_active_processes: () => process_tracker.list_active(),
      list_recent_processes: (limit) => process_tracker.list_recent(limit),
      get_process: (run_id) => process_tracker.get(run_id),
      cancel_process: (run_id) => process_tracker.cancel(run_id),
    }),
    new StatusHandler({
      list_tools: () => agent.tools.tool_names().map((name) => ({ name })),
      list_skills: () => agent.context.skills_loader.list_skills(true) as Array<{ name: string; summary: string; always: string }>,
    }),
    new SkillHandler({
      list_skills: () => agent.context.skills_loader.list_skills(true).map((s) => ({
        name: String(s.name || ""), summary: String(s.summary || ""),
        type: String(s.type || "tool"), source: String(s.source || "local"),
        always: s.always === "true", model: s.model ? String(s.model) : null,
      })),
      get_skill: (name) => {
        const m = agent.context.skills_loader.get_skill_metadata(name);
        if (!m) return null;
        return {
          name: m.name, summary: m.summary, type: m.type, source: m.source,
          always: m.always, model: m.model, tools: m.tools, requirements: m.requirements, role: m.role,
          shared_protocols: m.shared_protocols,
        };
      },
      list_role_skills: () => agent.context.skills_loader.list_role_skills().map((m) => ({
        name: m.name, role: m.role, summary: m.summary,
      })),
      recommend: (task, limit) => agent.context.skills_loader.suggest_skills_for_text(task, limit ?? 5),
      refresh: () => { agent.context.skills_loader.refresh(); return agent.context.skills_loader.list_skills().length; },
    }),
    new DoctorHandler({
      get_tool_count: () => agent.tools.tool_names().length,
      get_skill_count: () => agent.context.skills_loader.list_skills().length,
      get_active_task_count: () => agent_runtime.list_active_tasks().length,
      get_active_loop_count: () => agent_runtime.list_active_loops().length,
      list_backends: () => agent_backend_registry.list_backends().map(String),
      list_mcp_servers: () => mcp.list_servers().map((s) => ({
        name: s.name, connected: s.connected, tool_count: s.tools.length, error: s.error,
      })),
      get_cron_job_count: () => cron.list_jobs().then((jobs) => jobs.length),
    }),
    new AgentHandler({
      list: () => agent.subagents.list().map((s) => ({
        id: s.id, role: s.role, status: s.status, label: s.label,
        created_at: s.created_at, last_error: s.last_error,
        model: s.model, session_id: s.session_id, updated_at: s.updated_at, last_result: s.last_result,
      })),
      list_running: () => agent.subagents.list_running().map((s) => ({
        id: s.id, role: s.role, status: s.status, label: s.label,
        created_at: s.created_at, last_error: s.last_error,
        model: s.model, session_id: s.session_id, updated_at: s.updated_at, last_result: s.last_result,
      })),
      get: (id) => {
        const s = agent.subagents.get(id);
        if (!s) return null;
        return {
          id: s.id, role: s.role, status: s.status, label: s.label,
          created_at: s.created_at, last_error: s.last_error,
          model: s.model, session_id: s.session_id, updated_at: s.updated_at, last_result: s.last_result,
        };
      },
      cancel: (id) => agent.subagents.cancel(id),
      send_input: (id, text) => agent.subagents.send_input(id, text),
      get_running_count: () => agent.subagents.get_running_count(),
    }),
    new StatsHandler({
      get_cd_score: () => orchestration.get_cd_score(),
      reset_cd: () => orchestration.reset_cd_score(),
      get_active_task_count: () => agent_runtime.list_active_tasks().length,
      get_active_loop_count: () => agent_runtime.list_active_loops().length,
      get_provider_health: () => {
        const scorer = providers.get_health_scorer();
        return scorer.rank().map((r) => {
          const m = scorer.get_metrics(r.provider);
          const total = m.success_count + m.failure_count;
          return {
            provider: r.provider,
            score: r.score,
            success_count: m.success_count,
            failure_count: m.failure_count,
            avg_latency_ms: total > 0 ? m.total_latency_ms / total : 0,
          };
        });
      },
    }),
    new VerifyHandler({
      get_last_output: (provider, chat_id) =>
        session_recorder.get_last_assistant_content(provider as import("./channels/types.js").ChannelProvider, chat_id, app_config.channel.defaultAlias),
      run_verification: (task) => agent_runtime.spawn_and_wait({ task, max_turns: 5, timeout_ms: 60_000 }),
    }),
  ]);

  const task_resume = new TaskResumeService({
    agent_runtime,
    logger: logger.child("task-resume"),
  });

  // bot identity: instance store에서 bot_self_id / default_target 조회
  const bot_identity = {
    get_bot_self_id(provider: string): string {
      const inst = instance_store.get(provider);
      return String((inst?.settings as Record<string, unknown>)?.bot_self_id || "").trim();
    },
    get_default_target(provider: string): string {
      const inst = instance_store.get(provider);
      const s = (inst?.settings as Record<string, unknown>) || {};
      return String(s.default_channel || s.default_chat_id || "").trim();
    },
  };

  const channel_manager = new ChannelManager({
    bus,
    registry: channels,
    dispatch,
    command_router,
    orchestration,
    approval,
    task_resume,
    session_recorder,
    session_store: sessions,
    media_collector,
    process_tracker,
    providers,
    config: app_config.channel,
    workspace_dir: workspace,
    logger: app_config.channel.debug ? create_logger("channels", "debug") : logger.child("channels"),
    bot_identity,
    on_agent_event: (event) => dashboard?.broadcast_agent_event(event),
    on_web_stream: (chat_id, content, done) => dashboard?.broadcast_web_stream(chat_id, content, done),
  });
  channel_manager_ref = channel_manager;

  const phi4_runtime = new Phi4RuntimeManager({
    enabled: app_config.phi4.enabled,
    engine: app_config.phi4.engine,
    image: app_config.phi4.image,
    container: app_config.phi4.container,
    port: app_config.phi4.port,
    model: app_config.phi4.model,
    pull_model: app_config.phi4.pullModel,
    auto_stop: app_config.phi4.autoStop,
    gpu_enabled: app_config.phi4.gpuEnabled,
    gpu_args: app_config.phi4.gpuArgs,
    api_base: (phi4_config?.settings.api_base as string) || app_config.phi4.apiBase,
  });

  const services = new ServiceManager(logger.child("services"));

  const heartbeat = new HeartbeatService(workspace, {
    on_heartbeat: async (prompt) => {
      const result = await agent_runtime.spawn_and_wait({ task: prompt, max_turns: 5, timeout_ms: 60_000 });
      return String(result || "");
    },
    on_notify: default_chat_id
      ? async (message) => {
          await bus.publish_outbound({
            id: `heartbeat-notify-${Date.now()}`,
            provider: primary_provider,
            channel: primary_provider,
            sender_id: "heartbeat",
            chat_id: default_chat_id,
            content: `💓 Heartbeat:\n${message}`,
            at: new Date().toISOString(),
            metadata: { kind: "heartbeat_notify" },
          });
        }
      : null,
  });
  const ops = new OpsRuntimeService({
    bus,
    channels: channel_manager,
    cron,
    heartbeat,
    decisions,
    services,
    secret_vault: providers.get_secret_vault(),
    session_store: sessions,
    promises: agent.context.promise_service,
    dlq: dlq_store,
  }, app_config.ops);

  if (app_config.dashboard.enabled) {
    dashboard = new DashboardService({
      host: app_config.dashboard.host,
      port: app_config.dashboard.port,
      port_fallback: app_config.dashboard.portFallback,
      agent: agent_inspector,
      bus,
      channels: channel_manager,
      heartbeat,
      ops,
      decisions,
      promises: agent.context.promise_service,
      events,
      process_tracker,
      cron,
      task_ops: {
        cancel_task: (id, reason) => agent_runtime.cancel_task(id, reason),
        get_task: (id) => agent_runtime.get_task(id),
        resume_task: (id, text) => agent_runtime.resume_task(id, text),
      },
      stats_ops: {
        get_cd_score: () => orchestration.get_cd_score(),
        reset_cd_score: () => orchestration.reset_cd_score(),
      },
      dlq: dlq_store,
      secrets: providers.get_secret_vault(),
      config_ops: {
        get_current_config: () => app_config as unknown as Record<string, unknown>,
        get_sections: async () => {
          const config_raw = app_config as unknown as Record<string, unknown>;
          const results = [];
          for (const id of SECTION_ORDER) {
            results.push({ id, label: SECTION_LABELS[id], fields: await config_store.get_section_status(id, config_raw) });
          }
          return results;
        },
        get_section: async (section: string) => {
          if (!SECTION_ORDER.includes(section as ConfigSection)) return null;
          const config_raw = app_config as unknown as Record<string, unknown>;
          return {
            id: section,
            label: SECTION_LABELS[section as ConfigSection],
            fields: await config_store.get_section_status(section as ConfigSection, config_raw),
          };
        },
        set_value: async (path: string, value: unknown) => {
          await config_store.set_value(path, value);
          set_nested(app_config as unknown as Record<string, unknown>, path, value);
        },
        remove_value: async (path: string) => {
          await config_store.remove_value(path);
          const fresh = get_config_defaults();
          const keys = path.split(".");
          let def: unknown = fresh as unknown as Record<string, unknown>;
          for (const k of keys) {
            if (def == null || typeof def !== "object") { def = undefined; break; }
            def = (def as Record<string, unknown>)[k];
          }
          set_nested(app_config as unknown as Record<string, unknown>, path, def);
        },
      },
      skill_ops: {
        list_skills: () => agent.context.skills_loader.list_skills(),
        get_skill_detail: (name: string) => {
          const meta = agent.context.skills_loader.get_skill_metadata(name);
          let content: string | null = null;
          let references: Array<{ name: string; content: string }> | null = null;
          if (meta?.path) {
            try { content = readFileSync(meta.path, "utf-8"); } catch { /* skip */ }
            const refs_dir = join(meta.path, "..", "references");
            if (existsSync(refs_dir)) {
              try {
                references = readdirSync(refs_dir)
                  .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
                  .map((f) => ({ name: f, content: readFileSync(join(refs_dir, f), "utf-8") }));
              } catch { /* skip */ }
            }
          }
          return { metadata: meta as unknown as Record<string, unknown> | null, content, references };
        },
        refresh: () => agent.context.skills_loader.refresh(),
        write_skill_file: (name: string, file: string, content: string) => {
          try {
            const meta = agent.context.skills_loader.get_skill_metadata(name);
            if (!meta?.path) return { ok: false, error: "skill_not_found" };
            // builtin 스킬은 편집 거부
            if (String(meta.source ?? "").toLowerCase() === "builtin") return { ok: false, error: "builtin_readonly" };
            const target = file === "SKILL.md"
              ? meta.path
              : join(meta.path, "..", "references", file);
            writeFileSync(target, content, "utf-8");
            agent.context.skills_loader.refresh();
            return { ok: true };
          } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
        },
        upload_skill: (name: string, zip_buffer: Buffer) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const AdmZip = require("adm-zip") as typeof import("adm-zip");
            const zip = new AdmZip(zip_buffer);
            const skill_dir = join(workspace, "skills", name);
            // zip 내 최상위 단일 디렉터리 prefix 제거 (예: my-skill/SKILL.md → SKILL.md)
            const entries = zip.getEntries();
            const top_dirs = new Set(entries.map((e) => e.entryName.split("/")[0]).filter(Boolean));
            const strip_prefix = top_dirs.size === 1 ? `${[...top_dirs][0]}/` : "";
            for (const entry of entries) {
              if (entry.isDirectory) continue;
              const rel = strip_prefix ? entry.entryName.replace(strip_prefix, "") : entry.entryName;
              if (!rel) continue;
              const target = join(skill_dir, rel);
              mkdirSync(join(target, ".."), { recursive: true });
              writeFileSync(target, entry.getData());
            }
            agent.context.skills_loader.refresh();
            return { ok: true, path: skill_dir };
          } catch (e) {
            return { ok: false, path: "", error: e instanceof Error ? e.message : String(e) };
          }
        },
      },
      tool_ops: {
        tool_names: () => agent.tools.tool_names(),
        get_definitions: () => agent.tools.get_definitions(),
        list_mcp_servers: () => mcp.list_servers().map((s) => ({ name: s.name, connected: s.connected, tools: s.tools.map((t) => t.name), error: s.error })),
      },
      template_ops: _create_template_ops(workspace),
      channel_ops: _create_channel_ops({ channels, instance_store, app_config }),
      agent_provider_ops: _create_agent_provider_ops({
        provider_store, agent_backends: agent_backend_registry,
        provider_registry: providers, workspace,
      }),
      bootstrap_ops: _create_bootstrap_ops({ provider_store, config_store, provider_registry: providers, agent_backends: agent_backend_registry, workspace }),
      session_store: sessions,
      memory_ops: _create_memory_ops(agent.context.memory_store),
      workspace_ops: _create_workspace_ops(workspace),
      oauth_ops: _create_oauth_ops({ oauth_store, oauth_flow, dashboard_port: app_config.dashboard.port, public_url: app_config.dashboard.publicUrl }),
      default_alias: app_config.channel.defaultAlias,
      workspace,
    });
    dashboard.set_oauth_callback_handler((code, state) => oauth_flow.handle_callback(code, state));
    bus.on_publish((dir, msg) => {
      dashboard?.broadcast_message_event(dir, msg.sender_id, msg.content, msg.chat_id);
      if (dir === "outbound" && msg.provider === "web" && msg.chat_id) {
        const media = msg.media?.map((m) => ({ type: m.type as string, url: m.url, mime: m.mime, name: m.name }));
        dashboard?.capture_web_outbound(msg.chat_id, msg.content, media);
      }
    });
  }

  // ProgressEvent consumer: bus → dashboard SSE 릴레이 (대시보드 비활성 시에도 큐 소비)
  (async function progress_relay() {
    while (!bus.is_closed()) {
      const event = await bus.consume_progress({ timeout_ms: 5000 });
      if (event) dashboard?.broadcast_progress_event(event);
    }
  })().catch(() => {});

  if (!agent_runtime.has_tool("cron")) {
    agent_runtime.register_tool(new CronTool(cron));
  }
  if (!agent_runtime.has_tool("memory")) {
    agent_runtime.register_tool(new MemoryTool(agent.context.memory_store));
  }
  if (!agent_runtime.has_tool("decision")) {
    agent_runtime.register_tool(new DecisionTool(decisions));
  }
  if (!agent_runtime.has_tool("secret")) {
    agent_runtime.register_tool(new SecretTool(providers.get_secret_vault()));
  }
  if (!agent_runtime.has_tool("promise")) {
    agent_runtime.register_tool(new PromiseTool(agent.context.promise_service));
  }
  if (!agent_runtime.has_tool("task_query")) {
    agent_runtime.register_tool(new TaskQueryTool(async (task_id) => {
      const state = await agent_runtime.get_task(task_id);
      if (!state) return null;
      return {
        task_id: state.taskId,
        title: state.title,
        status: state.status,
        current_step: state.currentStep,
        exit_reason: state.exitReason,
        current_turn: state.currentTurn,
        max_turns: state.maxTurns,
      };
    }));
  }
  if (!agent_runtime.has_tool("oauth_fetch")) {
    agent_runtime.register_tool(new OAuthFetchTool(oauth_store, oauth_flow));
  }

  services.register(agent, { required: true });
  services.register(dispatch, { required: true });
  services.register(channel_manager, { required: true });
  services.register(cron, { required: true });
  services.register(heartbeat, { required: false });
  services.register(ops, { required: false });
  if (dashboard) services.register(dashboard, { required: false });
  services.register(mcp, { required: false });
  services.register(new Phi4ServiceAdapter(phi4_runtime), { required: false });

  const enabled_channels = instance_store.list().filter((c) => c.enabled).map((c) => c.provider);
  logger.info(`channels=${enabled_channels.join(",")} primary=${primary_provider}`);

  await register_mcp_tools(workspace, mcp, agent_runtime, logger).catch((error) => {
    logger.error(`mcp tool registration failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  const session_id = randomUUID();
  agent.loop.set_session_id(session_id);
  logger.info(`session_id=${session_id}`);

  await services.start();

  // 만료된 에이전트 세션 정리: 시작 시 즉시 + 1시간 간격
  try { agent_session_store.prune_expired(); } catch { /* noop */ }
  const session_prune_timer = setInterval(() => {
    try { agent_session_store.prune_expired(); } catch { /* noop */ }
  }, 60 * 60 * 1000);
  session_prune_timer.unref();

  if (dashboard) logger.info(`dashboard ${dashboard.get_url()}`);
  const phi4_status = phi4_runtime.get_status();
  if (phi4_status.enabled) {
    logger.info(`phi4 running=${phi4_status.running} engine=${phi4_status.engine || "n/a"} base=${phi4_status.api_base}`);
  }

  const app: RuntimeApp = {
    agent,
    bus,
    channels,
    channel_manager,
    cron,
    heartbeat,
    mcp,
    providers,
    agent_backends: agent_backend_registry,
    phi4_runtime,
    sessions,
    dashboard,
    decisions,
    events,
    ops,
    services,
    session_prune_timer,
  };

  return app;
}

async function register_mcp_tools(
  workspace: string,
  mcp: McpClientManager,
  agent_runtime: ReturnType<typeof create_agent_runtime>,
  logger: ReturnType<typeof create_logger>,
): Promise<void> {
  const mcp_store = new FileMcpServerStore(workspace);
  const servers = await mcp_store.list_servers();
  for (const [name, entry] of Object.entries(servers)) {
    if (entry.command) {
      mcp.register_server(name, {
        command: entry.command,
        args: entry.args,
        env: entry.env,
        cwd: entry.cwd,
        startup_timeout_ms: (entry.startup_timeout_sec ?? 15) * 1000,
      });
    }
  }
  await mcp.start();
  const adapters = create_mcp_tool_adapters(mcp);
  for (const adapter of adapters) {
    agent_runtime.register_tool(adapter);
  }
  if (adapters.length > 0) {
    logger.info(`mcp tools registered count=${adapters.length}`);
  }
}

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import type { DashboardTemplateOps, DashboardChannelOps, ChannelStatusInfo, BootstrapOps, DashboardOAuthOps, OAuthIntegrationInfo } from "./dashboard/service.js";
import { DEFAULT_TEMPLATES } from "./bootstrap-templates.js";

const TEMPLATE_NAMES = ["IDENTITY", "AGENTS", "SOUL", "HEART", "USER", "TOOLS", "HEARTBEAT"] as const;

function _create_template_ops(workspace: string): DashboardTemplateOps {
  const templates_dir = join(workspace, "templates");

  function resolve_path(name: string): string | null {
    const in_templates = join(templates_dir, `${name}.md`);
    if (existsSync(in_templates)) return in_templates;
    const in_root = join(workspace, `${name}.md`);
    if (existsSync(in_root)) return in_root;
    return null;
  }

  return {
    list() {
      return TEMPLATE_NAMES.map((name) => ({ name, exists: resolve_path(name) !== null }));
    },
    read(name: string) {
      const p = resolve_path(name);
      if (!p) return null;
      return readFileSync(p, "utf-8");
    },
    write(name: string, content: string) {
      if (!mkdirSync(templates_dir, { recursive: true }) && !existsSync(templates_dir)) return { ok: false };
      const target = join(templates_dir, `${name}.md`);
      writeFileSync(target, content, "utf-8");
      return { ok: true };
    },
  };
}

const CHANNEL_TEST_URLS: Record<string, (token: string, api_base?: string) => { url: string; headers: Record<string, string> }> = {
  slack: (token) => ({ url: "https://slack.com/api/auth.test", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }),
  discord: (token, api_base) => ({ url: `${api_base || "https://discord.com/api/v10"}/users/@me`, headers: { Authorization: `Bot ${token}` } }),
  telegram: (token, api_base) => ({ url: `${api_base || "https://api.telegram.org"}/bot${token}/getMe`, headers: {} }),
};

function _create_channel_ops(deps: {
  channels: import("./channels/index.js").ChannelRegistryLike;
  instance_store: import("./channels/instance-store.js").ChannelInstanceStore;
  app_config: import("./config/schema.js").AppConfig;
}): DashboardChannelOps {
  const { channels, instance_store } = deps;
  const log = create_logger("channel-ops");

  function build_status(
    config: import("./channels/instance-store.js").ChannelInstanceConfig,
    health: import("./channels/types.js").ChannelHealth | null,
    has_token: boolean,
  ): ChannelStatusInfo {
    const settings = config.settings as Record<string, unknown>;
    const default_target = String(settings.default_channel || settings.default_chat_id || "");
    return {
      provider: config.provider,
      instance_id: config.instance_id,
      label: config.label,
      enabled: config.enabled,
      running: health?.running ?? false,
      healthy: health?.running ?? false,
      last_error: health?.last_error,
      token_configured: has_token,
      default_target,
      settings: config.settings,
      created_at: config.created_at,
      updated_at: config.updated_at,
    };
  }

  return {
    async list(): Promise<ChannelStatusInfo[]> {
      const instances = instance_store.list();
      const health_list = channels.get_health();
      const health_map = new Map(health_list.map((h) => [h.instance_id, h]));

      const results: ChannelStatusInfo[] = [];
      for (const config of instances) {
        const has_token = await instance_store.has_token(config.instance_id);
        results.push(build_status(config, health_map.get(config.instance_id) ?? null, has_token));
      }
      return results;
    },

    async get(instance_id: string): Promise<ChannelStatusInfo | null> {
      const config = instance_store.get(instance_id);
      if (!config) return null;
      const health = channels.get_health().find((h) => h.instance_id === instance_id) ?? null;
      const has_token = await instance_store.has_token(instance_id);
      return build_status(config, health, has_token);
    },

    async create(input): Promise<{ ok: boolean; error?: string }> {
      if (!input.instance_id || !input.provider) return { ok: false, error: "instance_id_and_provider_required" };
      if (instance_store.get(input.instance_id)) return { ok: false, error: "instance_already_exists" };
      const config = {
        instance_id: input.instance_id,
        provider: input.provider,
        label: input.label || input.instance_id,
        enabled: input.enabled ?? true,
        settings: input.settings || {},
      };
      instance_store.upsert(config);
      if (input.token) {
        await instance_store.set_token(input.instance_id, input.token);
      }
      const saved = instance_store.get(input.instance_id);
      if (saved?.enabled) {
        const token = await instance_store.get_token(saved.instance_id) || "";
        const ch = create_channel_instance(saved, token);
        if (ch) {
          channels.register(ch);
          try {
            await ch.start();
            log.info("channel created and started", { instance_id: saved.instance_id, provider: saved.provider });
          } catch (err) {
            log.warn("channel created but start failed", { instance_id: saved.instance_id, error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      return { ok: true };
    },

    async update(instance_id, patch): Promise<{ ok: boolean; error?: string }> {
      const existing = instance_store.get(instance_id);
      if (!existing) return { ok: false, error: "not_found" };
      instance_store.update_settings(instance_id, {
        label: patch.label,
        enabled: patch.enabled,
        settings: patch.settings,
      });
      if (patch.token !== undefined) {
        if (patch.token) {
          await instance_store.set_token(instance_id, patch.token);
        } else {
          await instance_store.remove_token(instance_id);
        }
      }
      // 핫스왑: 기존 인스턴스 정지 → 새 설정으로 재생성
      const old = channels.get_channel(instance_id);
      if (old?.is_running()) {
        try { await old.stop(); } catch { /* best-effort */ }
      }
      channels.unregister(instance_id);
      const updated = instance_store.get(instance_id);
      if (updated?.enabled) {
        const token = await instance_store.get_token(instance_id) || "";
        const ch = create_channel_instance(updated, token);
        if (ch) {
          channels.register(ch);
          try {
            await ch.start();
            log.info("channel hot-swapped", { instance_id, provider: updated.provider });
          } catch (err) {
            log.warn("channel hot-swap start failed", { instance_id, error: err instanceof Error ? err.message : String(err) });
          }
        }
      } else {
        log.info("channel stopped (disabled)", { instance_id });
      }
      return { ok: true };
    },

    async remove(instance_id): Promise<{ ok: boolean; error?: string }> {
      const ch = channels.get_channel(instance_id);
      if (ch?.is_running()) {
        try { await ch.stop(); } catch { /* best-effort */ }
      }
      channels.unregister(instance_id);
      await instance_store.remove_token(instance_id);
      const removed = instance_store.remove(instance_id);
      if (removed) {
        log.info("channel removed", { instance_id });
      }
      return { ok: removed, error: removed ? undefined : "not_found" };
    },

    async test_connection(instance_id: string): Promise<{ ok: boolean; detail?: string; error?: string }> {
      const config = instance_store.get(instance_id);
      if (!config) return { ok: false, error: "instance_not_found" };
      const token = await instance_store.get_token(instance_id) || "";
      if (!token) return { ok: false, error: "token_not_configured" };

      const builder = CHANNEL_TEST_URLS[config.provider];
      if (!builder) return { ok: false, error: "unsupported_provider" };
      const api_base = String((config.settings as Record<string, unknown>).api_base || "");
      const { url, headers } = builder(token, api_base || undefined);

      try {
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
        if (!resp.ok) {
          log.warn("channel test_connection failed", { instance_id, provider: config.provider, status: resp.status });
          return { ok: false, error: `HTTP ${resp.status}`, detail: JSON.stringify(body).slice(0, 200) };
        }

        if (config.provider === "slack" && body?.ok === false) {
          log.warn("channel test_connection failed", { instance_id, provider: config.provider, error: String(body.error || "slack_auth_failed") });
          return { ok: false, error: String(body.error || "slack_auth_failed") };
        }

        const detail = config.provider === "slack"
          ? String(body?.team || "")
          : config.provider === "discord"
            ? String((body as Record<string, unknown>)?.username || "")
            : String((body as { result?: { username?: string } })?.result?.username || "");
        log.info("channel test_connection ok", { instance_id, provider: config.provider });
        return { ok: true, detail };
      } catch (e) {
        log.warn("channel test_connection error", { instance_id, provider: config.provider, error: e instanceof Error ? e.message : String(e) });
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    list_providers(): string[] {
      return [...new Set(instance_store.list().map((c) => c.provider))];
    },
  };
}

function _create_agent_provider_ops(deps: {
  provider_store: AgentProviderStore;
  agent_backends: AgentBackendRegistry;
  provider_registry: ProviderRegistry;
  workspace: string;
}): import("./dashboard/service.js").DashboardAgentProviderOps {
  const { provider_store, agent_backends, provider_registry, workspace } = deps;

  return {
    async list() {
      const configs = provider_store.list();
      const status_map = new Map(agent_backends.list_backend_status().map((s) => [s.id, s]));
      return configs.map((c) => {
        const s = status_map.get(c.instance_id);
        return {
          ...c,
          available: s?.available ?? false,
          circuit_state: s?.circuit_state ?? "closed",
          capabilities: s?.capabilities ?? null,
          token_configured: false, // 아래에서 비동기 보완
        };
      });
    },

    async get(instance_id) {
      const config = provider_store.get(instance_id);
      if (!config) return null;
      const status = agent_backends.list_backend_status().find((s) => s.id === instance_id);
      const has_token = await provider_store.has_token(instance_id);
      return {
        ...config,
        available: status?.available ?? false,
        circuit_state: status?.circuit_state ?? "closed",
        capabilities: status?.capabilities ?? null,
        token_configured: has_token,
      };
    },

    async create(input) {
      if (!input.instance_id || !input.provider_type) return { ok: false, error: "instance_id_and_provider_type_required" };
      if (provider_store.get(input.instance_id)) return { ok: false, error: "instance_already_exists" };

      provider_store.upsert({
        instance_id: input.instance_id,
        provider_type: input.provider_type,
        label: input.label || input.instance_id,
        enabled: input.enabled ?? true,
        priority: input.priority ?? 100,
        supported_modes: (input.supported_modes ?? ["once", "agent", "task"]) as import("./orchestration/types.js").ExecutionMode[],
        settings: input.settings || {},
      });

      if (input.token) {
        await provider_store.set_token(input.instance_id, input.token);
      }

      // 즉시 등록 (재시작 불필요)
      const config = provider_store.get(input.instance_id);
      if (config) {
        const token = await provider_store.get_token(input.instance_id);
        const backend = create_agent_provider(config, token, { provider_registry, workspace });
        if (backend?.is_available()) {
          agent_backends.register(backend, config);
        }
      }

      return { ok: true };
    },

    async update(instance_id, patch) {
      const existing = provider_store.get(instance_id);
      if (!existing) return { ok: false, error: "not_found" };

      provider_store.update_settings(instance_id, {
        label: patch.label,
        enabled: patch.enabled,
        priority: patch.priority,
        supported_modes: patch.supported_modes as import("./orchestration/types.js").ExecutionMode[] | undefined,
        settings: patch.settings,
      });

      if (patch.token !== undefined) {
        if (patch.token) {
          await provider_store.set_token(instance_id, patch.token);
        } else {
          await provider_store.remove_token(instance_id);
        }
      }

      // 핫스왑: 설정 변경 시 팩토리 재생성 + registry 재등록
      const updated_config = provider_store.get(instance_id);
      if (updated_config) {
        const token = await provider_store.get_token(instance_id);
        const backend = create_agent_provider(updated_config, token, { provider_registry, workspace });
        if (backend) {
          agent_backends.register(backend, updated_config);
        }
      }

      return { ok: true };
    },

    async remove(instance_id) {
      await agent_backends.unregister(instance_id);
      await provider_store.remove_token(instance_id);
      const removed = provider_store.remove(instance_id);
      return { ok: removed, error: removed ? undefined : "not_found" };
    },

    async test_availability(instance_id) {
      const config = provider_store.get(instance_id);
      if (!config) return { ok: false, error: "instance_not_found" };
      const token = await provider_store.get_token(instance_id);

      const backend = create_agent_provider(config, token, { provider_registry, workspace });
      if (!backend) return { ok: false, error: "unknown_provider_type" };

      try {
        const available = backend.is_available();
        try { backend.stop?.(); } catch { /* best-effort */ }
        return { ok: available, detail: available ? "available" : "unavailable" };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    list_provider_types() {
      return list_registered_provider_types();
    },
  };
}

function _create_bootstrap_ops(deps: {
  provider_store: AgentProviderStore;
  config_store: ConfigStore;
  provider_registry: ProviderRegistry;
  agent_backends: AgentBackendRegistry;
  workspace: string;
}): BootstrapOps {
  const { provider_store, config_store, provider_registry, agent_backends, workspace } = deps;
  return {
    get_status() {
      return {
        needed: provider_store.count() === 0,
        providers: list_registered_provider_types(),
      };
    },
    async apply(input) {
      if (!Array.isArray(input.providers) || input.providers.length === 0) {
        return { ok: false, error: "at_least_one_provider_required" };
      }
      for (const p of input.providers) {
        if (!p.instance_id || !p.provider_type) {
          return { ok: false, error: "instance_id_and_provider_type_required" };
        }
        provider_store.upsert({
          instance_id: p.instance_id,
          provider_type: p.provider_type,
          label: p.label || p.instance_id,
          enabled: p.enabled ?? true,
          priority: p.priority ?? 100,
          supported_modes: ["once", "agent", "task"],
          settings: p.settings || {},
        });
        if (p.token) {
          await provider_store.set_token(p.instance_id, p.token);
        }
        // 즉시 백엔드 등록
        const config = provider_store.get(p.instance_id);
        if (config) {
          const token = await provider_store.get_token(p.instance_id);
          const backend = create_agent_provider(config, token, { provider_registry, workspace });
          if (backend?.is_available()) agent_backends.register(backend, config);
        }
      }
      if (input.executor) {
        await config_store.set_value("orchestration.executorProvider", input.executor);
      }
      if (input.orchestrator) {
        await config_store.set_value("orchestration.orchestratorProvider", input.orchestrator);
      }
      if (input.alias) {
        await config_store.set_value("channel.defaultAlias", input.alias);
      }
      // 최초 부트스트랩 시 기본 페르소나 템플릿 생성 (기존 파일은 덮어쓰지 않음)
      const templates_dir = join(workspace, "templates");
      mkdirSync(templates_dir, { recursive: true });
      for (const [name, content] of Object.entries(DEFAULT_TEMPLATES)) {
        const target = join(templates_dir, `${name}.md`);
        if (!existsSync(target)) writeFileSync(target, content, "utf-8");
      }
      return { ok: true };
    },
  };
}

function _create_memory_ops(memory_store: import("./agent/memory.types.js").MemoryStoreLike): import("./dashboard/service.js").DashboardMemoryOps {
  return {
    read_longterm: () => memory_store.read_longterm(),
    write_longterm: (content) => memory_store.write_longterm(content),
    list_daily: () => memory_store.list_daily(),
    read_daily: (day) => memory_store.read_daily(day),
    write_daily: (content, day) => memory_store.write_daily(content, day),
  };
}

function _create_workspace_ops(workspace_dir: string): import("./dashboard/service.js").DashboardWorkspaceOps {
  return {
    async list_files(rel_path = "") {
      const safe = rel_path.replace(/\.\./g, "").replace(/^\/+/, "");
      const abs = join(workspace_dir, safe);
      try {
        const entries = readdirSync(abs, { withFileTypes: true });
        return entries.map((e) => {
          const rel = safe ? `${safe}/${e.name}` : e.name;
          let size = 0;
          let mtime = 0;
          try {
            const st = statSync(join(abs, e.name));
            size = st.size;
            mtime = st.mtimeMs;
          } catch { /* skip */ }
          return { name: e.name, rel, is_dir: e.isDirectory(), size, mtime };
        });
      } catch {
        return [];
      }
    },
    async read_file(rel_path) {
      const safe = rel_path.replace(/\.\./g, "").replace(/^\/+/, "");
      const abs = join(workspace_dir, safe);
      try {
        return readFileSync(abs, "utf-8");
      } catch {
        return null;
      }
    },
  };
}

function _create_oauth_ops(deps: {
  oauth_store: OAuthIntegrationStore;
  oauth_flow: OAuthFlowService;
  dashboard_port: number;
  public_url?: string;
}): DashboardOAuthOps {
  const { oauth_store, oauth_flow, dashboard_port, public_url } = deps;

  /** public_url 설정 시 해당 origin 사용, 없으면 요청 origin 사용. */
  function resolve_origin(request_origin: string | undefined): string {
    if (public_url) return public_url.replace(/\/$/, "");
    return request_origin ?? `http://localhost:${dashboard_port}`;
  }

  async function build_info(config: import("./oauth/integration-store.js").OAuthIntegrationConfig): Promise<OAuthIntegrationInfo> {
    const has_token = await oauth_store.has_access_token(config.instance_id);
    return {
      instance_id: config.instance_id,
      service_type: config.service_type,
      label: config.label,
      enabled: config.enabled,
      scopes: config.scopes,
      token_configured: has_token,
      expired: oauth_store.is_expired(config.instance_id),
      expires_at: config.expires_at,
      created_at: config.created_at,
      updated_at: config.updated_at,
    };
  }

  return {
    async list() {
      const configs = oauth_store.list();
      return Promise.all(configs.map(build_info));
    },

    async get(id) {
      const config = oauth_store.get(id);
      return config ? build_info(config) : null;
    },

    async create(input) {
      if (!input.service_type || !input.client_id) {
        return { ok: false, error: "service_type_and_client_id_required" };
      }
      const instance_id = input.label?.toLowerCase().replace(/\s+/g, "-") || input.service_type;
      if (oauth_store.get(instance_id)) {
        return { ok: false, error: "instance_already_exists" };
      }

      const preset = get_oauth_preset(input.service_type);
      const auth_url = input.auth_url || preset?.auth_url || "";
      const token_url = input.token_url || preset?.token_url || "";
      const redirect_uri = `${resolve_origin(undefined)}/api/oauth/callback`;

      oauth_store.upsert({
        instance_id,
        service_type: input.service_type,
        label: input.label || instance_id,
        enabled: true,
        scopes: input.scopes || preset?.default_scopes || [],
        auth_url,
        token_url,
        redirect_uri,
        settings: {},
      });
      await oauth_store.vault_store_client_id(instance_id, input.client_id);
      if (input.client_secret) await oauth_store.vault_store_client_secret(instance_id, input.client_secret);
      return { ok: true, instance_id };
    },

    async update(id, patch) {
      const existing = oauth_store.get(id);
      if (!existing) return { ok: false, error: "not_found" };
      oauth_store.update_settings(id, patch);
      return { ok: true };
    },

    async remove(id) {
      const existed = oauth_store.remove(id);
      if (!existed) return { ok: false, error: "not_found" };
      await oauth_store.remove_tokens(id);
      return { ok: true };
    },

    async start_auth(id, client_secret, origin) {
      const integration = oauth_store.get(id);
      if (!integration) return { ok: false, error: "not_found" };

      const client_id = await oauth_store.get_client_id(id);
      if (!client_id) return { ok: false, error: "missing_client_id" };

      // client_secret이 전달된 경우 vault 갱신 (없으면 기존 저장 값 또는 빈 값으로 진행)
      if (client_secret) await oauth_store.vault_store_client_secret(id, client_secret);

      const effective_origin = resolve_origin(origin);
      const redirect_uri = `${effective_origin}/api/oauth/callback`;
      if (integration.redirect_uri !== redirect_uri) {
        oauth_store.upsert({ ...integration, redirect_uri });
      }

      const updated = oauth_store.get(id) ?? integration;
      const auth_url = oauth_flow.generate_auth_url_with_client_id(updated, client_id);
      return { ok: true, auth_url };
    },

    async refresh(id) {
      return oauth_flow.refresh_token(id);
    },

    async test(id) {
      return oauth_flow.test_token(id);
    },

    list_presets() {
      return list_oauth_presets();
    },

    async register_preset(preset) {
      if (!preset.service_type || !preset.auth_url || !preset.token_url) {
        return { ok: false, error: "service_type, auth_url, token_url required" };
      }
      oauth_flow.register_custom_preset({
        scopes_available: [], default_scopes: [], supports_refresh: true,
        ...preset,
      });
      return { ok: true };
    },

    async update_preset(service_type, patch) {
      const existing = get_oauth_preset(service_type);
      if (!existing) return { ok: false, error: "preset_not_found" };
      oauth_flow.register_custom_preset({ ...existing, ...patch });
      return { ok: true };
    },

    async unregister_preset(service_type) {
      const removed = oauth_flow.unregister_custom_preset(service_type);
      return removed ? { ok: true } : { ok: false, error: "preset_not_found_in_db" };
    },
  };
}

function resolve_workspace(): string {
  if (process.env.WORKSPACE) return resolve(process.env.WORKSPACE);
  const src_dir = fileURLToPath(new URL(".", import.meta.url));
  return join(resolve(src_dir, ".."), "workspace");
}

function is_main_entry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const entry = resolve(argv1).toLowerCase();
  const current = resolve(fileURLToPath(import.meta.url)).toLowerCase();
  return entry === current;
}

if (is_main_entry()) {
  void (async () => {
    const boot_logger = create_logger("boot");
    const workspace = resolve_workspace();
    boot_logger.info(`workspace=${workspace}`);
    const lock = await acquire_runtime_instance_lock({ workspace, retries: 25, retry_ms: 200 });
    if (!lock.acquired) {
      boot_logger.error(`another instance is active holder_pid=${lock.holder_pid || "unknown"} lock=${lock.lock_path}`);
      process.exit(1);
    }

    const app = await createRuntime();
    const release_lock = async (): Promise<void> => {
      await lock.release().catch(() => undefined);
    };
    const SHUTDOWN_TIMEOUT_MS = 5_000;
    let shutting_down = false;
    const on_signal = (sig: string) => {
      if (shutting_down) return;
      shutting_down = true;
      boot_logger.info(`graceful shutdown start signal=${sig}`);
      clearInterval(app.session_prune_timer);
      const force_exit = setTimeout(() => {
        boot_logger.warn("shutdown timeout — forcing exit");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      force_exit.unref();
      void app.services.stop()
        .then(() => app.agent_backends.close())
        .then(() => app.bus.close())
        .then(() => { if ("close" in app.sessions) (app.sessions as { close(): void }).close(); })
        .catch((err) => { boot_logger.error(`shutdown error: ${err instanceof Error ? err.message : String(err)}`); })
        .finally(() => {
          clearTimeout(force_exit);
          void release_lock().finally(() => {
            boot_logger.info("graceful shutdown done");
            process.exit(0);
          });
        });
    };
    process.on("SIGINT", () => on_signal("SIGINT"));
    process.on("SIGTERM", () => on_signal("SIGTERM"));
  })().catch((error) => {
    const detail = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
    create_logger("boot").error(`bootstrap failed: ${detail}`);
    process.exit(1);
  });
}
