/** Runtime data bundle: 메시지 버스, 결정/이벤트 서비스, 스토어, embed/vector/webhook/query-db 인프라. */

import { join } from "node:path";
import type { AppConfig } from "../config/schema.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import type { create_logger } from "../logger.js";
import type { EmbedServiceFn } from "./agent-core.js";
import { resolve_from_workspace } from "./runtime-paths.js";
import { create_message_bus } from "../bus/index.js";
import type { MessageBusRuntime } from "../bus/types.js";
import { DecisionService } from "../decision/index.js";
import { WorkflowEventService } from "../events/index.js";
import { AgentProviderStore } from "../agent/provider-store.js";
import { OAuthIntegrationStore } from "../oauth/integration-store.js";
import { OAuthFlowService } from "../oauth/flow-service.js";
import { create_embed_service_from_provider } from "../services/embed.service.js";
import { create_vector_store_service } from "../services/vector-store.service.js";
import { WebhookStore } from "../services/webhook-store.service.js";
import { create_query_db_service } from "../services/query-db.service.js";

export interface RuntimeDataDeps {
  workspace: string;
  app_config: AppConfig;
  shared_vault: SecretVaultService;
  logger: ReturnType<typeof create_logger>;
}

export interface RuntimeDataResult {
  data_dir: string;
  sessions_dir: string;
  bus: MessageBusRuntime;
  decisions: DecisionService;
  events: WorkflowEventService;
  provider_store: AgentProviderStore;
  oauth_store: OAuthIntegrationStore;
  oauth_flow: OAuthFlowService;
  embed_service: EmbedServiceFn | undefined;
  vector_store_service: ReturnType<typeof create_vector_store_service> | undefined;
  webhook_store: WebhookStore;
  query_db_service: ReturnType<typeof create_query_db_service> | undefined;
}

export async function create_runtime_data(deps: RuntimeDataDeps): Promise<RuntimeDataResult> {
  const { workspace, app_config, shared_vault } = deps;

  const data_dir = resolve_from_workspace(workspace, app_config.dataDir, join(workspace, "runtime"));
  const decisions_dir = join(data_dir, "decisions");
  const events_dir = join(data_dir, "events");
  const sessions_dir = join(data_dir, "sessions");

  const bus = await create_message_bus({
    backend: app_config.bus.backend,
    redis: {
      url: app_config.bus.redis.url,
      keyPrefix: app_config.bus.redis.keyPrefix,
      blockMs: app_config.bus.redis.blockMs,
      claimIdleMs: app_config.bus.redis.claimIdleMs,
      streamMaxlen: app_config.bus.redis.streamMaxlen,
    },
  });

  const decisions = new DecisionService(workspace, decisions_dir);
  const events = new WorkflowEventService(workspace, events_dir, null, app_config.taskLoopMaxTurns);

  const provider_store = new AgentProviderStore(
    join(data_dir, "agent-providers", "providers.db"),
    shared_vault,
  );

  const oauth_store = new OAuthIntegrationStore(
    join(data_dir, "oauth", "integrations.db"),
    shared_vault,
  );
  const oauth_flow = new OAuthFlowService(oauth_store);
  oauth_flow.load_custom_presets();

  // embed 서비스: 등록된 embedding 프로바이더에서 생성
  const embed_instance_id = app_config.embedding.instanceId
    || provider_store.list_for_purpose("embedding")[0]?.instance_id;
  const embed_provider = embed_instance_id ? provider_store.get(embed_instance_id) : null;
  const embed_model_override = app_config.embedding.model || undefined;
  const embed_service = embed_provider
    ? create_embed_service_from_provider({
      provider_type: embed_provider.provider_type,
      model: embed_model_override || (typeof embed_provider.settings.model === "string" ? embed_provider.settings.model : undefined),
      api_base: provider_store.resolve_api_base(embed_instance_id!),
      get_api_key: () => provider_store.resolve_token(embed_instance_id!),
    })
    : undefined;

  const vector_store_service = create_vector_store_service(data_dir);
  const webhook_store = new WebhookStore();
  const query_db_service = create_query_db_service(data_dir);

  return {
    data_dir, sessions_dir, bus, decisions, events,
    provider_store, oauth_store, oauth_flow,
    embed_service, vector_store_service, webhook_store, query_db_service,
  };
}
