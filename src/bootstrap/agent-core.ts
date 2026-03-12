/** Agent core bundle: AgentDomain, 에이전트 런타임, 페르소나, 스토어, 메모리 압축. */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { now_iso } from "../utils/common.js";
import type { AppConfig } from "../config/schema.js";
import type { ProviderCapabilities } from "../providers/executor.js";
import type { MessageBusRuntime } from "../bus/types.js";
import type { TaskState } from "../contracts.js";
import { AgentDomain } from "../agent/index.js";
import { create_agent_inspector } from "../agent/inspector.service.js";
import { create_agent_runtime } from "../agent/runtime.service.js";
import { KanbanStore } from "../services/kanban-store.js";
import { KanbanTool } from "../agent/tools/kanban.js";
import { KanbanAutomationRuntime } from "../services/kanban-automation-runtime.js";
import { PhaseWorkflowStore } from "../agent/phase-workflow-store.js";
import { ToolIndex } from "../orchestration/tool-index.js";
import { ReferenceStore } from "../services/reference-store.js";
import { SkillRefStore } from "../services/skill-ref-store.js";
import { SessionStore } from "../session/index.js";
import { MemoryConsolidationService } from "../agent/memory-consolidation.service.js";
import { PersonaMessageRenderer, TonePreferenceStore } from "../channels/persona-message-renderer.js";
import { extract_persona_name } from "../orchestration/prompts.js";
import { detect_hitl_type } from "../orchestration/service.js";
import type { MutableBroadcaster } from "../dashboard/broadcaster.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { WorkflowEventService } from "../events/index.js";
import type { OAuthIntegrationStore } from "../oauth/integration-store.js";
import type { OAuthFlowService } from "../oauth/flow-service.js";
import { create_logger } from "../logger.js";
import type { ImageEmbedFn } from "../services/embed.service.js";

export type EmbedServiceFn = (
  texts: string[],
  opts: { model?: string; dimensions?: number },
) => Promise<{ embeddings: number[][]; token_usage?: number }>;

export interface AgentCoreDeps {
  workspace: string;
  /** 사용자 콘텐츠 루트 (workflows, skills, templates). WORKSPACE_USER_DIR 미설정 시 workspace와 동일. */
  user_dir: string;
  data_dir: string;
  sessions_dir: string;
  app_root: string;
  app_config: AppConfig;
  providers: ProviderRegistry;
  bus: MessageBusRuntime;
  events: WorkflowEventService;
  agent_backend_registry: AgentBackendRegistry;
  provider_caps: ProviderCapabilities;
  embed_service: EmbedServiceFn | undefined;
  embed_worker_config: import("../agent/memory.types.js").EmbedWorkerConfig | undefined;
  image_embed_service: ImageEmbedFn | undefined;
  oauth_store: OAuthIntegrationStore;
  oauth_flow: OAuthFlowService;
  broadcaster: MutableBroadcaster;
  logger: ReturnType<typeof create_logger>;
}

export interface AgentCoreResult {
  agent: AgentDomain;
  agent_runtime: ReturnType<typeof create_agent_runtime>;
  agent_inspector: ReturnType<typeof create_agent_inspector>;
  persona_renderer: PersonaMessageRenderer;
  tone_pref_store: TonePreferenceStore;
  phase_workflow_store: PhaseWorkflowStore;
  kanban_store: KanbanStore;
  kanban_tool: KanbanTool;
  kanban_automation: KanbanAutomationRuntime;
  tool_index: ToolIndex;
  reference_store: ReferenceStore;
  skill_ref_store: SkillRefStore;
  sessions: SessionStore;
  memory_consolidation: MemoryConsolidationService;
}

/** last_output이 비어있을 때 task 상태에서 유용한 컨텍스트를 조합. */
function build_hitl_fallback_body(task: TaskState): string {
  const parts: string[] = [];
  const objective = String(task.objective || "").trim();
  if (objective) parts.push(`**작업:** ${objective.slice(0, 300)}`);
  const reason = String(task.exitReason || "").trim();
  if (reason && reason !== "waiting_user_input") parts.push(`**상태:** ${reason}`);
  return parts.join("\n") || "";
}

