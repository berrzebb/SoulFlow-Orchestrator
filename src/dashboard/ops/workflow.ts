/** Dashboard workflow ops. */

import type { PhaseWorkflowStoreLike } from "../../agent/phase-workflow-store.js";
import type { SubagentRegistry } from "../../agent/subagents.js";
import type { SkillsLoader } from "../../agent/skills.service.js";
import type { DashboardWorkflowOps } from "../service.js";
import type { PhaseLoopRunOptions, ChannelSendRequest, ChannelResponse, WorkflowDefinition } from "../../agent/phase-loop.types.js";
import {
  load_workflow_templates, load_workflow_template,
  substitute_variables, save_workflow_template,
  delete_workflow_template, parse_workflow_yaml, serialize_to_yaml,
} from "../../orchestration/workflow-loader.js";
import { run_phase_loop } from "../../agent/phase-loop-runner.js";
import { build_node_catalog } from "../../agent/tools/workflow-catalog.js";
import { short_id } from "../../utils/common.js";
import type { Logger } from "../../logger.js";

/** provider_type → ProviderId 매핑 (suggest 기능 공용). */
const PROVIDER_TYPE_TO_ID: Record<string, import("../../providers/types.js").ProviderId> = {
  claude_cli: "claude_code", claude_sdk: "claude_code",
  codex_cli: "chatgpt", codex_appserver: "chatgpt",
  gemini_cli: "gemini",
  openrouter: "openrouter",
  ollama: "orchestrator_llm", openai_compatible: "orchestrator_llm", container_cli: "orchestrator_llm",
};
const VALID_PROVIDER_IDS = new Set<string>(["chatgpt", "claude_code", "openrouter", "orchestrator_llm", "gemini"]);

const WORKFLOW_SCHEMA_REFERENCE = `## Full Workflow Definition Schema
\`\`\`
WorkflowDefinition {
  title: string,
  objective?: string,
  variables?: { [key]: string },       // runtime substitution: {{key}}

  // ── Node-based (preferred) ──
  nodes?: WorkflowNodeDefinition[],     // unified array (phase + orche nodes)

  // ── Legacy arrays (used when nodes[] absent) ──
  phases?: PhaseDefinition[],
  orche_nodes?: OrcheNodeRecord[],

  field_mappings?: FieldMapping[],
  tool_nodes?: ToolNodeDefinition[],
  skill_nodes?: SkillNodeDefinition[],
  trigger_nodes?: TriggerNodeRecord[],
  end_nodes?: EndNodeRecord[],
  hitl_channel?: { channel_type: string, chat_id?: string },
}
\`\`\`

### PhaseDefinition (agent execution unit)
\`\`\`
{
  phase_id: string,
  title: string,
  mode?: "parallel" | "interactive" | "sequential_loop",  // default: parallel
  agents: [{
    agent_id: string,
    role: string,
    label: string,
    backend: string,           // provider instance_id from backends list
    model?: string,
    system_prompt: string,
    tools?: string[],          // tool_node ids
    max_turns?: number,
    filesystem_isolation?: "none" | "directory" | "worktree",
  }],
  critic?: {
    backend: string,
    model?: string,
    system_prompt: string,
    gate?: boolean,
    on_rejection?: "retry_all" | "retry_targeted" | "escalate" | "goto",
    goto_phase?: string,
    max_retries?: number,
  },
  failure_policy?: "fail_fast" | "best_effort" | "quorum",
  depends_on?: string[],       // phase_ids (fork-join)
  tools?: string[],            // tool_node ids bound to all agents
  skills?: string[],           // skill names
  loop_until?: string,         // sequential_loop exit condition
  max_loop_iterations?: number,
}
\`\`\`

### FieldMapping (connect node outputs to inputs)
\`\`\`
{ from_node: string, from_field: string, to_node: string, to_field: string }
\`\`\`
Example: { from_node: "fetch-1", from_field: "body.items[0].id", to_node: "set-2", to_field: "value" }

### TriggerNodeRecord
\`\`\`
{
  id: string,
  trigger_type: "cron" | "webhook" | "manual" | "channel_message" | "kanban",
  schedule?: string,           // cron expression (for cron)
  timezone?: string,
  webhook_path?: string,       // (for webhook)
  channel_type?: string,       // (for channel_message)
  chat_id?: string,
  board_id?: string,           // (for kanban)
  actions?: string[],          // (for kanban) e.g. ["created", "moved"]
  column_id?: string,          // (for kanban) optional column filter
}
\`\`\`

### EndNodeRecord
\`\`\`
{
  node_id: string,
  depends_on?: string[],       // source node_ids
  output_targets: string[],    // "channel" | "media" | "webhook" | "http"
  target_config?: {
    [target]: {                // target-specific configuration
      message?: string,        // for channel
      url?: string,            // for webhook/http
      status?: number,         // for http
      data?: any,              // for media
      mime_type?: string,      // for media
      headers?: object,        // for webhook/http
      body?: any,              // for webhook/http/media
    }
  }
}
\`\`\`

### ToolNodeDefinition
\`\`\`
{ id: string, tool_id: string, description: string, attach_to?: string[] }
\`\`\`

### SkillNodeDefinition
\`\`\`
{ id: string, skill_name: string, description: string, attach_to?: string[] }
\`\`\``;

