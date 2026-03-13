/** Runtime data bundle: 메시지 버스, 결정/이벤트 서비스, 스토어, embed/vector/webhook/query-db 인프라. */

import { join } from "node:path";
import type { AppConfig } from "../config/schema.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import type { create_logger } from "../logger.js";
import type { EmbedServiceFn } from "./agent-core.js";
import type { EmbedWorkerConfig } from "../agent/memory.types.js";
import type { UserWorkspace } from "../workspace/workspace-context.js";
import { create_message_bus } from "../bus/index.js";
import type { MessageBusRuntime } from "../bus/types.js";
import { DecisionService } from "../decision/index.js";
import { WorkflowEventService } from "../events/index.js";
import { AgentProviderStore } from "../agent/provider-store.js";
import { AgentDefinitionStore } from "../agent/agent-definition.store.js";
import { OAuthIntegrationStore } from "../oauth/integration-store.js";
import { OAuthFlowService } from "../oauth/flow-service.js";
import { create_embed_service_from_provider, create_multimodal_embed_service_from_provider } from "../services/embed.service.js";
import type { ImageEmbedFn } from "../services/embed.service.js";
import { create_vector_store_service } from "../services/vector-store.service.js";
import { WebhookStore } from "../services/webhook-store.service.js";
import { create_query_db_service } from "../services/query-db.service.js";
import { ChunkQueue } from "../chunker/queue.js";

export interface RuntimeDataDeps {
  ctx: UserWorkspace;
  app_config: AppConfig;
  shared_vault: SecretVaultService;
  logger: ReturnType<typeof create_logger>;
}

export interface RuntimeDataResult {
  /** @deprecated ctx.user_runtime 사용 권장. 하위 번들 호환용. */
  data_dir: string;
  sessions_dir: string;
  bus: MessageBusRuntime;
  decisions: DecisionService;
  events: WorkflowEventService;
  provider_store: AgentProviderStore;
  agent_definition_store: AgentDefinitionStore;
  oauth_store: OAuthIntegrationStore;
  oauth_flow: OAuthFlowService;
  embed_service: EmbedServiceFn | undefined;
  embed_worker_config: EmbedWorkerConfig | undefined;
  image_embed_service: ImageEmbedFn | undefined;
  vector_store_service: ReturnType<typeof create_vector_store_service> | undefined;
  webhook_store: WebhookStore;
  query_db_service: ReturnType<typeof create_query_db_service> | undefined;
  chunk_queue: ChunkQueue | undefined;
}

export async function create_runtime_data(deps: RuntimeDataDeps): Promise<RuntimeDataResult> {
  const { ctx, app_config, shared_vault } = deps;

  // ── 글로벌 스코프 (admin_runtime): config, security, providers, definitions ──
  const provider_store = new AgentProviderStore(
    join(ctx.admin_runtime, "agent-providers", "providers.db"),
    shared_vault,
  );
  const agent_definition_store = new AgentDefinitionStore(
    join(ctx.admin_runtime, "agent-definitions", "definitions.db"),
  );

  // ── 팀 스코프 (team_runtime): oauth, datasources ──
  const oauth_store = new OAuthIntegrationStore(
    join(ctx.team_runtime, "oauth", "integrations.db"),
    shared_vault,
  );
  const oauth_flow = new OAuthFlowService(oauth_store);
  oauth_flow.load_custom_presets();

  const query_db_service = create_query_db_service(ctx.team_runtime);

  // ── 유저 스코프 (user_runtime): sessions, decisions, events, vector store ──
  const decisions_dir = join(ctx.user_runtime, "decisions");
  const events_dir = join(ctx.user_runtime, "events");
  const sessions_dir = join(ctx.user_runtime, "sessions");

  const decisions = new DecisionService(ctx.user_content, decisions_dir);
  const events = new WorkflowEventService(ctx.user_content, events_dir, null, app_config.taskLoopMaxTurns);
  const vector_store_service = create_vector_store_service(ctx.user_runtime);

  // ── 글로벌 인프라 (메시지 버스) ──
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

  // ── embed 서비스: 등록된 embedding 프로바이더에서 생성 ──
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

  // 워커 스레드용 임베딩 config
  const SKIP_AUTH_EMBED = new Set(["ollama", "orchestrator_llm", "container_cli"]);
  const embed_worker_config: EmbedWorkerConfig | undefined = embed_provider && embed_instance_id
    ? {
      api_base: provider_store.resolve_api_base(embed_instance_id) || "https://openrouter.ai/api/v1",
      api_key: SKIP_AUTH_EMBED.has(embed_provider.provider_type)
        ? null
        : await provider_store.resolve_token(embed_instance_id),
      model: embed_model_override
        || (typeof embed_provider.settings.model === "string" ? embed_provider.settings.model : "openai/text-embedding-3-small"),
      dims: 256,
    }
    : undefined;

  // 이미지(멀티모달) embed 서비스
  const image_instance_id = app_config.embedding.imageInstanceId || undefined;
  const image_provider = image_instance_id ? provider_store.get(image_instance_id) : null;
  const image_embed_service: ImageEmbedFn | undefined = image_provider
    ? create_multimodal_embed_service_from_provider({
      provider_type: image_provider.provider_type,
      model: app_config.embedding.imageModel || (typeof image_provider.settings.model === "string" ? image_provider.settings.model : undefined),
      api_base: provider_store.resolve_api_base(image_instance_id!),
      get_api_key: () => provider_store.resolve_token(image_instance_id!),
    })
    : undefined;

  const webhook_store = new WebhookStore();

  // ── Chunk queue: Redis가 있을 때만 비동기 청킹 큐 활성화 ──
  let chunk_queue: ChunkQueue | undefined;
  if (app_config.bus.backend === "redis" && app_config.bus.redis.url) {
    try {
      chunk_queue = new ChunkQueue(app_config.bus.redis.url);
      await chunk_queue.connect();
      deps.logger.info("chunk queue connected (async chunking enabled)");
    } catch (err) {
      deps.logger.warn("chunk queue connection failed, falling back to worker_threads", {
        error: String(err),
      });
      chunk_queue = undefined;
    }
  }

  return {
    data_dir: ctx.user_runtime,
    sessions_dir, bus, decisions, events,
    provider_store, agent_definition_store, oauth_store, oauth_flow,
    embed_service, embed_worker_config, image_embed_service, vector_store_service, webhook_store, query_db_service,
    chunk_queue,
  };
}