export async function create_agent_core(deps: AgentCoreDeps): Promise<AgentCoreResult> {
  const {
    workspace, user_dir, data_dir, sessions_dir, app_root, app_config,
    providers, bus, events, agent_backend_registry, provider_caps,
    embed_service, embed_worker_config, image_embed_service, oauth_store, broadcaster, logger,
  } = deps;

  const tone_pref_store = new TonePreferenceStore(join(data_dir, "tone-preferences.json"));
  const persona_renderer = new PersonaMessageRenderer({
    get_persona_name: () => {
      try {
        for (const p of [join(user_dir, "templates", "SOUL.md"), join(user_dir, "SOUL.md")]) {
          if (existsSync(p)) { const r = readFileSync(p, "utf-8").trim(); if (r) return extract_persona_name(r); }
        }
      } catch { /* no soul */ }
      return "assistant";
    },
    get_heart: () => {
      try {
        for (const p of [join(user_dir, "templates", "HEART.md"), join(user_dir, "HEART.md")]) {
          if (existsSync(p)) { const r = readFileSync(p, "utf-8").trim(); if (r) return r; }
        }
      } catch { /* no heart */ }
      return "";
    },
    get_tone_preference: (chat_key) => tone_pref_store.get(chat_key),
  });

  const agent = new AgentDomain(user_dir, {
    providers, bus, data_dir, events, agent_backends: agent_backend_registry,
    secret_vault: providers.get_secret_vault(), logger: logger.child("agent"),
    provider_caps, app_root,
    on_task_change: (task) => {
      broadcaster.broadcast_task_event("status_change", task);
      if (task.status === "waiting_user_input" || task.status === "max_turns_reached") {
        const channel = task.channel || String(task.memory?.channel || "");
        const chat_id = task.chatId || String(task.memory?.chat_id || "");
        if (!channel || !chat_id) return;
        const raw_prompt = String(task.memory?.last_output || "").trim();
        if (raw_prompt.includes("ask_user_sent:")) return;
        const prompt = raw_prompt || build_hitl_fallback_body(task);
        const hitl_type = task.status === "max_turns_reached" ? "error" as const : detect_hitl_type(prompt);
        const body = task.status === "max_turns_reached"
          ? prompt || `최대 실행 횟수(${task.maxTurns}턴)에 도달하여 작업이 일시 중지되었습니다.`
          : prompt;
        const content = persona_renderer.render({ kind: "hitl_prompt", hitl_type: hitl_type, body });
        const reply_to = String(task.memory?.__trigger_message_id || "").trim() || undefined;
        bus.publish_outbound({
          id: `hitl-${task.taskId}-${Date.now()}`,
          provider: channel, channel, sender_id: "agent",
          chat_id, content, reply_to, at: now_iso(),
          metadata: { kind: "task_hitl_notify", task_id: task.taskId, status: task.status },
        }).catch(() => { /* bus 발행 실패가 태스크 실행을 차단하면 안 됨 */ });
      }
    },
  });

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

  const phase_workflow_store = new PhaseWorkflowStore(join(data_dir, "workflows"));
  const kanban_store = new KanbanStore(data_dir);
  const kanban_tool = new KanbanTool(kanban_store);
  const kanban_automation = new KanbanAutomationRuntime();
  const agent_inspector = create_agent_inspector(agent);
  const agent_runtime = create_agent_runtime(agent, { phase_workflow_store });

  const tool_index = new ToolIndex();
  if (embed_service) {
    agent.context.memory_store.set_embed?.(embed_service);
    tool_index.set_embed(embed_service);
  }
  if (embed_worker_config) {
    agent.context.memory_store.set_embed_worker_config?.(embed_worker_config);
  }
  agent.context.set_daily_injection(app_config.memory.dailyInjectionDays, app_config.memory.dailyInjectionMaxChars);
  agent.context.set_longterm_injection(app_config.memory.longtermInjectionMaxChars);

  const reference_store = new ReferenceStore(user_dir);
  if (embed_service) reference_store.set_embed(embed_service);
  if (image_embed_service) reference_store.set_image_embed(image_embed_service);
  agent.context.set_reference_store(reference_store);

  // 스킬 레퍼런스 RAG: src/skills, user_dir/skills 하위 references/*.md 인덱싱
  const skill_ref_store = new SkillRefStore(
    [join(app_root, "src", "skills"), join(user_dir, "skills")],
    join(data_dir, "references"),
  );
  if (embed_service) skill_ref_store.set_embed(embed_service);
  agent.context.set_skill_ref_store(skill_ref_store);

  const sessions = new SessionStore(workspace, sessions_dir);

  events.bind_task_store(agent.task_store);

  const memory_consolidation = new MemoryConsolidationService({
    memory_store: agent.context.memory_store,
    sessions,
    session_max_age_ms: app_config.channel.sessionHistoryMaxAgeMs,
    config: {
      enabled: app_config.memory.consolidation.enabled,
      trigger: app_config.memory.consolidation.trigger,
      idle_after_ms: app_config.memory.consolidation.idleAfterMs,
      interval_ms: app_config.memory.consolidation.intervalMs,
      window_days: app_config.memory.consolidation.windowDays,
      archive_used: app_config.memory.consolidation.archiveUsed,
    },
    logger,
  });

  return {
    agent, agent_runtime, agent_inspector,
    persona_renderer, tone_pref_store,
    phase_workflow_store, kanban_store, kanban_tool, kanban_automation,
    tool_index, reference_store, skill_ref_store, sessions, memory_consolidation,
  };
}