export function create_workflow_ops(deps: {
  store: PhaseWorkflowStoreLike;
  subagents: SubagentRegistry;
  workspace: string;
  logger: Logger;
  skills_loader?: SkillsLoader;
  on_workflow_event?: (event: import("../../agent/phase-loop.types.js").PhaseLoopEvent) => void;
  bus?: import("../../bus/types.js").MessageBusLike;
  cron?: import("../../cron/service.js").CronService;
  invoke_tool?: (tool_id: string, params: Record<string, unknown>, context?: { workflow_id?: string; channel?: string; chat_id?: string; sender_id?: string }) => Promise<string>;
  providers?: import("../../providers/service.js").ProviderRegistry | null;
  get_tool_summaries?: () => Array<{ name: string; description: string; category: string }>;
  get_provider_summaries?: () => Array<{ backend: string; label: string; provider_type: string; models: string[] }>;
  tool_index?: import("../../orchestration/tool-index.js").ToolIndex | null;
  decision_service?: import("../../decision/service.js").DecisionService | null;
  promise_service?: import("../../decision/promise.service.js").PromiseService | null;
  embed?: (texts: string[], opts: { model?: string; dimensions?: number }) => Promise<{ embeddings: number[][]; token_usage?: number }>;
  vector_store?: (op: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  oauth_fetch?: (service_id: string, opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown }) => Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  get_webhook_data?: (path: string) => Promise<{ method: string; headers: Record<string, string>; body: unknown; query: Record<string, string> } | null>;
  wait_kanban_event?: (board_id: string, filter: { actions?: string[]; column_id?: string }) => Promise<{ card_id: string; board_id: string; action: string; actor: string; detail: Record<string, unknown>; created_at: string } | null>;
  create_task?: (opts: { title: string; objective: string; channel?: string; chat_id?: string; max_turns?: number; initial_memory?: Record<string, unknown> }) => Promise<{ task_id: string; status: string; result?: unknown; error?: string }>;
  query_db?: (datasource: string, query: string, params?: Record<string, unknown>) => Promise<{ rows: unknown[]; affected_rows: number }>;
  on_kanban_trigger_waiting?: (workflow_id: string) => void;
  /** 워크플로우 시작 시 칸반 보드 자동 생성에 사용. */
  kanban_store?: import("../../services/kanban-store.js").KanbanStoreLike;
  hitl_pending_store: import("../../orchestration/hitl-pending-store.js").HitlPendingStore;
  renderer?: import("../../channels/persona-message-renderer.js").PersonaMessageRendererLike | null;
  /** 템플릿 저장/삭제 후 트리거 재동기화 콜백. */
  on_template_changed?: () => Promise<void>;
}): DashboardWorkflowOps & { hitl_bridge: import("../../channels/manager.js").WorkflowHitlBridge; resume_orphaned: () => Promise<void> } {
  const { store, subagents, workspace, logger, skills_loader, on_workflow_event, bus, cron } = deps;
  let suggest_node_catalog_cache: string | null = null;

  /** LLM 응답 텍스트에서 JSON 객체 추출. 마크다운 펜스·앞뒤 텍스트 무시. */
  function extract_json_from_response(text: string): Record<string, unknown> | null {
    // ```json ... ``` 또는 ``` ... ``` 블록 우선
    const fenced = text.match(/```(?:json|yaml)?\s*\n?([\s\S]*?)```/);
    if (fenced) {
      try { return JSON.parse(fenced[1].trim()) as Record<string, unknown>; } catch { /* continue */ }
    }
    // 첫 { ~ 마지막 } 구간
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try { return JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>; } catch { /* continue */ }
    }
    return null;
  }

  const pending_responses = deps.hitl_pending_store;

  /** run_phase_loop 두 번째 인자 — create/resume/resume_orphaned 공통. */
  const runner_deps = {
    subagents, store, logger,
    load_template: (name: string) => load_workflow_template(workspace, name),
    providers: deps.providers,
    decision_service: deps.decision_service,
    promise_service: deps.promise_service,
    embed: deps.embed,
    vector_store: deps.vector_store,
    oauth_fetch: deps.oauth_fetch,
    get_webhook_data: deps.get_webhook_data,
    wait_kanban_event: deps.wait_kanban_event,
    create_task: deps.create_task,
    query_db: deps.query_db,
    on_kanban_trigger_waiting: deps.on_kanban_trigger_waiting,
    kanban_store: deps.kanban_store,
    on_event: on_workflow_event,
  };

  function build_ask_user(workflow_id: string, target_channel: string, target_chat_id: string) {
    return async (question: string): Promise<string> => {
      // auto_resume 설정 시 즉시 빈 응답으로 재개
      const current = await store.get(workflow_id);
      if (current?.auto_resume) {
        logger.info("workflow_auto_resume", { workflow_id });
        return "";
      }

      on_workflow_event?.({ type: "user_input_requested", workflow_id, phase_id: "", question });

      if (bus && target_channel !== "dashboard" && target_channel !== "web") {
        const formatted = deps.renderer
          ? deps.renderer.render({ kind: "workflow_ask", question })
          : [
              "\uD83D\uDCAC **\uC9C8\uBB38**", "", question, "",
              "\uC9C8\uBB38\uC5D0 \uB300\uD55C \uB2F5\uBCC0\uC744 \uB2F5\uC7A5\uD574\uC8FC\uC138\uC694.", "",
              "_\uC774 \uBA54\uC2DC\uC9C0\uC5D0 \uB2F5\uC7A5\uD558\uBA74 \uC6CC\uD06C\uD50C\uB85C\uC6B0\uAC00 \uC790\uB3D9\uC73C\uB85C \uC7AC\uAC1C\uB429\uB2C8\uB2E4._",
            ].join("\n");
        bus.publish_outbound({
          id: `wf-ask-${short_id(8)}`, provider: target_channel, channel: target_channel,
          sender_id: "system", chat_id: target_chat_id, content: formatted,
          at: new Date().toISOString(),
          metadata: { workflow_id, type: "workflow_ask_user" },
        }).catch((e) => logger.error("workflow_ask_user_send_failed", { workflow_id, error: String(e) }));
      }

      return new Promise<string>((resolve) => {
        pending_responses.set(workflow_id, { resolve, chat_id: target_chat_id });
      });
    };
  }

  function build_send_message(workflow_id: string, origin_channel: string, origin_chat_id: string) {
    return async (req: ChannelSendRequest): Promise<{ ok: boolean; message_id?: string }> => {
      if (!bus) return { ok: false };
      const channel = req.target === "origin" ? origin_channel : (req.channel || origin_channel);
      const chat_id = req.target === "origin" ? origin_chat_id : (req.chat_id || origin_chat_id);
      const msg_id = `wf-msg-${short_id(8)}`;
      try {
        await bus.publish_outbound({
          id: msg_id, provider: channel, channel,
          sender_id: "system", chat_id, content: req.content,
          at: new Date().toISOString(),
          metadata: { workflow_id, type: "workflow_notification", ...(req.structured ? { structured: req.structured } : {}) },
        });
        return { ok: true, message_id: msg_id };
      } catch (e) {
        logger.error("workflow_send_message_failed", { workflow_id, error: String(e) });
        return { ok: false };
      }
    };
  }

  function build_ask_channel(workflow_id: string, origin_channel: string, origin_chat_id: string) {
    return async (req: ChannelSendRequest, timeout_ms: number): Promise<ChannelResponse> => {
      const channel = req.target === "origin" ? origin_channel : (req.channel || origin_channel);
      const chat_id = req.target === "origin" ? origin_chat_id : (req.chat_id || origin_chat_id);

      // auto_approve 설정 시 approval 요청을 즉시 승인
      if (req.structured?.type === "approval") {
        const current = await store.get(workflow_id);
        if (current?.auto_approve) {
          logger.info("workflow_auto_approve", { workflow_id });
          return {
            response: "approve", approved: true,
            responded_by: { channel: "system", chat_id: "auto-approve" },
            responded_at: new Date().toISOString(), timed_out: false,
          };
        }
      }

      if (bus && channel !== "dashboard" && channel !== "web") {
        bus.publish_outbound({
          id: `wf-ask-${short_id(8)}`, provider: channel, channel,
          sender_id: "system", chat_id, content: req.content,
          at: new Date().toISOString(),
          metadata: { workflow_id, type: "workflow_ask_channel", ...(req.structured ? { structured: req.structured } : {}) },
        }).catch((e) => logger.error("workflow_ask_channel_send_failed", { workflow_id, error: String(e) }));
      }

      return new Promise<ChannelResponse>((resolve) => {
        const timer = setTimeout(() => {
          pending_responses.delete(workflow_id);
          resolve({
            response: "", responded_at: new Date().toISOString(), timed_out: true,
          });
        }, timeout_ms);

        pending_responses.set(workflow_id, {
          resolve: (content: string) => {
            clearTimeout(timer);
            resolve({
              response: content,
              responded_by: { channel, chat_id: chat_id },
              responded_at: new Date().toISOString(),
              timed_out: false,
            });
          },
          chat_id,
        });
      });
    };
  }

  const hitl_bridge: import("../../channels/manager.js").WorkflowHitlBridge = {
    async try_resolve(chat_id: string, content: string): Promise<boolean> {
      return pending_responses.try_resolve(chat_id, content);
    },
  };

  return {
    hitl_bridge,
    list: () => store.list(),
    get: (id) => store.get(id),

    async create(input) {
      const title = String(input.title || "Untitled Workflow");
      const objective = String(input.objective || "");
      const channel = String(input.channel || "dashboard");
      const chat_id = String(input.chat_id || "web");

      let phases: PhaseLoopRunOptions["phases"];
      let nodes: PhaseLoopRunOptions["nodes"];
      let field_mappings: PhaseLoopRunOptions["field_mappings"];
      if (input.template_name) {
        const template = load_workflow_templates(workspace)
          .find((t) => t.title.toLowerCase().includes(String(input.template_name).toLowerCase()));
        if (!template) return { ok: false, error: "template_not_found" };
        const user_vars = input.variables && typeof input.variables === "object"
          ? Object.fromEntries(Object.entries(input.variables as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
          : {};
        const substituted = substitute_variables(template, { ...(template.variables || {}), ...user_vars, objective, channel });
        phases = substituted.phases;
        nodes = substituted.nodes;
        field_mappings = substituted.field_mappings;
      } else if (Array.isArray(input.nodes)) {
        nodes = input.nodes as PhaseLoopRunOptions["nodes"];
        phases = Array.isArray(input.phases) ? input.phases as PhaseLoopRunOptions["phases"] : [];
        field_mappings = Array.isArray(input.field_mappings) ? input.field_mappings as PhaseLoopRunOptions["field_mappings"] : undefined;
      } else if (Array.isArray(input.phases)) {
        phases = input.phases as PhaseLoopRunOptions["phases"];
        field_mappings = Array.isArray(input.field_mappings) ? input.field_mappings as PhaseLoopRunOptions["field_mappings"] : undefined;
      } else {
        const fallback = load_workflow_template(workspace, "autonomous-dev-pipeline")
          || load_workflow_templates(workspace)[0];
        if (!fallback) return { ok: false, error: "no_default_template" };
        const substituted = substitute_variables(fallback, { ...(fallback.variables || {}), objective, channel });
        phases = substituted.phases;
        nodes = substituted.nodes;
        field_mappings = substituted.field_mappings;
      }

      if (Array.isArray(input.orche_nodes) && input.orche_nodes.length) {
        const orche_as_nodes = (input.orche_nodes as Array<Record<string, unknown>>).map((n) => ({
          ...n,
          node_id: String(n.node_id),
          node_type: String(n.node_type),
          title: String(n.title || n.node_id || ""),
          depends_on: Array.isArray(n.depends_on) ? n.depends_on.map(String) : undefined,
        }));
        nodes = [...(nodes || []), ...orche_as_nodes] as PhaseLoopRunOptions["nodes"];
      }

      const workflow_id = `wf-${short_id(12)}`;

      const ask_user = build_ask_user(workflow_id, channel, chat_id);

      const origin = { channel, chat_id, sender_id: String(input.sender_id || "") };

      void run_phase_loop({
        workflow_id, title, objective, channel, chat_id, phases, nodes, ask_user,
        send_message: build_send_message(workflow_id, channel, chat_id),
        ask_channel: build_ask_channel(workflow_id, channel, chat_id),
        invoke_tool: deps.invoke_tool,
        initial_memory: { origin },
        workspace,
        field_mappings,
      }, runner_deps).catch((err) => {
        logger.error("workflow_create_run_error", { workflow_id, error: String(err) });
      });

      return { ok: true, workflow_id };
    },

    async cancel(workflow_id) {
      const state = await store.get(workflow_id);
      if (!state) return false;
      state.status = "cancelled";
      await store.upsert(state);
      subagents.cancel_by_parent_id(`workflow:${workflow_id}`);
      return true;
    },

    get_messages: (wid, pid, aid) => store.get_messages(wid, pid, aid),

    async send_message(workflow_id, phase_id, agent_id, content) {
      if (!content.trim()) return { ok: false, error: "empty_content" };
      const state = await store.get(workflow_id);
      if (!state) return { ok: false, error: "workflow_not_found" };

      const phase = state.phases.find((p) => p.phase_id === phase_id);
      if (!phase) return { ok: false, error: "phase_not_found" };
      const agent = phase.agents.find((a) => a.agent_id === agent_id);
      if (!agent) return { ok: false, error: "agent_not_found" };

      const msg = { role: "user" as const, content, at: new Date().toISOString() };
      await store.insert_message(workflow_id, phase_id, agent_id, msg);

      const entry = pending_responses.get(workflow_id);
      if (entry) {
        pending_responses.delete(workflow_id);
        entry.resolve(content);
        return { ok: true };
      }

      if (agent.subagent_id) {
        try {
          const accepted = subagents.send_input(agent.subagent_id, content);
          if (!accepted) return { ok: false, error: "agent_not_accepting_input" };
          return { ok: true };
        } catch {
          return { ok: false, error: "agent_not_accepting_input" };
        }
      }

      return { ok: false, error: "agent_has_no_input_channel" };
    },

    list_templates: () => load_workflow_templates(workspace),

    get_template: (name) => load_workflow_template(workspace, name),

    save_template(name, definition) {
      const slug = save_workflow_template(workspace, name, definition);
      // trigger_nodes 또는 레거시 trigger 필드 중 하나라도 cron이 있으면 즉시 등록
      const cron_trigger = definition.trigger_nodes?.find((t) => t.trigger_type === "cron" && t.schedule)
        ?? (definition.trigger?.type === "cron" && definition.trigger.schedule ? definition.trigger : null);
      if (cron && cron_trigger) {
        const cron_name = `workflow:${slug}`;
        const schedule = "schedule" in cron_trigger ? cron_trigger.schedule! : definition.trigger!.schedule;
        const timezone = "timezone" in cron_trigger ? (cron_trigger.timezone ?? null) : (definition.trigger!.timezone ?? null);
        cron.list_jobs(true).then((jobs) => {
          const existing = jobs.find((j) => j.name === cron_name);
          if (existing) return cron.remove_job(existing.id);
        }).then(() =>
          cron.add_job(cron_name, {
            kind: "cron", expr: schedule,
            tz: timezone, at_ms: null, every_ms: null,
          }, `workflow_trigger:${slug}`, false, null, null, false),
        ).catch((e) => logger.warn("workflow_cron_register_failed", { slug, error: String(e) }));
      }
      // 전체 트리거 재동기화 (webhook/channel_message/kanban 포함)
      void deps.on_template_changed?.().catch((e) => logger.warn("trigger_resync_failed", { error: String(e) }));
      return slug;
    },

    delete_template(name) {
      const removed = delete_workflow_template(workspace, name);
      if (cron && removed) {
        const cron_name = `workflow:${name}`;
        cron.list_jobs(true).then((jobs) => {
          const existing = jobs.find((j) => j.name === cron_name);
          if (existing) return cron.remove_job(existing.id);
        }).catch((e) => logger.warn("workflow_cron_unregister_failed", { name, error: String(e) }));
      }
      if (removed) void deps.on_template_changed?.().catch((e) => logger.warn("trigger_resync_failed", { error: String(e) }));
      return removed;
    },

    import_template(yaml_content) {
      const def = parse_workflow_yaml(yaml_content);
      if (!def) return { ok: false, error: "invalid_yaml" };
      const slug = save_workflow_template(workspace, def.title || "imported", def);
      return { ok: true, name: slug };
    },

    export_template(name) {
      const def = load_workflow_template(workspace, name);
      if (!def) return null;
      return serialize_to_yaml(def);
    },

    list_roles() {
      if (!skills_loader) return [];
      return skills_loader.list_role_skills().map((m) => ({
        id: m.role || m.name,
        name: m.name.replace(/^role:/, ""),
        description: m.summary,
        soul: m.soul,
        heart: m.heart,
        tools: m.tools,
      }));
    },

    async resume(workflow_id) {
      const state = await store.get(workflow_id);
      if (!state) return { ok: false, error: "workflow_not_found" };
      if (state.status === "completed" || state.status === "cancelled") {
        return { ok: false, error: `workflow_already_${state.status}` };
      }
      if (state.status === "running") {
        return { ok: false, error: "workflow_already_running" };
      }

      if (!state.definition?.phases?.length && !state.definition?.nodes?.length) {
        return { ok: false, error: "no_definition_for_resume" };
      }

      const { channel, chat_id } = state;
      const ask_user = build_ask_user(workflow_id, channel, chat_id);

      void run_phase_loop({
        workflow_id, title: state.title, objective: state.objective,
        channel, chat_id,
        phases: state.definition.phases || [],
        nodes: state.definition.nodes,
        field_mappings: state.definition.field_mappings,
        ask_user,
        send_message: build_send_message(workflow_id, channel, chat_id),
        ask_channel: build_ask_channel(workflow_id, channel, chat_id),
        invoke_tool: deps.invoke_tool,
        workspace,
        initial_memory: state.memory,
        resume_state: state,
      }, runner_deps).catch((err) => {
        logger.error("workflow_resume_run_error", { workflow_id, error: String(err) });
      });

      return { ok: true };
    },

    /** 서버 재시작 시 고아 상태(running)인 워크플로우를 자동으로 재개. */
    async resume_orphaned() {
      const all = await store.list();
      const orphans = all.filter((s) =>
        s.definition && (
          s.status === "running" ||
          (s.status === "waiting_user_input" && s.auto_resume)
        ),
      );
      if (!orphans.length) return;
      logger.info("resume_orphaned_workflows", { count: orphans.length });

      for (const state of orphans) {
        const { workflow_id, channel, chat_id } = state;
        logger.info("resuming_orphaned_workflow", { workflow_id, title: state.title });
        void run_phase_loop({
          workflow_id, title: state.title, objective: state.objective,
          channel, chat_id,
          phases: state.definition!.phases || [],
          nodes: state.definition!.nodes,
          field_mappings: state.definition!.field_mappings,
          ask_user: build_ask_user(workflow_id, channel, chat_id),
          send_message: build_send_message(workflow_id, channel, chat_id),
          ask_channel: build_ask_channel(workflow_id, channel, chat_id),
          invoke_tool: deps.invoke_tool,
          workspace,
          initial_memory: state.memory,
          resume_state: state,
        }, runner_deps).catch((err) => {
          logger.error("workflow_orphan_resume_error", { workflow_id, error: String(err) });
        });
      }
    },

    async run_single_node(node_raw, input_memory) {
      const { is_orche_node: is_orche } = await import("../../agent/workflow-node.types.js");
      const { execute_orche_node } = await import("../../agent/orche-node-executor.js");
      const node = node_raw as unknown as import("../../agent/workflow-node.types.js").WorkflowNodeDefinition;
      const start = Date.now();
      logger.info("run_single_node", { node_type: node.node_type, node_id: (node as unknown as Record<string, unknown>).node_id, is_orche: is_orche(node), mem_keys: Object.keys(input_memory) });

      if (is_orche(node)) {
        try {
          const result = await execute_orche_node(node, { memory: { ...input_memory }, workspace });
          return { ok: true, output: result.output, duration_ms: Date.now() - start };
        } catch (err) {
          return { ok: false, error: String(err), duration_ms: Date.now() - start };
        }
      }

      if (node.node_type === "phase") {
        const agent_def = node.agents?.[0];
        if (!agent_def) return { ok: false, error: "no_agents_in_phase" };

        const task_parts = [agent_def.system_prompt || ""];
        if (Object.keys(input_memory).length) {
          task_parts.push(`\n## Context\n${JSON.stringify(input_memory, null, 2)}`);
        }
        task_parts.push(`\n## Objective\nExecute this phase node independently.`);

        try {
          const { subagent_id } = await subagents.spawn({
            task: task_parts.join("\n"),
            role: agent_def.role,
            label: agent_def.label || node.title,
            provider_id: (agent_def.backend || undefined) as import("../../providers/types.js").ProviderId | undefined,
            model: agent_def.model,
            max_iterations: agent_def.max_turns || 5,
            announce: false,
            skip_controller: true,
          });
          const wait_ms = Math.min((agent_def.max_turns || 5) * 600_000, 3_600_000);
          const result = await subagents.wait_for_completion(subagent_id, wait_ms);
          if (!result) return { ok: false, error: "subagent_not_found", duration_ms: Date.now() - start };
          if (result.status === "failed") return { ok: false, error: result.error || "subagent_failed", duration_ms: Date.now() - start };
          const raw = result.content || "";
          let output: unknown = raw;
          if (typeof raw === "string") {
            const trimmed = raw.trim();
            try { output = JSON.parse(trimmed); } catch {
              const cb = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
              if (cb?.[1]) {
                try { output = JSON.parse(cb[1].trim()); } catch { /* fall through */ }
              }
              if (output === raw) {
                const braceIdx = trimmed.indexOf("{");
                const bracketIdx = trimmed.indexOf("[");
                const idx = braceIdx >= 0 && (bracketIdx < 0 || braceIdx < bracketIdx) ? braceIdx : bracketIdx;
                if (idx >= 0) {
                  try { output = JSON.parse(trimmed.slice(idx)); } catch { /* 평문 유지 */ }
                }
              }
            }
          }
          return { ok: true, output, duration_ms: Date.now() - start };
        } catch (err) {
          return { ok: false, error: String(err), duration_ms: Date.now() - start };
        }
      }

      return { ok: false, error: "unknown_node_type" };
    },

    async suggest(instruction, options) {
      if (!deps.providers) return { ok: false, error: "providers_not_configured" };

      // provider_id가 "auto"이거나 미지정 시 tool-loop 지원 프로바이더 자동 선택.
      // orchestrator_llm(Ollama 등)은 multi-turn tool-call 루프를 신뢰할 수 없으므로 제외.
      // 자동 선택 시: 사용자가 Providers 페이지에서 설정한 priority 순서를 따름.
      const requested = options?.provider_id;
      const summaries = deps.get_provider_summaries?.() ?? [];
      let suggest_provider_id: import("../../providers/types.js").ProviderId | undefined;

      if (!requested || requested === "auto") {
        // 설정된 프로바이더 순서(priority ASC) → ProviderId 매핑 → orchestrator_llm 제외
        const configured_order = summaries
          .map((p) => PROVIDER_TYPE_TO_ID[p.provider_type])
          .filter((id): id is import("../../providers/types.js").ProviderId => !!id);
        const seen = new Set<string>();
        const deduped = configured_order.filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return deps.providers!.list_providers().includes(id);
        });
        const fallback: import("../../providers/types.js").ProviderId[] = ["claude_code", "chatgpt", "gemini", "openrouter", "orchestrator_llm"];
        suggest_provider_id = deduped[0] ?? fallback.find((id) => deps.providers!.list_providers().includes(id));
      } else if (VALID_PROVIDER_IDS.has(requested)) {
        // 이미 유효한 ProviderId
        suggest_provider_id = requested as import("../../providers/types.js").ProviderId;
      } else {
        // instance_id (프론트엔드 프로바이더 선택기) → provider_type → ProviderId 변환
        const summary = summaries.find((p) => p.backend === requested);
        const mapped = summary ? PROVIDER_TYPE_TO_ID[summary.provider_type] : undefined;
        const fallback: import("../../providers/types.js").ProviderId[] = ["claude_code", "chatgpt", "gemini", "openrouter", "orchestrator_llm"];
        suggest_provider_id = mapped ?? fallback.find((id) => deps.providers!.list_providers().includes(id));
      }

      if (!suggest_provider_id) return { ok: false, error: "no_suitable_provider_for_suggest" };

      try {
        // workflow 우선: 항상 현재 in-memory 상태를 사용.
        // name은 workflow가 없을 때만 파일 로드용으로 사용.
        let source: Record<string, unknown>;
        if (options?.workflow) {
          source = options.workflow;
        } else if (options?.name && workspace) {
          const tpl = load_workflow_template(workspace, options.name);
          if (!tpl) return { ok: false, error: `template_not_found: ${options.name}` };
          source = tpl as unknown as Record<string, unknown>;
        } else {
          source = { title: "", objective: "", phases: [] };
        }
        /** 수정 중인 워크플로우 사본. update_section이 in-place로 패치. */
        const wf = structuredClone(source) as Record<string, unknown>;

        // ── Section type → array 매핑 ──────────────────────────────────
        const SECTION_MAP: Record<string, { arr: string; key: string }> = {
          node:    { arr: "nodes",         key: "node_id"   },
          phase:   { arr: "phases",        key: "phase_id"  },
          trigger: { arr: "trigger_nodes", key: "id"        },
          tool:    { arr: "tool_nodes",    key: "id"        },
          skill:   { arr: "skill_nodes",   key: "id"        },
          orche:   { arr: "orche_nodes",   key: "node_id"   },
        };

        function read_section(path: string): string {
          if (path === "overview") {
            const to_compact = (arr: unknown[], id_key: string, extra?: string[]) =>
              (arr as Array<Record<string, unknown>>).map(x => {
                const item: Record<string, unknown> = { [id_key]: x[id_key] };
                if (x.node_type || x.trigger_type) item.type = x.node_type ?? x.trigger_type;
                if (x.title) item.title = x.title;
                if (x.depends_on) item.depends_on = x.depends_on;
                extra?.forEach(k => { if (x[k] !== undefined) item[k] = x[k]; });
                return item;
              });
            return JSON.stringify({
              title: wf.title,
              nodes: to_compact((wf.nodes as unknown[] | undefined) ?? [], "node_id"),
              phases: to_compact((wf.phases as unknown[] | undefined) ?? [], "phase_id"),
              trigger_nodes: to_compact((wf.trigger_nodes as unknown[] | undefined) ?? [], "id", ["trigger_type"]),
              tool_nodes: ((wf.tool_nodes as Array<Record<string, unknown>> | undefined) ?? []).map(t => ({ id: t.id, tool_id: t.tool_id, description: t.description })),
              skill_nodes: ((wf.skill_nodes as Array<Record<string, unknown>> | undefined) ?? []).map(s => ({ id: s.id, skill_name: s.skill_name })),
              orche_nodes: to_compact((wf.orche_nodes as unknown[] | undefined) ?? [], "node_id"),
            }, null, 2);
          }
          if (path === "metadata") {
            return JSON.stringify({ title: wf.title, objective: wf.objective, variables: wf.variables }, null, 2);
          }
          if (path === "field_mappings") {
            return JSON.stringify(wf.field_mappings ?? [], null, 2);
          }
          const colon = path.indexOf(":");
          if (colon < 0) return `# unknown path: ${path}`;
          const type = path.slice(0, colon);
          const id   = path.slice(colon + 1);
          const m    = SECTION_MAP[type];
          if (!m) return `# unknown section type: ${type}`;
          const arr  = (wf[m.arr] as Array<Record<string, unknown>> | undefined) ?? [];
          const item = arr.find(x => String(x[m.key]) === id);
          return item ? JSON.stringify(item, null, 2) : `# ${path} not found`;
        }

        function update_section(path: string, content: string): string {
          let parsed: Record<string, unknown>;
          try {
            const trimmed = content.trim().replace(/^```(?:json|yaml)?\s*\n?/, "").replace(/```\s*$/, "").trim();
            parsed = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            return `error: invalid JSON in update_section(${path})`;
          }
          if (path === "metadata") {
            if (parsed.title     !== undefined) wf.title     = parsed.title;
            if (parsed.objective !== undefined) wf.objective = parsed.objective;
            if (parsed.variables !== undefined) wf.variables = parsed.variables;
            options?.on_patch?.(path, { title: wf.title, objective: wf.objective, variables: wf.variables });
            return "ok";
          }
          if (path === "field_mappings") {
            wf.field_mappings = parsed;
            options?.on_patch?.(path, wf.field_mappings as unknown[]);
            return "ok";
          }
          const colon = path.indexOf(":");
          if (colon < 0) return `error: unknown path: ${path}`;
          const type = path.slice(0, colon);
          const id   = path.slice(colon + 1);
          const m    = SECTION_MAP[type];
          if (!m) return `error: unknown section type: ${type}`;
          const arr = (wf[m.arr] as Array<Record<string, unknown>> | undefined) ?? [];
          const idx = arr.findIndex(x => String(x[m.key]) === id);
          if (idx < 0) {
            arr.push({ [m.key]: id, ...parsed });
          } else {
            arr[idx] = { ...arr[idx], ...parsed };
          }
          wf[m.arr] = arr;
          options?.on_patch?.(path, arr[idx < 0 ? arr.length - 1 : idx]);
          return "ok";
        }

        async function search_tool(query: string): Promise<string> {
          if (!deps.get_tool_summaries) return "[]";
          // ToolIndex(FTS5+벡터)가 있으면 기존 검색 인프라 활용
          if (deps.tool_index) {
            try {
              const names = await deps.tool_index.select(query, { max_tools: 10 });
              const all = deps.get_tool_summaries();
              const results = [...names].map(n => all.find(t => t.name === n)).filter(Boolean);
              return JSON.stringify(results, null, 2);
            } catch { /* fallback */ }
          }
          const lower = query.toLowerCase();
          const results = deps.get_tool_summaries().filter(t =>
            t.name.toLowerCase().includes(lower) ||
            t.description.toLowerCase().includes(lower) ||
            t.category.toLowerCase().includes(lower),
          ).slice(0, 10);
          return JSON.stringify(results, null, 2);
        }

        function search_skill(query: string): string {
          if (!skills_loader) return "[]";
          const lower = query.toLowerCase();
          return JSON.stringify(
            skills_loader.list_skills(true)
              .filter(s => s.name.toLowerCase().includes(lower) || (s.summary ?? "").toLowerCase().includes(lower))
              .slice(0, 10)
              .map(s => ({ name: s.name, summary: s.summary })),
            null, 2,
          );
        }

        // ── LLM tools 정의 ──────────────────────────────────────────────
        const SUGGEST_TOOLS: Record<string, unknown>[] = [
          {
            type: "function",
            function: {
              name: "get_overview",
              description: "워크플로우의 모든 노드 ID, 타입, 의존성 구조를 반환. 작업 시작 시 먼저 호출.",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "read_section",
              description: "특정 섹션을 JSON으로 읽기. path 예시: 'overview' | 'metadata' | 'node:{node_id}' | 'phase:{phase_id}' | 'trigger:{id}' | 'tool:{id}' | 'skill:{id}' | 'field_mappings'",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "update_section",
              description: "섹션을 수정. 기존 필드는 merge됨. yaml_content는 JSON 형식.",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  yaml_content: { type: "string", description: "수정할 내용 (JSON)" },
                },
                required: ["path", "yaml_content"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "search_tool",
              description: "자연어 쿼리로 사용 가능한 tool 검색 (tool_id 찾을 때 사용).",
              parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "search_skill",
              description: "자연어 쿼리로 사용 가능한 skill 검색 (skill_name 찾을 때 사용).",
              parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "done",
              description: "모든 수정 완료. 작업 종료 신호. 반드시 마지막에 호출.",
              parameters: { type: "object", properties: {} },
            },
          },
        ];

        // ── System prompt (도구 + 스키마만, 전체 워크플로우 제외) ──────
        if (!suggest_node_catalog_cache) suggest_node_catalog_cache = build_node_catalog();

        const provider_section = deps.get_provider_summaries
          ? deps.get_provider_summaries()
              .map((p) => `- ${p.backend} (${p.provider_type}): ${p.models.join(", ") || "(no models)"}`)
              .join("\n")
          : "";

        const system = [
          "You are a workflow editor agent. Modify the workflow using the provided tools.",
          "STRATEGY:",
          "1. The workflow overview is already provided in the user message — do NOT call get_overview() first.",
          "2. Call read_section('phase:{id}') or 'node:{id}' for sections that need changes.",
          "3. Modify only the necessary fields and call update_section(path, json).",
          "4. Repeat for each section that needs changes.",
          "5. Call done() when finished. Never skip done().",
          "RULES: Preserve untouched fields. Use search_tool/search_skill to find IDs by description.",
          provider_section ? `\n## Available Backends\n${provider_section}` : "",
          "",
          WORKFLOW_SCHEMA_REFERENCE,
          "",
          suggest_node_catalog_cache,
        ].filter(Boolean).join("\n");

        // ── Tool-call 루프 (최대 10 turn, 전체 110초 제한) ──────────────
        // 프론트엔드 30초 타임아웃보다 넉넉하게 110초로 설정.
        // 타임아웃 도달 시 현재까지 패치된 wf를 그대로 반환.
        const MAX_TURNS = 10;
        const loop_abort = AbortSignal.timeout(110_000);
        const messages: import("../../providers/types.js").ChatMessage[] = [];
        if (system.trim()) messages.push({ role: "system", content: system });
        // overview를 user 메시지에 미리 포함 → get_overview() 첫 호출 불필요
        const initial_overview = read_section("overview");
        messages.push({ role: "user", content: `## Workflow Overview\n${initial_overview}\n\n## Instruction\n${instruction}` });

        logger?.debug?.("[suggest] loop start", { instruction: instruction.slice(0, 80), source: options?.name ?? "inline" });

        let last_tool_sig = "";
        let repeat_count = 0;
        let use_single_shot_fallback = false;

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          if (loop_abort.aborted) break;
          if (use_single_shot_fallback) break;
          const res = await deps.providers.run_orchestrator({
            messages,
            tools: SUGGEST_TOOLS,
            provider_id: suggest_provider_id,
            model: options?.model,
            max_tokens: 4096,
            temperature: 0.2,
            abort_signal: loop_abort,
            on_stream: options?.on_stream,
          });

          logger?.debug?.("[suggest] turn response", {
            turn,
            tool_calls: res.tool_calls.length,
            tool_names: res.tool_calls.map(tc => tc.name),
            finish_reason: res.finish_reason,
            content_len: String(res.content ?? "").length,
            content_preview: String(res.content ?? "").slice(0, 120),
          });

          // 루프 감지: 같은 툴 시그니처가 연속 반복 → single-shot 폴백으로 전환
          const tool_sig = res.tool_calls.map(tc => tc.name).join(",");
          if (tool_sig && tool_sig === last_tool_sig) {
            repeat_count++;
          } else {
            repeat_count = 0;
            last_tool_sig = tool_sig;
          }
          if (repeat_count >= 2) {
            logger?.debug?.("[suggest] loop detected, switching to single-shot fallback", { tool_sig, repeat_count });
            use_single_shot_fallback = true;
          }

          messages.push({
            role: "assistant",
            content: res.content,
            tool_calls: res.tool_calls.length > 0
              ? res.tool_calls.map(tc => ({
                  id: tc.id, type: "function",
                  function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                }))
              : undefined,
          });

          if (res.tool_calls.length === 0 || use_single_shot_fallback) {
            // tool loop를 지원하지 않는 프로바이더이거나 루프 감지 시 single-shot JSON 폴백.
            if (turn === 0 || use_single_shot_fallback) {
              logger?.debug?.("[suggest] fallback: single-shot JSON", { reason: use_single_shot_fallback ? "loop_detected" : "no_tool_calls", turn });
              const fallback_system = [
                "You are a workflow JSON editor.",
                "Modify the workflow JSON according to the instruction and return the COMPLETE modified workflow.",
                "Rules:",
                "- Output ONLY the raw JSON object — no markdown fences, no explanation.",
                "- Preserve all fields that are not mentioned in the instruction.",
                "- Apply every change the instruction asks for.",
              ].join("\n");
              const fallback_res = await deps.providers.run_orchestrator({
                messages: [
                  { role: "system" as const, content: fallback_system },
                  {
                    role: "user" as const,
                    content: [
                      `Instruction: ${instruction}`,
                      `Current workflow:\n${JSON.stringify(wf, null, 2)}`,
                    ].join("\n\n"),
                  },
                ],
                provider_id: suggest_provider_id,
                model: options?.model,
                max_tokens: 8192,
                temperature: 0.1,
                abort_signal: loop_abort,
                on_stream: options?.on_stream,
              });
              logger?.debug?.("[suggest] fallback response", {
                content_len: String(fallback_res.content ?? "").length,
                content_preview: String(fallback_res.content ?? "").slice(0, 200),
              });
              const patched = extract_json_from_response(String(fallback_res.content || ""));
              logger?.debug?.("[suggest] fallback json parse", { success: !!patched });
              if (patched) {
                Object.assign(wf, patched);
                options?.on_patch?.("metadata", { title: wf.title, objective: wf.objective, variables: wf.variables });
              }
            }
            break;
          }

          let is_done = false;
          for (const tc of res.tool_calls) {
            let result: string;
            if (tc.name === "done") {
              is_done = true;
              result = "ok";
            } else if (tc.name === "get_overview") {
              result = read_section("overview");
            } else if (tc.name === "read_section") {
              result = read_section(String(tc.arguments.path ?? ""));
            } else if (tc.name === "update_section") {
              // yaml_content가 이미 파싱된 객체일 수 있음 → String() 하면 "[object Object]"
              const yaml_arg = tc.arguments.yaml_content;
              const yaml_str = typeof yaml_arg === "string" ? yaml_arg : JSON.stringify(yaml_arg ?? "");
              result = update_section(String(tc.arguments.path ?? ""), yaml_str);
              logger?.debug?.("[suggest] update_section", { path: tc.arguments.path, result, content_preview: yaml_str.slice(0, 80) });
            } else if (tc.name === "search_tool") {
              result = await search_tool(String(tc.arguments.query ?? ""));
            } else if (tc.name === "search_skill") {
              result = search_skill(String(tc.arguments.query ?? ""));
            } else {
              result = `unknown tool: ${tc.name}`;
            }
            messages.push({ role: "tool", tool_call_id: tc.id, content: result });
          }
          if (is_done) break;
        }

        // name이 있으면 항상 저장 (다음 요청에서 최신 상태 로드 보장)
        const should_save = (options?.save || !!options?.name) && workspace;
        if (should_save) {
          const title = typeof wf.title === "string" && wf.title.trim() ? wf.title.trim() : "untitled";
          const slug = save_workflow_template(workspace, title, wf as unknown as WorkflowDefinition);
          return { ok: true, workflow: wf, name: slug };
        }
        return { ok: true, workflow: wf };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    test_single_node(node_raw, input_memory) {
      const node = node_raw as unknown as import("../../agent/workflow-node.types.js").WorkflowNodeDefinition;

      if (node.node_type !== "phase") {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { test_orche_node } = require("../../agent/orche-node-executor.js") as typeof import("../../agent/orche-node-executor.js");
        if (!workspace) throw new Error("workspace is required for test_single_node");
        const result = test_orche_node(node as import("../../agent/workflow-node.types.js").OrcheNodeDefinition, { memory: { ...input_memory }, workspace });
        return { ok: true, preview: result.preview, warnings: result.warnings };
      }

      const agent_def = node.agents?.[0];
      if (!agent_def) return { ok: false, warnings: ["no_agents_in_phase"] };
      const prompt_preview = [
        agent_def.system_prompt || "(empty system_prompt)",
        Object.keys(input_memory).length ? `\n## Context\n${JSON.stringify(input_memory, null, 2)}` : "",
        `\n## Objective\n(will be provided at runtime)`,
      ].join("\n");
      return { ok: true, preview: { prompt: prompt_preview, backend: agent_def.backend, model: agent_def.model }, warnings: [] };
    },

    async update_settings(workflow_id, settings) {
      const state = await store.get(workflow_id);
      if (!state) return { ok: false, error: "workflow_not_found" };
      await store.patch_settings(workflow_id, settings);
      return { ok: true };
    },
  };
}
