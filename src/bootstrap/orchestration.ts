/** Orchestration bundle: OrchestrationService, CronService, oauth_fetch, create_task. */

import { join } from "node:path";
import { error_message, now_iso, make_run_id } from "../utils/common.js";
import type { AppConfig } from "../config/schema.js";
import type { ProviderCapabilities } from "../providers/executor.js";
import type { MessageBusRuntime } from "../bus/types.js";
import type { MutableBroadcaster } from "../dashboard/broadcaster.js";
import type { AgentDomain } from "../agent/index.js";
import type { create_agent_runtime } from "../agent/runtime.service.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { WorkflowEventService } from "../events/index.js";
import type { DecisionService } from "../decision/index.js";
import type { OAuthIntegrationStore } from "../oauth/integration-store.js";
import type { OAuthFlowService } from "../oauth/flow-service.js";
import type { KanbanStoreLike, KanbanEvent } from "../services/kanban-store.js";
import type { McpClientManager } from "../mcp/index.js";
import type { PersonaMessageRenderer } from "../channels/persona-message-renderer.js";
import type { ProcessTracker } from "../orchestration/process-tracker.js";
import type { ConfirmationGuard } from "../orchestration/confirmation-guard.js";
import type { HitlPendingStore } from "../orchestration/hitl-pending-store.js";
import type { ToolIndex } from "../orchestration/tool-index.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { PhaseWorkflowStore } from "../agent/phase-workflow-store.js";
import type { WebhookStore } from "../services/webhook-store.service.js";
import type { create_vector_store_service } from "../services/vector-store.service.js";
import type { create_query_db_service } from "../services/query-db.service.js";
import type { EmbedServiceFn } from "./agent-core.js";
import { parse_executor_preference, resolve_executor_provider } from "../providers/executor.js";
import { DefaultRuntimePolicyResolver } from "../channels/runtime-policy.js";
import { OrchestrationService } from "../orchestration/service.js";
import { create_cron_job_handler, CronService } from "../cron/index.js";
import { create_task_service } from "../services/create-task.service.js";
import { create_logger } from "../logger.js";
import { create_cd_observer } from "../agent/cd-scoring.js";
import { HookRunner, load_hooks_from_file } from "../hooks/index.js";
import type { TeamWorkspace } from "../workspace/workspace-context.js";
import type { ObservabilityLike } from "../observability/context.js";

export interface OrchestrationBundleDeps {
  ctx: TeamWorkspace;
  workspace: string;
  user_dir: string;
  data_dir: string;
  app_config: AppConfig;
  providers: ProviderRegistry;
  agent: AgentDomain;
  agent_runtime: ReturnType<typeof create_agent_runtime>;
  agent_backend_registry: AgentBackendRegistry;
  provider_caps: ProviderCapabilities;
  bus: MessageBusRuntime;
  events: WorkflowEventService;
  decisions: DecisionService;
  process_tracker: ProcessTracker;
  mcp: McpClientManager;
  phase_workflow_store: PhaseWorkflowStore;
  broadcaster: MutableBroadcaster;
  confirmation_guard: ConfirmationGuard;
  oauth_store: OAuthIntegrationStore;
  oauth_flow: OAuthFlowService;
  embed_service: EmbedServiceFn | undefined;
  vector_store_service: ReturnType<typeof create_vector_store_service> | undefined;
  webhook_store: WebhookStore;
  kanban_store: KanbanStoreLike;
  query_db_service: ReturnType<typeof create_query_db_service> | undefined;
  persona_renderer: PersonaMessageRenderer;
  hitl_pending_store: HitlPendingStore;
  tool_index: ToolIndex;
  resolve_instance_to_type: (id: string) => string;
  primary_provider: string;
  default_chat_id: string;
  logger: ReturnType<typeof create_logger>;
  observability?: ObservabilityLike | null;
}

export interface OrchestrationBundleResult {
  orchestration: OrchestrationService;
  cron: CronService;
  create_task_fn: ReturnType<typeof create_task_service>;
  oauth_fetch_service: (
    service_id: string,
    opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown },
  ) => Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
}

