/** Dashboard bundle: DashboardService 생성 + ops 팩토리 조립 + SSE/webhook/bus wiring. */

import type { AppConfig } from "../config/schema.js";
import type { ConfigStore } from "../config/config-store.js";
import type { AgentDomain } from "../agent/index.js";
import type { create_agent_runtime } from "../agent/runtime.service.js";
import type { create_agent_inspector } from "../agent/inspector.service.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { AgentProviderStore } from "../agent/provider-store.js";
import type { AgentDefinitionStore } from "../agent/agent-definition.store.js";
import type { MessageBusRuntime } from "../bus/types.js";
import type { ChannelManager } from "../channels/manager.js";
import type { ChannelInstanceStore, ChannelRegistryLike } from "../channels/index.js";
import type { SqliteDispatchDlqStore } from "../channels/index.js";
import type { DispatchService } from "../channels/dispatch.service.js";
import type { CliAuthService } from "../agent/cli-auth.service.js";
import type { DecisionService } from "../decision/index.js";
import type { WorkflowEventService } from "../events/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { McpClientManager } from "../mcp/index.js";
import type { OpsRuntimeService } from "../ops/index.js";
import type { OrchestratorLlmRuntime, ProviderRegistry } from "../providers/index.js";
import type { ProcessTracker } from "../orchestration/process-tracker.js";
import type { CronService } from "../cron/index.js";
import type { OrchestrationService } from "../orchestration/service.js";
import type { SessionStoreLike } from "../session/index.js";
import type { OAuthIntegrationStore } from "../oauth/integration-store.js";
import type { OAuthFlowService } from "../oauth/flow-service.js";
import type { KanbanStore } from "../services/kanban-store.js";
import type { KanbanAutomationRuntime } from "../services/kanban-automation-runtime.js";
import type { ReferenceStore } from "../services/reference-store.js";
import type { WebhookStore } from "../services/webhook-store.service.js";
import type { MutableBroadcaster } from "../dashboard/broadcaster.js";
import { DashboardService, type DashboardWorkflowOps } from "../dashboard/service.js";
import {
  create_template_ops, create_channel_ops, create_agent_provider_ops,
  create_bootstrap_ops, create_memory_ops, create_workspace_ops, create_oauth_ops,
  create_config_ops, create_skill_ops, create_tool_ops, create_cli_auth_ops, create_model_ops,
  create_agent_definition_ops,
} from "../dashboard/ops-factory.js";
import { UsageStore } from "../gateway/usage-store.js";

export interface DashboardBundleDeps {
  workspace: string;
  app_config: AppConfig;
  config_store: ConfigStore;
  agent: AgentDomain;
  agent_runtime: ReturnType<typeof create_agent_runtime>;
  agent_inspector: ReturnType<typeof create_agent_inspector>;
  agent_backend_registry: AgentBackendRegistry;
  provider_store: AgentProviderStore;
  providers: ProviderRegistry;
  bus: MessageBusRuntime;
  broadcaster: MutableBroadcaster;
  channel_manager: ChannelManager;
  channels: ChannelRegistryLike;
  instance_store: ChannelInstanceStore;
  cli_auth: CliAuthService;
  decisions: DecisionService;
  events: WorkflowEventService;
  heartbeat: HeartbeatService;
  mcp: McpClientManager;
  ops: OpsRuntimeService;
  orchestrator_llm_runtime: OrchestratorLlmRuntime;
  orchestration: OrchestrationService;
  process_tracker: ProcessTracker;
  cron: CronService;
  sessions: SessionStoreLike;
  dlq_store: InstanceType<typeof SqliteDispatchDlqStore> | null;
  dispatch: DispatchService;
  oauth_store: OAuthIntegrationStore;
  oauth_flow: OAuthFlowService;
  kanban_store: KanbanStore;
  kanban_automation: KanbanAutomationRuntime;
  reference_store: ReferenceStore;
  webhook_store: WebhookStore;
  agent_definition_store: AgentDefinitionStore;
  workflow_ops_result: DashboardWorkflowOps | null;
}

export interface DashboardBundleResult {
  dashboard: DashboardService | null;
  agent_provider_ops: ReturnType<typeof create_agent_provider_ops>;
}

