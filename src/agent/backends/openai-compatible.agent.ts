/** OpenAI 호환 API(vLLM, Ollama, LM Studio, Together AI 등)를 직접 호출하는 에이전트 백엔드. */

import type { ChatMessage } from "../../providers/types.js";
import { parse_openai_response, sanitize_messages_for_api } from "../../providers/types.js";
import type { ToolExecutionContext } from "../tools/types.js";
import type {
  AgentBackend, AgentBackendId, AgentEventSource,
  AgentRunOptions, AgentRunResult, BackendCapabilities,
} from "../agent.types.js";
import { agent_options_to_chat } from "./convert.js";
import { now_iso, error_message, swallow } from "../../utils/common.js";
import {
  build_executor_map, execute_single_tool, map_finish_reason,
  fire, accum_usage, emit_usage,
  type UsageAccumulator,
} from "./tool-loop-helpers.js";

export type OpenAiCompatibleConfig = {
  api_base: string;
  api_key: string;
  model: string;
  max_tokens?: number;
  temperature?: number;
  request_timeout_ms?: number;
  /** 요청마다 추가할 커스텀 헤더 (OpenRouter HTTP-Referer/X-Title 등). */
  extra_headers?: Record<string, string>;
  /** true면 tool_choice 파라미터를 전송하지 않음. 함수 호출 미지원 모델(일부 Ollama 모델 등)용. */
  no_tool_choice?: boolean;
};

export class OpenAiCompatibleAgent implements AgentBackend {
  readonly native_tool_loop = true;
  readonly supports_resume = false;
  readonly capabilities: BackendCapabilities = {
    approval: false,
    structured_output: false,
    thinking: false,
    budget_tracking: false,
    tool_filtering: false,
    tool_result_events: true,
    send_input: false,
    tool_executors: true,
  };

  constructor(
    readonly id: AgentBackendId,
    private readonly config: OpenAiCompatibleConfig,
  ) {}

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const { messages, chat_options } = agent_options_to_chat(options);
    const emit = options.hooks?.on_event;
    const source: AgentEventSource = { backend: this.id, task_id: options.task_id };

    const executors = build_executor_map(options.tool_executors);
    const tool_ctx: ToolExecutionContext = {
      task_id: options.task_id,
      signal: options.abort_signal,
      ...options.tool_context,
    };

    const tools = (chat_options.tools as Record<string, unknown>[] | undefined) ?? [];

    fire(emit, { type: "init", source, at: now_iso() });