/** KanbanStore subscribe를 Promise 기반 one-shot 대기로 변환. */
export function make_wait_kanban_event(store: KanbanStoreLike) {
  return async (raw_board_id: string, filter: { actions?: string[]; column_id?: string }) => {
    let board_id = raw_board_id;
    const scope_match = raw_board_id.match(/^scope:(\w+):(.+)$/);
    if (scope_match) {
      const boards = await store.list_boards(scope_match[1] as import("../services/kanban-store.js").ScopeType, scope_match[2]);
      if (boards.length > 0) board_id = boards[0].board_id;
    }
    return new Promise<{ card_id: string; board_id: string; action: string; actor: string; detail: Record<string, unknown>; created_at: string } | null>((resolve) => {
      const timeout = setTimeout(() => { store.unsubscribe(board_id, handler); resolve(null); }, 60_000);
      const handler = (event: KanbanEvent) => {
        const act = event.data;
        if (filter.actions?.length && !filter.actions.includes(act.action)) return;
        if (filter.column_id) {
          const d = act.detail as Record<string, unknown>;
          const matches = d.column_id === filter.column_id || d.to === filter.column_id;
          if (!matches) return;
        }
        clearTimeout(timeout);
        store.unsubscribe(board_id, handler);
        resolve({ card_id: act.card_id, board_id: act.board_id, action: act.action, actor: act.actor, detail: act.detail, created_at: act.created_at });
      };
      store.subscribe(board_id, handler);
    });
  };
}

