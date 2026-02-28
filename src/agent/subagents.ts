import { randomUUID } from "node:crypto";
import type { Logger } from "../logger.js";
import { now_iso } from "../utils/common.js";
import type { ChatMessage, ProviderId, ProviderRegistry, ToolCallRequest } from "../providers/index.js";
import { create_default_tool_registry, type ToolRegistry } from "./tools.js";
import type { MessageBus, InboundMessage } from "../bus/index.js";
import type { ContextBuilder } from "./context.js";
import { parse_tool_calls_from_text } from "./tool-call-parser.js";
import { resolve_executor_provider } from "../providers/executor.js";

export type SubagentStatus = "idle" | "running" | "completed" | "failed" | "cancelled" | "offline";

export interface SubagentRef {
  id: string;
  role: string;
  model?: string;
  status: SubagentStatus;
  created_at?: string;
  updated_at?: string;
  last_error?: string;
  last_result?: string;
  label?: string;
}

export type SpawnSubagentOptions = {
  task: string;
  role?: string;
  soul?: string;
  heart?: string;
  label?: string;
  provider_id?: ProviderId;
  model?: string;
  max_iterations?: number;
  max_tokens?: number;
  temperature?: number;
  origin_channel?: string;
  origin_chat_id?: string;
  announce?: boolean;
  parent_id?: string;
  /** 추천된 스킬 이름 — build_system_prompt에 스킬 컨텍스트를 포함. */
  skill_names?: string[];
};

type RunningSubagent = {
  ref: SubagentRef;
  abort: AbortController;
  done: Promise<void>;
  parent_id: string | null;
};

type ControllerPlan = {
  done: boolean;
  executor_prompt: string;
  final_answer: string;
  reason: string;
  handoffs: Array<{ alias: string; instruction: string }>;
};

export class SubagentRegistry {
  private readonly items = new Map<string, SubagentRef>();
  private readonly running = new Map<string, RunningSubagent>();
  private readonly workspace: string;
  private readonly providers: ProviderRegistry | null;
  private readonly bus: MessageBus | null;
  private readonly build_tools: () => ToolRegistry;
  private readonly context_builder: ContextBuilder | null;
  private readonly logger: Logger | null;

  constructor(args?: {
    workspace?: string;
    providers?: ProviderRegistry | null;
    bus?: MessageBus | null;
    build_tools?: (() => ToolRegistry) | null;
    context_builder?: ContextBuilder | null;
    logger?: Logger | null;
  }) {
    this.workspace = args?.workspace || process.cwd();
    this.providers = args?.providers || null;
    this.bus = args?.bus || null;
    this.build_tools = args?.build_tools || (() => create_default_tool_registry({ workspace: this.workspace, bus: this.bus }));
    this.context_builder = args?.context_builder || null;
    this.logger = args?.logger || null;
  }

  upsert(ref: SubagentRef): void {
    const prev = this.items.get(ref.id);
    this.items.set(ref.id, {
      ...prev,
      ...ref,
      created_at: prev?.created_at || ref.created_at || now_iso(),
      updated_at: now_iso(),
    });
  }

  get(id: string): SubagentRef | null {
    return this.items.get(id) || null;
  }

  list(): SubagentRef[] {
    return [...this.items.values()].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  }

  list_running(): SubagentRef[] {
    return [...this.running.values()].map((r) => r.ref);
  }

  get_running_count(): number {
    return this.running.size;
  }

