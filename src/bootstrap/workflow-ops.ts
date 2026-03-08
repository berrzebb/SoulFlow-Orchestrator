/** Workflow-ops bundle: WorkflowOps 조립 + HITL bridge + kanban automation 초기화. */

import type { AgentDomain } from "../agent/index.js";
import type { create_agent_runtime } from "../agent/runtime.service.js";
import type { KanbanTool } from "../agent/tools/kanban.js";
import type { MessageBusRuntime } from "../bus/types.js";
import type { ChannelManager } from "../channels/manager.js";
import type { DecisionService } from "../decision/index.js";
import type { HitlPendingStore } from "../orchestration/hitl-pending-store.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { AgentProviderStore } from "../agent/provider-store.js";
import type { PhaseWorkflowStore } from "../agent/phase-workflow-store.js";
import type { KanbanStore } from "../services/kanban-store.js";
import type { KanbanAutomationRuntime } from "../services/kanban-automation-runtime.js";
import type { PersonaMessageRendererLike } from "../channels/persona-message-renderer.js";
import type { WebhookStore } from "../services/webhook-store.service.js";
import type { create_vector_store_service } from "../services/vector-store.service.js";
import type { create_query_db_service } from "../services/query-db.service.js";
import type { MutableBroadcaster } from "../dashboard/broadcaster.js";
import type { create_logger } from "../logger.js";
import type { EmbedServiceFn } from "./agent-core.js";
import type { ToolIndex } from "../orchestration/tool-index.js";
import type { CronService } from "../cron/index.js";
import { create_workflow_ops } from "../dashboard/ops-factory.js";
import { make_wait_kanban_event } from "./orchestration.js";

export interface WorkflowOpsBundleDeps {
  workspace: string;
  agent: AgentDomain;
  agent_runtime: ReturnType<typeof create_agent_runtime>;
  bus: MessageBusRuntime;
  providers: ProviderRegistry;
  provider_store: AgentProviderStore;
  decisions: DecisionService;
  phase_workflow_store: PhaseWorkflowStore;
  kanban_store: KanbanStore;
  kanban_tool: KanbanTool;
  kanban_automation: KanbanAutomationRuntime;
  hitl_pending_store: HitlPendingStore;
  persona_renderer: PersonaMessageRendererLike;
  broadcaster: MutableBroadcaster;
  channel_manager: ChannelManager;
  embed_service: EmbedServiceFn | undefined;
  vector_store_service: ReturnType<typeof create_vector_store_service> | undefined;
  webhook_store: WebhookStore;
  query_db_service: ReturnType<typeof create_query_db_service> | undefined;
  oauth_fetch_service: (
    service_id: string,
    opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown },
  ) => Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  create_task_fn: ReturnType<typeof import("../services/create-task.service.js").create_task_service>;
  logger: ReturnType<typeof create_logger>;
  tool_index?: ToolIndex | null;
  cron?: CronService;
  /** 템플릿 저장/삭제 후 트리거 재동기화 콜백. */
  on_template_changed?: () => Promise<void>;
}

export interface WorkflowOpsBundleResult {
  workflow_ops: ReturnType<typeof create_workflow_ops>;
}

export async function create_workflow_ops_bundle(deps: WorkflowOpsBundleDeps): Promise<WorkflowOpsBundleResult> {
  const {
    workspace, agent, bus, providers, provider_store, decisions,
    phase_workflow_store, kanban_store, kanban_tool, kanban_automation,
    hitl_pending_store, persona_renderer, broadcaster, channel_manager,
    embed_service, vector_store_service, webhook_store, query_db_service,
    oauth_fetch_service, create_task_fn, logger, tool_index, cron, on_template_changed,
  } = deps;

  const workflow_ops = create_workflow_ops({
    hitl_pending_store, renderer: persona_renderer,
    store: phase_workflow_store, subagents: agent.subagents, workspace, logger, bus,
    skills_loader: agent.context.skills_loader, tool_index, cron, on_template_changed,
    kanban_store,
    on_workflow_event: (e) => broadcaster.broadcast_workflow_event(e),
    invoke_tool: (tool_id, params, ctx) => agent.tools.execute(tool_id, params, ctx ? { channel: ctx.channel, chat_id: ctx.chat_id, sender_id: ctx.sender_id, task_id: ctx.workflow_id } : undefined),
    providers,
    get_tool_summaries: () => agent.tools.get_all().map((t) => ({
      name: t.name, description: t.description, category: t.category,
    })),
    get_provider_summaries: () => {
      try {
        return provider_store.list().filter((p) => p.enabled).map((p) => ({
          backend: p.instance_id, label: p.label, provider_type: p.provider_type,
          models: [String(p.settings?.model || "")].filter(Boolean),
        }));
      } catch { return []; }
    },
    decision_service: decisions,
    promise_service: agent.context.promise_service,
    oauth_fetch: oauth_fetch_service,
    embed: embed_service,
    vector_store: vector_store_service,
    get_webhook_data: (path) => webhook_store.get(path),
    wait_kanban_event: make_wait_kanban_event(kanban_store),
    create_task: create_task_fn,
    query_db: query_db_service,
    on_kanban_trigger_waiting: (wf_id) => kanban_automation.notify_workflow_waiting(wf_id),
  });

  // HITL bridge: 공유 store 기반 단일 bridge
  channel_manager.set_workflow_hitl({
    async try_resolve(chat_id, content) {
      return hitl_pending_store.try_resolve(chat_id, content);
    },
  });

  // kanban automation: trigger watcher + rule executor 초기화
  await kanban_automation.init_trigger_watcher({
    kanban_store,
    workflow_store: phase_workflow_store,
    resumer: workflow_ops,
  });
  await kanban_automation.init_rule_executor(kanban_store, {
    async run_workflow(params) {
      const result = await workflow_ops.create({
        template_name: params.template,
        title: params.title,
        objective: params.objective,
        channel: params.channel || "dashboard",
        chat_id: params.chat_id || "kanban-rule",
      });
      return { ok: result.ok, workflow_id: result.workflow_id, error: result.error };
    },
    async create_task(params) {
      const result = await create_task_fn({
        title: params.prompt,
        objective: params.prompt,
        channel: params.channel,
        chat_id: params.chat_id,
      });
      return { ok: !!result.task_id, task_id: result.task_id, error: result.error };
    },
  });
  const rule_executor = kanban_automation.get_rule_executor();
  if (rule_executor) kanban_tool.set_rule_executor(rule_executor);

  return { workflow_ops };
}
