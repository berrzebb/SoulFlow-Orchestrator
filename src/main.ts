import { error_message, now_iso} from "./utils/common.js";
import { join, resolve } from "node:path";
import { mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
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
  type ChannelRegistryLike,
} from "./channels/index.js";
import { ApprovalService } from "./channels/approval.service.js";
import { create_command_router } from "./channels/create-command-router.js";
import { TaskResumeService } from "./channels/task-resume.service.js";
import { DispatchService } from "./channels/dispatch.service.js";
import { MediaCollector } from "./channels/media-collector.js";
import { DefaultOutboundDedupePolicy } from "./channels/outbound-dedupe.js";
import { sanitize_provider_output } from "./channels/output-sanitizer.js";
import { DefaultRuntimePolicyResolver } from "./channels/runtime-policy.js";
import { SessionRecorder } from "./channels/session-recorder.js";
import { load_config_merged } from "./config/schema.js";
import { ConfigStore } from "./config/config-store.js";
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
import { OrchestratorLlmRuntime, ProviderRegistry } from "./providers/index.js";
import { OrchestratorLlmServiceAdapter } from "./providers/orchestrator-llm-service.adapter.js";
import { acquire_runtime_instance_lock } from "./runtime/instance-lock.js";
import { ServiceManager } from "./runtime/service-manager.js";
import { SessionStore, type SessionStoreLike } from "./session/index.js";
import { McpClientManager, create_mcp_tool_adapters } from "./mcp/index.js";
import { FileMcpServerStore } from "./agent/tools/mcp-store.js";
import { AgentBackendRegistry } from "./agent/agent-registry.js";
import { AgentSessionStore } from "./agent/agent-session-store.js";
import { AgentProviderStore } from "./agent/provider-store.js";
import { create_agent_provider } from "./agent/provider-factory.js";
import { CliAuthService } from "./agent/cli-auth.service.js";
import { randomUUID } from "node:crypto";
import { init_log_level } from "./logger.js";
import { OAuthIntegrationStore } from "./oauth/integration-store.js";
import { OAuthFlowService } from "./oauth/flow-service.js";
import { OAuthFetchTool } from "./agent/tools/oauth-fetch.js";
import {
  create_template_ops, create_channel_ops, create_agent_provider_ops,
  create_bootstrap_ops, create_memory_ops, create_workspace_ops, create_oauth_ops,
  create_config_ops, create_skill_ops, create_tool_ops, create_cli_auth_ops, create_model_ops,
  create_workflow_ops,
} from "./dashboard/ops-factory.js";
import { PhaseWorkflowStore } from "./agent/phase-workflow-store.js";

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
  orchestrator_llm_runtime: OrchestratorLlmRuntime;
  sessions: SessionStoreLike;
  dashboard: DashboardService | null;
  decisions: DecisionService;
  events: WorkflowEventService;
  ops: OpsRuntimeService;
  services: ServiceManager;
  session_prune_timer: ReturnType<typeof setInterval>;
  cli_auth: CliAuthService;
}

function resolve_from_workspace(workspace: string, path_value: string, fallback: string): string {
  const raw = String(path_value || "").trim();
  if (!raw) return fallback;
  return resolve(workspace, raw);
}

