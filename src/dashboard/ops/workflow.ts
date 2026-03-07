/** Dashboard workflow ops. */

import type { PhaseWorkflowStoreLike } from "../../agent/phase-workflow-store.js";
import type { SubagentRegistry } from "../../agent/subagents.js";
import type { SkillsLoader } from "../../agent/skills.service.js";
import type { DashboardWorkflowOps } from "../service.js";
import type { PhaseLoopRunOptions, ChannelSendRequest, ChannelResponse } from "../../agent/phase-loop.types.js";
import {
  load_workflow_templates, load_workflow_template,
  substitute_variables, save_workflow_template,
  delete_workflow_template, parse_workflow_yaml, serialize_to_yaml,
} from "../../orchestration/workflow-loader.js";
import { run_phase_loop } from "../../agent/phase-loop-runner.js";
import { build_node_catalog } from "../../agent/tools/workflow-catalog.js";
import { short_id } from "../../utils/common.js";
import type { Logger } from "../../logger.js";

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
  trigger_type: "cron" | "webhook" | "manual" | "channel_message",
  schedule?: string,           // cron expression (for cron)
  timezone?: string,
  webhook_path?: string,       // (for webhook)
  channel_type?: string,       // (for channel_message)
  chat_id?: string,
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
  hitl_pending_store: import("../../orchestration/hitl-pending-store.js").HitlPendingStore;
  renderer?: import("../../channels/persona-message-renderer.js").PersonaMessageRendererLike | null;
}): DashboardWorkflowOps & { hitl_bridge: import("../../channels/manager.js").WorkflowHitlBridge } {
  const { store, subagents, workspace, logger, skills_loader, on_workflow_event, bus, cron } = deps;
  let suggest_node_catalog_cache: string | null = null;

  const pending_responses = deps.hitl_pending_store;

  function build_ask_user(workflow_id: string, target_channel: string, target_chat_id: string) {
    return (question: string): Promise<string> => {
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
    return (req: ChannelSendRequest, timeout_ms: number): Promise<ChannelResponse> => {
      const channel = req.target === "origin" ? origin_channel : (req.channel || origin_channel);
      const chat_id = req.target === "origin" ? origin_chat_id : (req.chat_id || origin_chat_id);

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
      }, { subagents, store, logger, load_template: (name) => load_workflow_template(workspace, name), providers: deps.providers, decision_service: deps.decision_service, promise_service: deps.promise_service, embed: deps.embed, vector_store: deps.vector_store, oauth_fetch: deps.oauth_fetch, get_webhook_data: deps.get_webhook_data, wait_kanban_event: deps.wait_kanban_event, create_task: deps.create_task, query_db: deps.query_db, on_kanban_trigger_waiting: deps.on_kanban_trigger_waiting, on_event: on_workflow_event }).catch((err) => {
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
      if (cron && definition.trigger?.type === "cron" && definition.trigger.schedule) {
        const cron_name = `workflow:${slug}`;
        cron.list_jobs(true).then((jobs) => {
          const existing = jobs.find((j) => j.name === cron_name);
          if (existing) return cron.remove_job(existing.id);
        }).then(() =>
          cron.add_job(cron_name, {
            kind: "cron", expr: definition.trigger!.schedule,
            tz: definition.trigger!.timezone ?? null,
            at_ms: null, every_ms: null,
          }, `workflow_trigger:${slug}`, false, null, null, false),
        ).catch((e) => logger.warn("workflow_cron_register_failed", { slug, error: String(e) }));
      }
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
      }, { subagents, store, logger, load_template: (name) => load_workflow_template(workspace, name), providers: deps.providers, decision_service: deps.decision_service, promise_service: deps.promise_service, embed: deps.embed, vector_store: deps.vector_store, oauth_fetch: deps.oauth_fetch, get_webhook_data: deps.get_webhook_data, wait_kanban_event: deps.wait_kanban_event, create_task: deps.create_task, query_db: deps.query_db, on_kanban_trigger_waiting: deps.on_kanban_trigger_waiting, on_event: on_workflow_event }).catch((err) => {
        logger.error("workflow_resume_run_error", { workflow_id, error: String(err) });
      });

      return { ok: true };
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
          const result = await subagents.wait_for_completion(subagent_id, 3 * 60_000);
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

    async suggest(instruction, workflow) {
      if (!deps.providers) return { ok: false, error: "providers_not_configured" };
      try {
        if (!suggest_node_catalog_cache) suggest_node_catalog_cache = build_node_catalog();
        const node_catalog = suggest_node_catalog_cache;

        const tool_section = deps.get_tool_summaries
          ? deps.get_tool_summaries()
              .map((t) => `- ${t.name} [${t.category}]: ${t.description}`)
              .join("\n")
          : "";

        const provider_section = deps.get_provider_summaries
          ? deps.get_provider_summaries()
              .map((p) => `- ${p.backend} (${p.provider_type}): ${p.models.join(", ") || "(no models)"}`)
              .join("\n")
          : "";

        const skill_section = skills_loader
          ? skills_loader.list_skills(true).map((s) => `- ${s.name}: ${s.summary}`).join("\n")
          : "";

        const system = [
          "You are a workflow editor agent. You receive a workflow definition (JSON) and an edit instruction from the user.",
          "Return ONLY the modified workflow definition as valid JSON \u2014 no markdown fences, no explanation.",
          "Preserve all existing fields unless the instruction explicitly asks to change them.",
          "If the instruction is unclear or impossible, return the original workflow unchanged.",
          "",
          node_catalog,
          "",
          WORKFLOW_SCHEMA_REFERENCE,
          tool_section ? `\n## Available Tools (for tool_invoke / tool_nodes)\n${tool_section}` : "",
          provider_section ? `\n## Available Backends & Models (for ai_agent/llm nodes)\n${provider_section}` : "",
          skill_section ? `\n## Available Skills (for skill_nodes / phase skills)\n${skill_section}` : "",
        ].filter(Boolean).join("\n");
        const prompt = [
          "## Current Workflow",
          JSON.stringify(workflow, null, 2),
          "",
          "## Instruction",
          instruction,
        ].join("\n");
        const res = await deps.providers.run_headless_prompt({ prompt, system, max_tokens: 8192, temperature: 0.2 });
        const raw = String(res.content || "").trim();
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(raw); } catch {
          const cb = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
          if (cb?.[1]) { try { parsed = JSON.parse(cb[1].trim()); } catch { /* */ } }
          if (!parsed) {
            const idx = raw.indexOf("{");
            if (idx >= 0) { try { parsed = JSON.parse(raw.slice(idx)); } catch { /* */ } }
          }
        }
        if (!parsed || typeof parsed !== "object") return { ok: false, error: "llm_returned_invalid_json" };
        return { ok: true, workflow: parsed };
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
  };
}