  async wait_for_completion(
    id: string,
    timeout_ms = 0,
    poll_interval_ms = 150,
  ): Promise<{ status: SubagentStatus; content?: string; error?: string } | null> {
    const started = Date.now();
    while (true) {
      if (timeout_ms > 0 && Date.now() - started > timeout_ms) {
        return { status: "failed", error: `subagent_timeout_${timeout_ms}ms` };
      }
      const ref = this.items.get(id);
      if (!ref) return null;
      if (ref.status === "completed") {
        return { status: ref.status, content: ref.last_result };
      }
      if (ref.status === "failed" || ref.status === "cancelled" || ref.status === "offline") {
        return { status: ref.status, error: ref.last_error };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(50, poll_interval_ms)));
    }
  }

  async spawn(options: SpawnSubagentOptions): Promise<{ subagent_id: string; status: string; message: string }> {
    if (!this.providers) {
      throw new Error("providers_not_configured");
    }
    const subagent_id = randomUUID().slice(0, 8);
    const role = options.role || "worker";
    const label = options.label || options.task.slice(0, 40);
    const ref: SubagentRef = {
      id: subagent_id,
      role,
      model: options.model,
      status: "running",
      label,
      created_at: now_iso(),
      updated_at: now_iso(),
    };
    this.items.set(subagent_id, ref);

    const abort = new AbortController();
    const done = this._run_subagent(subagent_id, options, abort);
    this.running.set(subagent_id, { ref, abort, done, parent_id: options.parent_id || null });
    done.finally(() => {
      this.running.delete(subagent_id);
    }).catch((e) => {
      this.logger?.error("subagent unhandled rejection", { subagent_id, error: e instanceof Error ? e.message : String(e) });
    });

    return {
      subagent_id,
      status: "started",
      message: `Subagent '${label}' started (${subagent_id})`,
    };
  }

  cancel(id: string, cascade = true): boolean {
    const running = this.running.get(id);
    if (!running) return false;
    running.abort.abort();
    const prev = this.items.get(id);
    if (prev) {
      this.items.set(id, {
        ...prev,
        status: "cancelled",
        updated_at: now_iso(),
      });
    }

    if (cascade) {
      const children = [...this.running.entries()]
        .filter(([, child]) => child.parent_id === id)
        .map(([child_id]) => child_id);
      for (const child_id of children) {
        this.cancel(child_id, true);
      }
    }
    return true;
  }

  private async _run_subagent(id: string, options: SpawnSubagentOptions, abort: AbortController): Promise<void> {
    const providers = this.providers;
    if (!providers) throw new Error("providers_not_configured");
    const max_iterations = Math.max(1, Number(options.max_iterations || 15));
    const controller_provider_id = providers.get_orchestrator_provider_id();
    const executor_provider_id = resolve_executor_provider(options.provider_id || "claude_code");
    const model = options.model;
    const max_tokens = options.max_tokens ?? 4096;
    const temperature = options.temperature ?? 0.4;

    const tools = this.build_tools();
    const always_skills = this.context_builder?.skills_loader.get_always_skills() || [];
    const merged_skills = [...new Set([...always_skills, ...(options.skill_names || [])])];
    const contextual_system = this.context_builder
      ? await this.context_builder.build_system_prompt(merged_skills, { agent_id: id }, {
          channel: options.origin_channel || null,
          chat_id: options.origin_chat_id || null,
        })
      : "";

    let final_content = "";
    let stream_buffer = "";
    let last_stream_emit_at = 0;
    let last_executor_output = "";
    let loop_iteration = 0;
    const handoff_emitted = new Set<string>();
    try {
      for (let iteration = 0; iteration < max_iterations; iteration += 1) {
        if (abort.signal.aborted) {
          this._update_status(id, "cancelled");
          return;
        }

        const controller = await providers.run_orchestrator({
          provider_id: controller_provider_id,
          messages: [
            {
              role: "system",
              content: this._build_controller_prompt(options, id, contextual_system),
            },
            {
              role: "user",
              content: [
                `task: ${options.task}`,
                `iteration: ${iteration + 1}/${max_iterations}`,
                `last_executor_output:`,
                last_executor_output || "(none)",
              ].join("\n"),
            },
          ],
          model,
          max_tokens: Math.min(1600, max_tokens),
          temperature: 0.1,
        });
        const plan = this._parse_controller_plan(controller.content || "");
        if (plan.handoffs.length > 0) {
          for (const handoff of plan.handoffs) {
            const key = `${handoff.alias}::${handoff.instruction}`;
            if (handoff_emitted.has(key)) continue;
            handoff_emitted.add(key);
            await this._announce_handoff({
              subagent_id: id,
              alias: handoff.alias,
              instruction: handoff.instruction,
              origin_channel: options.origin_channel,
              origin_chat_id: options.origin_chat_id,
            });
          }
        }
        if (plan.done) {
          final_content = plan.final_answer || last_executor_output || "completed_without_final_response";
          break;
        }
        if (!plan.executor_prompt) {
          final_content = last_executor_output || "completed_without_final_response";
          break;
        }
        loop_iteration += 1;
        await this._announce_progress({
          subagent_id: id,
          label: options.label || options.task.slice(0, 40),
          origin_channel: options.origin_channel,
          origin_chat_id: options.origin_chat_id,
          content: `turn ${loop_iteration}: executor started`,
        });

        // Clean executor turn: do not carry previous assistant/tool chat history.
        const response = await providers.run_headless({
          provider_id: executor_provider_id,
          messages: [
            {
              role: "system",
              content: this._build_executor_prompt(options, id, contextual_system),
            },
            {
              role: "user",
              content: plan.executor_prompt,
            },
          ],
          tools: tools.get_definitions(),
          model,
          max_tokens,
          temperature,
          on_stream: async (chunk) => {
            if (abort.signal.aborted) return;
            stream_buffer += String(chunk || "");
            const now = Date.now();
            if (stream_buffer.length < 120 && now - last_stream_emit_at < 1500) return;
            await this._flush_stream_buffer({
              subagent_id: id,
              label: options.label || options.task.slice(0, 40),
              origin_channel: options.origin_channel,
              origin_chat_id: options.origin_chat_id,
              stream_buffer_ref: () => stream_buffer,
              clear_stream_buffer: () => { stream_buffer = ""; },
            });
            last_stream_emit_at = now;
          },
        });
        const provider_err = this._extract_provider_error(response.content || "");
        if (provider_err) throw new Error(provider_err);
        await this._flush_stream_buffer({
          subagent_id: id,
          label: options.label || options.task.slice(0, 40),
          origin_channel: options.origin_channel,
          origin_chat_id: options.origin_chat_id,
          stream_buffer_ref: () => stream_buffer,
          clear_stream_buffer: () => { stream_buffer = ""; },
        });

        // executor tool-use loop: 다중 라운드 tool call 지원
        const MAX_TOOL_ROUNDS = 5;
        let current_response = response;
        let tool_messages: ChatMessage[] = [
          { role: "system", content: this._build_executor_prompt(options, id, contextual_system) },
          { role: "user", content: plan.executor_prompt },
        ];
        for (let tool_round = 0; tool_round < MAX_TOOL_ROUNDS; tool_round++) {
          const implicit = current_response.has_tool_calls
            ? []
            : parse_tool_calls_from_text(current_response.content || "");
          const effective = current_response.has_tool_calls ? current_response.tool_calls : implicit;
          if (effective.length === 0) break;

          tool_messages.push(this._assistant_tool_call_message(current_response.content, effective));
          for (const tc of effective) {
            if (abort.signal.aborted) { this._update_status(id, "cancelled"); return; }
            const result = await tools.execute(tc.name, tc.arguments, {
              signal: abort.signal,
              channel: options.origin_channel,
              chat_id: options.origin_chat_id,
              sender_id: `subagent:${id}`,
            });
            tool_messages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: result });
          }
          const followup = await providers.run_headless({
            provider_id: executor_provider_id,
            messages: tool_messages,
            model,
            max_tokens,
            temperature,
          });
          const followup_err = this._extract_provider_error(followup.content || "");
          if (followup_err) throw new Error(followup_err);
          current_response = followup;
        }
        last_executor_output = current_response.content || response.content || "";
      }

      if (!final_content) {
        final_content = last_executor_output || "completed_without_final_response";
      }
      await this._flush_stream_buffer({
        subagent_id: id,
        label: options.label || options.task.slice(0, 40),
        origin_channel: options.origin_channel,
        origin_chat_id: options.origin_chat_id,
        stream_buffer_ref: () => stream_buffer,
        clear_stream_buffer: () => { stream_buffer = ""; },
      });
      this._update_status(id, "completed", undefined, final_content);
      if (options.announce !== false) {
        await this._announce_result({
          subagent_id: id,
          task: options.task,
          label: options.label || options.task.slice(0, 40),
          content: final_content,
          origin_channel: options.origin_channel,
          origin_chat_id: options.origin_chat_id,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._update_status(id, "failed", message);
      if (options.announce !== false) {
        await this._announce_result({
          subagent_id: id,
          task: options.task,
          label: options.label || options.task.slice(0, 40),
          content: `Error: ${message}`,
          origin_channel: options.origin_channel,
          origin_chat_id: options.origin_chat_id,
        });
      }
    }
  }

  private _parse_controller_plan(raw: string): ControllerPlan {
    const text = String(raw || "").trim();
    if (!text) {
      return {
        done: false,
        executor_prompt: "",
        final_answer: "",
        reason: "empty_controller_output",
        handoffs: [],
      };
    }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const rawHandoffs = Array.isArray(parsed.handoffs) ? parsed.handoffs : [];
      const handoffs = rawHandoffs
        .map((row) => {
          const rec = (row && typeof row === "object") ? (row as Record<string, unknown>) : {};
          const alias = String(rec.alias || "").trim();
          const instruction = String(rec.instruction || "").trim();
          if (!alias || !instruction) return null;
          return { alias, instruction };
        })
        .filter((v): v is { alias: string; instruction: string } => Boolean(v));
      return {
        done: Boolean(parsed.done),
        executor_prompt: String(parsed.executor_prompt || "").trim(),
        final_answer: String(parsed.final_answer || "").trim(),
        reason: String(parsed.reason || "").trim(),
        handoffs,
      };
    } catch {
      return {
        done: false,
        executor_prompt: text,
        final_answer: "",
        reason: "non_json_controller_output",
        handoffs: [],
      };
    }
  }

  private _extract_provider_error(text: string): string | null {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const low = raw.toLowerCase();
    if (low.startsWith("error calling claude:")) return raw;
    if (low.startsWith("error calling claude_code:")) return raw;
    if (low.startsWith("error calling chatgpt:")) return raw;
    if (low.startsWith("error calling openrouter:")) return raw;
    if (low.startsWith("error calling phi4_local:")) return raw;
    if (low.includes("not logged in")) return raw;
    if (low.includes("please run /login")) return raw;
    if (low.includes("stream disconnected before completion")) return raw;
    return null;
  }

  private async _announce_progress(args: {
    subagent_id: string;
    label: string;
    content: string;
    origin_channel?: string;
    origin_chat_id?: string;
  }): Promise<void> {
    if (!this.bus) return;
    const channel = String(args.origin_channel || "").trim();
    const chat_id = String(args.origin_chat_id || "").trim();
    if (!channel || !chat_id) return;
    await this.bus.publish_outbound({
      id: randomUUID().slice(0, 12),
      provider: channel,
      channel,
      sender_id: `subagent:${args.subagent_id}`,
      chat_id,
      content: `📝 ${args.label}: ${args.content}`,
      at: now_iso(),
      metadata: {
        kind: "subagent_stream",
        subagent_id: args.subagent_id,
      },
    });
  }

  private async _flush_stream_buffer(args: {
    subagent_id: string;
    label: string;
    origin_channel?: string;
    origin_chat_id?: string;
    stream_buffer_ref: () => string;
    clear_stream_buffer: () => void;
  }): Promise<void> {
    const raw = args.stream_buffer_ref();
    const preview = raw.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!preview) return;
    args.clear_stream_buffer();
    await this._announce_progress({
      subagent_id: args.subagent_id,
      label: args.label,
      origin_channel: args.origin_channel,
      origin_chat_id: args.origin_chat_id,
      content: preview,
    });
  }

  private _assistant_tool_call_message(content: string | null, tool_calls: ToolCallRequest[]): ChatMessage {
    return {
      role: "assistant",
      content: content || "",
      tool_calls: tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    };
  }

  private _update_status(id: string, status: SubagentStatus, last_error?: string, last_result?: string): void {
    const prev = this.items.get(id);
    if (!prev) return;
    this.items.set(id, {
      ...prev,
      status,
      last_error,
      last_result,
      updated_at: now_iso(),
    });
  }

  private async _announce_result(args: {
    subagent_id: string;
    task: string;
    label: string;
    content: string;
    origin_channel?: string;
    origin_chat_id?: string;
  }): Promise<void> {
    if (!this.bus) return;
    const inbound: InboundMessage = {
      id: randomUUID().slice(0, 12),
      provider: "system",
      channel: args.origin_channel || "system",
      sender_id: `subagent:${args.subagent_id}`,
      chat_id: args.origin_chat_id || "direct",
      content: [
        `[Subagent ${args.label} done]`,
        `Task: ${args.task}`,
        `Result: ${args.content}`,
      ].join("\n"),
      at: now_iso(),
      metadata: {
        type: "subagent_result",
        subagent_id: args.subagent_id,
      },
    };
    await this.bus.publish_inbound(inbound);
  }

  private async _announce_handoff(args: {
    subagent_id: string;
    alias: string;
    instruction: string;
    origin_channel?: string;
    origin_chat_id?: string;
  }): Promise<void> {
    if (!this.bus) return;
    const channel = String(args.origin_channel || "").trim();
    const chat_id = String(args.origin_chat_id || "").trim();
    if (!channel || !chat_id) return;
    await this.bus.publish_outbound({
      id: randomUUID().slice(0, 12),
      provider: channel,
      channel,
      sender_id: `subagent:${args.subagent_id}`,
      chat_id,
      content: `@${args.alias} ${args.instruction}`,
      at: now_iso(),
      metadata: {
        kind: "subagent_handoff",
        subagent_id: args.subagent_id,
        alias: args.alias,
      },
    });
  }

  private _build_subagent_prompt(options: SpawnSubagentOptions, subagent_id: string): string {
    const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false }).replace(" ", "T");
    const role = options.role || "worker";
    const soul = options.soul || "Calm, pragmatic, collaborative teammate.";
    const heart = options.heart || "Prioritize correctness, safety, and completion.";
    return [
      "# Subagent",
      `id: ${subagent_id}`,
      `now: ${now}+09:00`,
      `role: ${role}`,
      `soul: ${soul}`,
      `heart: ${heart}`,
      `origin_channel: ${options.origin_channel || "system"}`,
      `origin_chat_id: ${options.origin_chat_id || "direct"}`,
      "",
      "You are a focused headless subagent for channel orchestration tasks.",
      "Rules:",
      "1. Complete only the assigned task.",
      "2. Keep output concise and actionable.",
      "3. Use tools when needed, then return final summary.",
      "4. Do not start unrelated work.",
      "5. Keep routing context and return result to origin.",
      "",
      `Assigned task: ${options.task}`,
    ].join("\n");
  }

  private _build_controller_prompt(options: SpawnSubagentOptions, subagent_id: string, contextual_system = ""): string {
    const base = this._build_subagent_prompt(options, subagent_id);
    return [
      base,
      contextual_system ? `\n# ContextBuilder System\n${contextual_system}` : "",
      "",
      "Controller mode:",
      "- You are phi4 orchestrator.",
      "- Decide next single executor turn.",
      "- Return strict JSON only.",
      "Schema:",
      '{"done":boolean,"executor_prompt":"string","final_answer":"string","reason":"string","handoffs":[{"alias":"string","instruction":"string"}]}',
      "- done=true only when the full task is complete.",
      "- executor_prompt must be compact and actionable.",
      "- If collaboration is needed, emit handoffs with @mention-ready alias and instruction.",
    ].join("\n");
  }

  private _build_executor_prompt(options: SpawnSubagentOptions, subagent_id: string, contextual_system = ""): string {
    const base = this._build_subagent_prompt(options, subagent_id);
    return [
      base,
      contextual_system ? `\n# ContextBuilder System\n${contextual_system}` : "",
      "",
      "Executor mode:",
      "- This is a clean single-turn run.",
      "- Execute only the current instruction.",
      "- Return concise result for controller consumption.",
    ].join("\n");
  }
}