export async function createRuntime(): Promise<RuntimeApp> {
  const workspace = resolve_workspace();
  const app_root = resolve_app_root();

  // 기본 워크플로우 템플릿 시드 (WORKSPACE/workflows/ 가 비어있으면 default-workflows/ 에서 복사)
  seed_default_workflows(workspace, app_root);

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
  const orchestrator_llm_config = provider_store.get("orchestrator_llm");
  const orchestrator_llm_key = await provider_store.get_token("orchestrator_llm");

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
    orchestrator_llm_api_key: orchestrator_llm_key,
    orchestrator_llm_api_base: (orchestrator_llm_config?.settings.api_base as string) || undefined,
    orchestrator_llm_model: (orchestrator_llm_config?.settings.model as string) || undefined,
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

  // CLI 인증 서비스: container_cli 백엔드의 OAuth 상태 관리
  const cli_auth = new CliAuthService({ logger: logger.child("cli-auth") });

  // 팩토리 기반 백엔드 생성
  const factory_deps = { provider_registry: providers, workspace, cli_auth_service: cli_auth };
  const agent_backends: import("./agent/agent.types.js").AgentBackend[] = [];
  for (const config of provider_store.list()) {
    if (!config.enabled) continue;
    const token = await provider_store.get_token(config.instance_id);
    const backend = create_agent_provider(config, token, factory_deps);
    if (backend) agent_backends.push(backend);
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

  const agent = new AgentDomain(workspace, { providers, bus, data_dir, events, agent_backends: agent_backend_registry, secret_vault: providers.get_secret_vault(), logger: logger.child("agent"), provider_caps, on_task_change: (task) => dashboard?.sse.broadcast_task_event("status_change", task), app_root });
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
  const phase_workflow_store = new PhaseWorkflowStore(join(workspace, "runtime", "workflows", "phase-workflows.db"));
  const agent_inspector = create_agent_inspector(agent);
  const agent_runtime = create_agent_runtime(agent, { phase_workflow_store });
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
    on_change: (type, job_id) => dashboard?.sse.broadcast_cron_event(type, job_id),
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
    on_direct_send: (msg) => dashboard?.sse.broadcast_message_event("outbound", msg.sender_id, msg.content, msg.chat_id),
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
    on_change: (type, entry) => dashboard?.sse.broadcast_process_event(type, entry),
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
    workspace,
    subagents: agent.subagents,
    phase_workflow_store,
    get_sse_broadcaster: () => dashboard?.sse ?? null,
  });

  const command_router = create_command_router({
    cancel_active_runs: (key) => channel_manager_ref?.cancel_active_runs(key) ?? 0,
    render_profile: {
      get: (p, c) => channel_manager_ref!.get_render_profile(p, c),
      set: (p, c, patch) => channel_manager_ref!.set_render_profile(p, c, patch),
      reset: (p, c) => channel_manager_ref!.reset_render_profile(p, c),
    },
    agent, agent_runtime, process_tracker, orchestration, providers,
    agent_backend_registry, mcp, session_recorder, cron, decisions,
    default_alias: app_config.channel.defaultAlias,
  });

  const task_resume = new TaskResumeService({
    agent_runtime,
    logger: logger.child("task-resume"),
  });

  // bot identity: instance_id 우선 조회 → provider 폴백
  const bot_identity = {
    get_bot_self_id(id: string): string {
      const inst = instance_store.get(id);
      return String((inst?.settings as Record<string, unknown>)?.bot_self_id || "").trim();
    },
    get_default_target(id: string): string {
      const inst = instance_store.get(id);
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
    on_agent_event: (event) => dashboard?.sse.broadcast_agent_event(event),
    on_web_stream: (chat_id, content, done) => dashboard?.sse.broadcast_web_stream(chat_id, content, done),
  });
  channel_manager_ref = channel_manager;

  const orchestrator_llm_runtime = new OrchestratorLlmRuntime({
    enabled: app_config.orchestratorLlm.enabled,
    engine: app_config.orchestratorLlm.engine,
    image: app_config.orchestratorLlm.image,
    container: app_config.orchestratorLlm.container,
    port: app_config.orchestratorLlm.port,
    model: app_config.orchestratorLlm.model,
    pull_model: app_config.orchestratorLlm.pullModel,
    auto_stop: app_config.orchestratorLlm.autoStop,
    gpu_enabled: app_config.orchestratorLlm.gpuEnabled,
    gpu_args: app_config.orchestratorLlm.gpuArgs,
    api_base: (orchestrator_llm_config?.settings.api_base as string) || app_config.orchestratorLlm.apiBase,
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
            at: now_iso(),
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
      config_ops: create_config_ops({ app_config, config_store }),
      skill_ops: create_skill_ops({ skills_loader: agent.context.skills_loader, workspace }),
      tool_ops: create_tool_ops({ tool_names: () => agent.tools.tool_names(), get_definitions: () => agent.tools.get_definitions(), mcp }),
      template_ops: create_template_ops(workspace),
      channel_ops: create_channel_ops({ channels, instance_store, app_config }),
      agent_provider_ops: create_agent_provider_ops({
        provider_store, agent_backends: agent_backend_registry,
        provider_registry: providers, workspace,
      }),
      bootstrap_ops: create_bootstrap_ops({ provider_store, config_store, provider_registry: providers, agent_backends: agent_backend_registry, workspace }),
      session_store: sessions,
      memory_ops: create_memory_ops(agent.context.memory_store),
      workspace_ops: create_workspace_ops(workspace),
      oauth_ops: create_oauth_ops({ oauth_store, oauth_flow, dashboard_port: app_config.dashboard.port, public_url: app_config.dashboard.publicUrl }),
      cli_auth_ops: create_cli_auth_ops({ cli_auth }),
      model_ops: orchestrator_llm_runtime ? create_model_ops(orchestrator_llm_runtime) : null,
      workflow_ops: create_workflow_ops({ store: phase_workflow_store, subagents: agent.subagents, workspace, logger, on_workflow_event: (e) => dashboard?.sse.broadcast_workflow_event(e) }),
      default_alias: app_config.channel.defaultAlias,
      workspace,
    });
    dashboard.set_oauth_callback_handler((code, state) => oauth_flow.handle_callback(code, state));
    bus.on_publish((dir, msg) => {
      dashboard?.sse.broadcast_message_event(dir, msg.sender_id, msg.content, msg.chat_id);
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
      if (event) dashboard?.sse.broadcast_progress_event(event);
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
  services.register(new OrchestratorLlmServiceAdapter(orchestrator_llm_runtime), { required: false });

  const enabled_channels = instance_store.list().filter((c) => c.enabled).map((c) => c.provider);
  logger.info(`channels=${enabled_channels.join(",")} primary=${primary_provider}`);

  await register_mcp_tools(workspace, mcp, agent_runtime, logger).catch((error) => {
    logger.error(`mcp tool registration failed: ${error_message(error)}`);
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

  // CLI 인증 상태 비차단 확인: container_cli 백엔드의 is_available() 갱신
  cli_auth.check_all().then((statuses) => {
    for (const s of statuses) {
      logger.info(`cli-auth ${s.cli} authenticated=${s.authenticated}${s.account ? ` account=${s.account}` : ""}`);
    }
    // ContainerCliAgent.check_auth() 호출하여 is_available() 반영
    for (const backend of agent_backends) {
      if ("check_auth" in backend && typeof (backend as { check_auth: () => Promise<boolean> }).check_auth === "function") {
        void (backend as { check_auth: () => Promise<boolean> }).check_auth();
      }
    }
  }).catch((err) => {
    logger.warn(`cli-auth check failed: ${error_message(err)}`);
  });

  if (dashboard) logger.info(`dashboard ${dashboard.get_url()}`);
  const orch_llm_status = orchestrator_llm_runtime.get_status();
  if (orch_llm_status.enabled) {
    logger.info(`orchestrator-llm running=${orch_llm_status.running} engine=${orch_llm_status.engine || "n/a"} base=${orch_llm_status.api_base}`);
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
    orchestrator_llm_runtime,
    sessions,
    dashboard,
    decisions,
    events,
    ops,
    services,
    session_prune_timer,
    cli_auth,
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

/** WORKSPACE/workflows/ 가 비어있으면 빌트인 기본 템플릿을 시드. */
function seed_default_workflows(workspace: string, app_root: string): void {
  const target_dir = join(workspace, "workflows");
  mkdirSync(target_dir, { recursive: true });

  const existing = readdirSync(target_dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (existing.length > 0) return;

  // production: Dockerfile COPY → default-workflows/
  // dev: 볼륨 마운트 → workspace/workflows/ (소스 직접 참조)
  const candidates = [
    join(app_root, "default-workflows"),
    join(app_root, "workspace", "workflows"),
  ];
  const source_dir = candidates.find((d) => existsSync(d));
  if (!source_dir) return;

  const templates = readdirSync(source_dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of templates) {
    copyFileSync(join(source_dir, file), join(target_dir, file));
  }
}

function resolve_workspace(): string {
  if (process.env.WORKSPACE) return resolve(process.env.WORKSPACE);
  const src_dir = fileURLToPath(new URL(".", import.meta.url));
  return join(resolve(src_dir, ".."), "workspace");
}

/** dist/main.js → 프로젝트 루트. Docker에서 workspace와 앱 루트가 다를 때 builtin skill 탐색에 사용. */
function resolve_app_root(): string {
  const src_dir = fileURLToPath(new URL(".", import.meta.url));
  return resolve(src_dir, "..");
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
    const skip_lock = process.env.SKIP_INSTANCE_LOCK === "1";
    const lock = skip_lock ? null : await acquire_runtime_instance_lock({ workspace, retries: 25, retry_ms: 200 });
    if (lock && !lock.acquired) {
      boot_logger.error(`another instance is active holder_pid=${lock.holder_pid || "unknown"} lock=${lock.lock_path}`);
      process.exit(1);
    }

    const app = await createRuntime();
    const release_lock = async (): Promise<void> => {
      await lock?.release().catch(() => undefined);
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
        .catch((err) => { boot_logger.error(`shutdown error: ${error_message(err)}`); })
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
    const detail = error_message(error);
    create_logger("boot").error(`bootstrap failed: ${detail}`);
    process.exit(1);
  });
}