    const conversation: ChatMessage[] = [...messages];
    const max_turns = executors.size > 0 ? (options.max_turns ?? 8) : 1;
    let total_tool_calls = 0;
    const usage: UsageAccumulator = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cost: 0 };

    const on_stream = options.hooks?.on_stream;
    const model_override = options.model || undefined;

    try {
      let raw = await this._call_api(conversation, tools, {
        abort_signal: options.abort_signal,
        max_tokens: options.max_tokens,
        temperature: options.temperature,
        on_stream,
        model_override,
      });
      let parsed = parse_openai_response(raw);
      accum_usage(usage, parsed.usage);

      for (let turn = 1; turn < max_turns; turn++) {
        if (options.abort_signal?.aborted) break;
        if (parsed.tool_calls.length === 0 || executors.size === 0) break;

        total_tool_calls += parsed.tool_calls.length;

        conversation.push({
          role: "assistant",
          content: parsed.content || "",
          tool_calls: parsed.tool_calls.map(tc => ({
            id: tc.id, type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });

        for (const tc of parsed.tool_calls) {
          fire(emit, {
            type: "tool_use", source, at: now_iso(),
            tool_name: tc.name, tool_id: tc.id, params: tc.arguments,
          });

          const result = await execute_single_tool(
            tc.name, tc.arguments || {}, executors, tool_ctx, options.hooks,
          );

          conversation.push({ role: "tool", tool_call_id: tc.id, content: result.text });
          fire(emit, {
            type: "tool_result", source, at: now_iso(),
            tool_name: tc.name, tool_id: tc.id,
            result: result.text, is_error: result.is_error,
          });
        }

        // 도구 사용 후 후속 턴 — on_stream 연속 전달
        raw = await this._call_api(conversation, tools, {
          abort_signal: options.abort_signal,
          max_tokens: options.max_tokens,
          temperature: options.temperature,
          on_stream,
          model_override,
        });
        parsed = parse_openai_response(raw);
        accum_usage(usage, parsed.usage);
      }

      // 최종 응답에 tool_calls가 남아있으면 카운트
      if (parsed.tool_calls.length > 0) {
        total_tool_calls += parsed.tool_calls.length;
        for (const tc of parsed.tool_calls) {
          fire(emit, {
            type: "tool_use", source, at: now_iso(),
            tool_name: tc.name, tool_id: tc.id, params: tc.arguments,
          });
        }
      }

      emit_usage(emit, source, usage);

      const finish = map_finish_reason(parsed.finish_reason);
      fire(emit, {
        type: "complete", source, at: now_iso(),
        finish_reason: finish, content: parsed.content ?? undefined,
      });

      return {
        content: parsed.content,
        session: null,
        tool_calls_count: total_tool_calls,
        usage: {
          prompt_tokens: usage.input,
          completion_tokens: usage.output,
          total_cost_usd: usage.cost || undefined,
        },
        finish_reason: finish,
        metadata: { model: this.config.model },
      };
    } catch (error) {
      const msg = error_message(error);
      fire(emit, { type: "error", source, at: now_iso(), error: msg });
      return {
        content: `Error: ${msg}`,
        session: null,
        tool_calls_count: total_tool_calls,
        usage: {},
        finish_reason: "error",
        metadata: { error: msg },
      };
    }
  }

  is_available(): boolean {
    return Boolean(this.config.api_base);
  }

  private async _call_api(
    messages: ChatMessage[],
    tools: Record<string, unknown>[],
    options?: {
      abort_signal?: AbortSignal;
      max_tokens?: number;
      temperature?: number;
      on_stream?: (chunk: string) => void | Promise<void>;
      /** 채팅 UI 등에서 per-run으로 지정한 모델. config.model보다 우선. */
      model_override?: string;
    },
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.api_base.replace(/\/+$/, "")}/chat/completions`;
    const use_stream = !!options?.on_stream;

    const body: Record<string, unknown> = {
      model: options?.model_override || this.config.model,
      messages: sanitize_messages_for_api(messages),
    };
    if (tools.length > 0) {
      body.tools = tools;
      if (!this.config.no_tool_choice) body.tool_choice = "auto";
    }
    if (use_stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    const max_tokens = options?.max_tokens ?? this.config.max_tokens;
    const temperature = options?.temperature ?? this.config.temperature;
    if (max_tokens !== null && max_tokens !== undefined) body.max_tokens = max_tokens;
    if (temperature !== null && temperature !== undefined) body.temperature = temperature;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.request_timeout_ms ?? 120_000);
    const relay = () => controller.abort();
    options?.abort_signal?.addEventListener("abort", relay, { once: true });

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...this.config.extra_headers,
      };
      if (this.config.api_key) headers["Authorization"] = `Bearer ${this.config.api_key}`;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);

      if (!use_stream) {
        return await res.json() as Record<string, unknown>;
      }

      return await this._parse_sse_stream(res, options.on_stream!);
    } finally {
      clearTimeout(timeout);
      options?.abort_signal?.removeEventListener("abort", relay);
    }
  }

  /** SSE 스트림을 읽어 텍스트·도구 호출을 누적 후 parse_openai_response 호환 객체 반환. */
  private async _parse_sse_stream(
    res: Response,
    on_stream: (chunk: string) => void | Promise<void>,
  ): Promise<Record<string, unknown>> {
    // 인덱스별 도구 호출 버퍼
    type ToolBuf = { id: string; name: string; arguments: string };
    const tool_bufs = new Map<number, ToolBuf>();
    let content = "";
    let finish_reason = "stop";
    let usage: Record<string, number> = {};

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 이벤트는 빈 줄로 구분
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          let chunk: Record<string, unknown>;
          try { chunk = JSON.parse(data) as Record<string, unknown>; }
          catch { continue; }

          const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
          const choice = (choices[0] as Record<string, unknown>) || {};
          const delta = (choice.delta as Record<string, unknown>) || {};

          // 텍스트 delta
          if (typeof delta.content === "string" && delta.content) {
            content += delta.content;
            swallow(on_stream(delta.content));
          }

          // 도구 호출 조각 누적
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls as Record<string, unknown>[]) {
              const idx = typeof tc.index === "number" ? tc.index : 0;
              if (!tool_bufs.has(idx)) {
                tool_bufs.set(idx, { id: "", name: "", arguments: "" });
              }
              const buf = tool_bufs.get(idx)!;
              if (typeof tc.id === "string") buf.id = tc.id;
              const fn = (tc.function as Record<string, unknown>) || {};
              if (typeof fn.name === "string") buf.name += fn.name;
              if (typeof fn.arguments === "string") buf.arguments += fn.arguments;
            }
          }

          if (typeof choice.finish_reason === "string") finish_reason = choice.finish_reason;

          // 최종 청크에 usage 포함 (stream_options.include_usage)
          if (chunk.usage && typeof chunk.usage === "object") {
            usage = chunk.usage as Record<string, number>;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // parse_openai_response 호환 구조로 조합
    const tool_calls = [...tool_bufs.values()].map((buf) => ({
      id: buf.id,
      type: "function",
      function: { name: buf.name, arguments: buf.arguments },
    }));

    return {
      choices: [{
        message: {
          role: "assistant",
          content: content || null,
          ...(tool_calls.length > 0 ? { tool_calls } : {}),
        },
        finish_reason,
      }],
      usage,
    };
  }
}