export function create_dashboard_bundle(deps: DashboardBundleDeps): DashboardBundleResult {
  const {
    workspace, app_config, config_store,
    agent, agent_runtime, agent_inspector, agent_backend_registry, provider_store, providers,
    bus, broadcaster, channel_manager, channels, instance_store,
    cli_auth, decisions, events, heartbeat, mcp, ops,
    orchestrator_llm_runtime, orchestration, process_tracker, cron,
    sessions, dlq_store, dispatch, oauth_store, oauth_flow,
    kanban_store, kanban_automation, reference_store, webhook_store,
    agent_definition_store, workflow_ops_result,
  } = deps;

  const agent_provider_ops = create_agent_provider_ops({
    provider_store, agent_backends: agent_backend_registry,
    provider_registry: providers, workspace,
  });

  if (!app_config.dashboard.enabled) {
    return { dashboard: null, agent_provider_ops };
  }

  const usage_store = new UsageStore(workspace);

  const dash = new DashboardService({
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
    dispatch,
    secrets: providers.get_secret_vault(),
    config_ops: create_config_ops({ app_config, config_store }),
    skill_ops: create_skill_ops({ skills_loader: agent.context.skills_loader, workspace }),
    tool_ops: create_tool_ops({ tool_names: () => agent.tools.tool_names(), get_definitions: () => agent.tools.get_definitions(), mcp }),
    template_ops: create_template_ops(workspace),
    channel_ops: create_channel_ops({ channels, instance_store, app_config, workspace_dir: workspace }),
    agent_provider_ops,
    bootstrap_ops: create_bootstrap_ops({ provider_store, config_store, provider_registry: providers, agent_backends: agent_backend_registry, workspace }),
    session_store: sessions,
    memory_ops: create_memory_ops(agent.context.memory_store),
    workspace_ops: create_workspace_ops(workspace),
    oauth_ops: create_oauth_ops({ oauth_store, oauth_flow, dashboard_port: app_config.dashboard.port, public_url: app_config.dashboard.publicUrl }),
    cli_auth_ops: create_cli_auth_ops({ cli_auth }),
    model_ops: orchestrator_llm_runtime ? create_model_ops(orchestrator_llm_runtime) : null,
    usage_ops: usage_store,
    prompt_ops: {
      async run(input) {
        const chat_provider = provider_store.list().find((p) => p.enabled && p.model_purpose === "chat");
        const result = await providers.run_headless_prompt({
          provider_id: (input.provider_id ?? chat_provider?.provider_type) as import("../providers/types.js").ProviderId | undefined,
          prompt: input.prompt,
          system: input.system,
          model: input.model,
          temperature: input.temperature,
          max_tokens: input.max_tokens,
        });
        return { content: result?.content ?? null, provider_id: input.provider_id ?? chat_provider?.provider_type ?? null };
      },
    },
    agent_definition_ops: create_agent_definition_ops({
      store: agent_definition_store,
      generate_fn: async (prompt) => {
        // model_purpose=chat인 활성 프로바이더 우선 선택 (임베딩 모델 제외)
        const chat_provider = provider_store.list().find((p) => p.enabled && p.model_purpose === "chat");
        const result = await providers.run_headless({
          provider_id: chat_provider?.provider_type as import("../providers/types.js").ProviderId | undefined,
          messages: [
            {
              role: "user" as const,
              content: `You are an AI agent designer. Given a description, output a JSON object with these exact fields:
{"name":"string","description":"string (one-line Use when... summary)","icon":"single emoji","role_skill":"string|null (e.g. role:pm, role:implementer, or null if custom)","soul":"string (persona/character)","heart":"string (behavior/manner)","tools":["string array"],"shared_protocols":["string array from: clarification-protocol,phase-gates,error-escalation,session-metrics,difficulty-guide"],"skills":[],"use_when":"string","not_use_for":"string","extra_instructions":"","preferred_providers":[],"model":null}

Output ONLY the JSON object, no markdown, no explanation.

Description: ${prompt}`,
            },
          ],
        });
        if (!result?.content) return null;
        try {
          const text = result.content.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
          return JSON.parse(text) as import("../agent/agent-definition.types.js").GeneratedAgentFields;
        } catch {
          return null;
        }
      },
    }),
    workflow_ops: workflow_ops_result,
    kanban_store,
    kanban_rule_executor: () => kanban_automation.get_rule_executor(),
    reference_store,
    default_alias: app_config.channel.defaultAlias,
    workspace,
    webhookSecret: app_config.dashboard.webhookSecret,
  });

  broadcaster.attach(dash.sse);
  dash.set_oauth_callback_handler((code: string, state: string) => oauth_flow.handle_callback(code, state));
  dash.set_webhook_store(webhook_store);
  bus.on_publish((dir, msg) => {
    broadcaster.broadcast_message_event(dir, msg.sender_id, msg.content, msg.chat_id);
    if (dir === "outbound" && msg.provider === "web" && msg.chat_id) {
      const media = msg.media?.map((m) => ({ type: m.type as string, url: m.url, mime: m.mime, name: m.name }));
      dash.capture_web_outbound(msg.chat_id, msg.content, media);
      // 메시지 저장 후 SSE 발송 → 폴링 없이 프론트엔드 즉시 refetch
      broadcaster.broadcast_web_message(msg.chat_id);
    }
  });

  return { dashboard: dash, agent_provider_ops };
}