export async function create_orchestration_bundle(deps: OrchestrationBundleDeps): Promise<OrchestrationBundleResult> {
  const {
    workspace, user_dir, data_dir: _data_dir, app_config,
    providers, agent, agent_runtime, agent_backend_registry, provider_caps,
    bus, events, decisions, process_tracker, mcp,
    phase_workflow_store, broadcaster, confirmation_guard,
    oauth_store, oauth_flow,
    embed_service, vector_store_service, webhook_store, kanban_store, query_db_service,
    persona_renderer, hitl_pending_store, tool_index,
    resolve_instance_to_type, primary_provider, default_chat_id, logger,
  } = deps;

  // oauth_fetch 서비스: 워크플로우 노드에서 OAuth 인증 HTTP 호출 지원
  const oauth_fetch_service = async (
    service_id: string,
    opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown },
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }> => {
    const { normalize_headers, serialize_body, timed_fetch } = await import("../agent/tools/http-utils.js");
    const integration = oauth_store.get(service_id);
    if (!integration) throw new Error(`OAuth integration "${service_id}" not found`);
    if (!integration.enabled) throw new Error(`OAuth integration "${service_id}" is disabled`);

    const { token, error } = await oauth_flow.get_valid_access_token(service_id);
    if (!token) throw new Error(`No valid token for "${service_id}": ${error || "not configured"}`);

    const method = (opts.method || "GET").toUpperCase();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...normalize_headers(opts.headers),
    };
    const body = serialize_body(opts.body, headers);

    let res = await timed_fetch(opts.url, { method, headers, body, timeout_ms: 15_000 });

    if (res.status === 401) {
      const refresh_result = await oauth_flow.refresh_token(service_id);
      if (refresh_result.ok) {
        const new_token = await oauth_store.get_access_token(service_id);
        if (new_token) {
          headers.Authorization = `Bearer ${new_token}`;
          res = await timed_fetch(opts.url, { method, headers, body, timeout_ms: 15_000 });
        }
      }
    }

    const res_headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { res_headers[k] = v; });
    const content_type = res.headers.get("content-type") || "";
    const res_body = content_type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body: res_body, headers: res_headers };
  };

  // create_task: lazy thunk — 클로저 내부에서 orchestration을 참조하지만, 호출 시점에만 resolve됨
  const create_task_fn = create_task_service(() => ({
    execute: async (opts) => {
      const run_id = make_run_id("task");
      const result = await orchestration.execute({
        message: {
          id: run_id,
          provider: opts.channel,
          channel: opts.channel,
          sender_id: "workflow",
          chat_id: opts.chat_id,
          content: opts.objective,
          at: now_iso(),
        },
        alias: opts.title || "default",
        provider: opts.channel,
        media_inputs: [],
        session_history: [],
        run_id,
        max_turns: opts.max_turns,
        initial_memory: opts.initial_memory,
      });
      const has_error = !!result.error;
      return {
        task_id: result.run_id || run_id,
        status: has_error ? "failed" : "completed",
        result: result.reply ?? undefined,
        error: has_error ? (result.error || result.reply || undefined) : undefined,
      };
    },
  }));

  // HOOK.md 기반 사용자 정의 훅 로드
  const hooks_config = load_hooks_from_file(workspace);
  const hook_runner = new HookRunner(workspace, hooks_config);

  const orchestration = new OrchestrationService({
    providers,
    agent_runtime,
    secret_vault: providers.get_secret_vault(),
    runtime_policy_resolver: new DefaultRuntimePolicyResolver(),
    config: {
      executor_provider: resolve_executor_provider(
        parse_executor_preference(resolve_instance_to_type(app_config.orchestration.executorProvider) || app_config.orchestration.executorProvider),
        provider_caps,
      ),
      agent_loop_max_turns: app_config.agentLoopMaxTurns,
      task_loop_max_turns: app_config.taskLoopMaxTurns,
      streaming_enabled: app_config.channel.streaming.enabled,
      streaming_interval_ms: app_config.channel.streaming.intervalMs,
      streaming_min_chars: app_config.channel.streaming.minChars,
      streaming_max_chars: app_config.channel.streaming.coalesceMaxChars,
      max_tool_result_chars: app_config.orchestration.maxToolResultChars,
      orchestrator_max_tokens: app_config.orchestration.orchestratorMaxTokens,
    },
    logger: logger.child("orchestration"),
    agent_backends: agent_backend_registry,
    process_tracker,
    get_mcp_configs: () => mcp.get_server_configs(),
    events,
    workspace,
    user_dir,
    subagents: agent.subagents,
    phase_workflow_store,
    get_sse_broadcaster: () => broadcaster,
    confirmation_guard,
    bus,
    decision_service: decisions,
    promise_service: agent.context.promise_service,
    oauth_fetch: oauth_fetch_service,
    embed: embed_service,
    vector_store: vector_store_service,
    get_webhook_data: (path) => webhook_store.get(path),
    wait_kanban_event: make_wait_kanban_event(kanban_store),
    query_db: query_db_service,
    renderer: persona_renderer,
    hitl_pending_store,
    session_cd: create_cd_observer(),
    tool_index,
    create_task: create_task_fn,
    hook_runner,
    observability: deps.observability,
  });

  // 팀 스코프: 크론 잡은 팀 멤버 간 공유
  const cron = new CronService(join(deps.ctx.team_runtime, "cron"), create_cron_job_handler({
    config: {
      agent_loop_max_turns: app_config.agentLoopMaxTurns,
      per_turn_timeout_ms: 600_000,
      default_alias: app_config.channel.defaultAlias,
      executor_provider: resolve_instance_to_type(app_config.orchestration.executorProvider) || app_config.orchestration.executorProvider,
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
    on_workflow_trigger: async (slug, channel, chat_id) => {
      try {
        const { load_workflow_template, substitute_variables } = await import("../orchestration/workflow-loader.js");
        const template = load_workflow_template(user_dir, slug);
        if (!template) return { ok: false, error: `template not found: ${slug}` };
        const substituted = substitute_variables(template, { ...template.variables, channel });
        const run_id = make_run_id("wf-cron");
        const result = await orchestration.execute({
          message: { id: run_id, provider: channel, channel, sender_id: "cron", chat_id, content: substituted.objective || substituted.title, at: now_iso() },
          alias: app_config.channel.defaultAlias,
          provider: channel,
          media_inputs: [],
          session_history: [],
          run_id,
        });
        return { ok: !result.error, workflow_id: result.run_id || run_id, error: result.error || undefined };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },
  }), {
    on_change: (type, job_id, team_id) => broadcaster.broadcast_cron_event(type, job_id, team_id),
  });

  return { orchestration, cron, create_task_fn, oauth_fetch_service };
}
