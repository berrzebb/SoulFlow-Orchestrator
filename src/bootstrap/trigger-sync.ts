/** Trigger sync: 워크플로우 trigger_nodes → 런타임 서비스 동기화 (cron/webhook/channel_message/kanban). */

import { error_message, now_iso, make_run_id } from "../utils/common.js";
import type { AppConfig } from "../config/schema.js";
import type { MessageBusRuntime } from "../bus/types.js";
import type { OrchestrationService } from "../orchestration/service.js";
import type { CronService } from "../cron/index.js";
import type { KanbanStoreLike } from "../services/kanban-store.js";
import type { WebhookStore } from "../services/webhook-store.service.js";
import type { create_logger } from "../logger.js";
import { sync_all_workflow_triggers } from "../cron/workflow-trigger-sync.js";

export interface TriggerSyncDeps {
  workspace: string;
  user_dir: string;
  app_config: AppConfig;
  bus: MessageBusRuntime;
  orchestration: OrchestrationService;
  cron: CronService;
  webhook_store: WebhookStore;
  kanban_store: KanbanStoreLike;
  primary_provider: string;
  default_chat_id: string;
  logger: ReturnType<typeof create_logger>;
}

export async function run_trigger_sync(deps: TriggerSyncDeps): Promise<void> {
  const {
    workspace, user_dir, app_config, bus, orchestration, cron,
    webhook_store, kanban_store,
    primary_provider, default_chat_id, logger,
  } = deps;

  const trigger_sync_deps = {
    cron,
    bus,
    webhook_store,
    kanban_store,
    execute: async (slug: string, channel: string, chat_id: string, trigger_data?: Record<string, unknown>) => {
      try {
        const { load_workflow_template, substitute_variables } = await import("../orchestration/workflow-loader.js");
        const template = load_workflow_template(user_dir, slug);
        if (!template) return { ok: false, error: `template not found: ${slug}` };
        const substituted = substitute_variables(template, { ...template.variables, channel });
        const run_id = make_run_id("wf-trigger");
        const content = trigger_data
          ? `${substituted.objective || substituted.title}\n\n[trigger data]\n${JSON.stringify(trigger_data, null, 2)}`
          : substituted.objective || substituted.title;
        const result = await orchestration.execute({
          message: { id: run_id, provider: channel, channel, sender_id: "trigger", chat_id, content, at: now_iso() },
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
    default_channel: primary_provider,
    default_chat_id: default_chat_id || "",
  };

  try {
    const { load_workflow_templates } = await import("../orchestration/workflow-loader.js");
    const templates = load_workflow_templates(user_dir);
    const sync_result = await sync_all_workflow_triggers(templates, trigger_sync_deps);
    const total = sync_result.cron.added + sync_result.webhook.registered + sync_result.channel_message.registered + sync_result.kanban_event.registered;
    if (total > 0) logger.info(`workflow triggers synced: cron=${sync_result.cron.added} webhook=${sync_result.webhook.registered} channel=${sync_result.channel_message.registered} kanban=${sync_result.kanban_event.registered}`);
  } catch (e) {
    logger.warn(`workflow trigger sync failed: ${error_message(e)}`);
  }
}
