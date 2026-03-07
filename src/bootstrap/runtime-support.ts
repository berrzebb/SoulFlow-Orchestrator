/** Runtime support services: OrchestratorLlmRuntime, ServiceManager, HeartbeatService, OpsRuntimeService. */

import { now_iso } from "../utils/common.js";
import type { AppConfig } from "../config/schema.js";
import type { AgentDomain } from "../agent/index.js";
import type { create_agent_runtime } from "../agent/runtime.service.js";
import type { AgentProviderStore } from "../agent/provider-store.js";
import type { MessageBusRuntime } from "../bus/types.js";
import type { ChannelManager } from "../channels/manager.js";
import type { SqliteDispatchDlqStore } from "../channels/index.js";
import type { CronService } from "../cron/index.js";
import type { DecisionService } from "../decision/index.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { SessionStoreLike } from "../session/index.js";
import type { create_logger } from "../logger.js";
import { OrchestratorLlmRuntime } from "../providers/index.js";
import { HeartbeatService } from "../heartbeat/index.js";
import { OpsRuntimeService } from "../ops/index.js";
import { ServiceManager } from "../runtime/service-manager.js";

export interface RuntimeSupportDeps {
  workspace: string;
  app_config: AppConfig;
  provider_store: AgentProviderStore;
  agent: AgentDomain;
  agent_runtime: ReturnType<typeof create_agent_runtime>;
  bus: MessageBusRuntime;
  channel_manager: ChannelManager;
  cron: CronService;
  decisions: DecisionService;
  providers: ProviderRegistry;
  sessions: SessionStoreLike;
  dlq_store: InstanceType<typeof SqliteDispatchDlqStore> | null;
  primary_provider: string;
  default_chat_id: string;
  logger: ReturnType<typeof create_logger>;
}

export interface RuntimeSupportResult {
  orchestrator_llm_runtime: OrchestratorLlmRuntime;
  services: ServiceManager;
  heartbeat: HeartbeatService;
  ops: OpsRuntimeService;
}

export function create_runtime_support(deps: RuntimeSupportDeps): RuntimeSupportResult {
  const {
    workspace, app_config, provider_store,
    agent, agent_runtime, bus, channel_manager,
    cron, decisions, providers, sessions, dlq_store,
    primary_provider, default_chat_id, logger,
  } = deps;

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
    api_base: (provider_store.get("orchestrator_llm")?.settings.api_base as string) || app_config.orchestratorLlm.apiBase,
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

  return { orchestrator_llm_runtime, services, heartbeat, ops };
}
