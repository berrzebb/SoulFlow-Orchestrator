import { dedupe_tool_calls, parse_tool_calls_from_text, parse_tool_calls_from_unknown } from "../agent/tool-call-parser.js";
import type { ChatMessage, ToolCallRequest } from "./types.js";
import type { StreamEvent } from "../channels/stream-event.js";

export const OUTPUT_BLOCK_START = "<<ORCH_FINAL>>";
export const OUTPUT_BLOCK_END = "<<ORCH_FINAL_END>>";
export const TOOL_BLOCK_START = "<<ORCH_TOOL_CALLS>>";
export const TOOL_BLOCK_END = "<<ORCH_TOOL_CALLS_END>>";
export const DEFAULT_CAPTURE_MAX_CHARS = 500_000;
export const DEFAULT_STREAM_STATE_MAX_CHARS = 200_000;

/** 프로토콜 마커 regex — 리터럴로 선언하여 모듈 로드 시 1회 컴파일. */
const RE_OUTPUT_START = /<<ORCH_FINAL>>/g;
const RE_OUTPUT_END = /<<ORCH_FINAL_END>>/g;
const RE_TOOL_START = /<<ORCH_TOOL_CALLS>>/g;
const RE_TOOL_END = /<<ORCH_TOOL_CALLS_END>>/g;
const RE_OUTPUT_BLOCK = /<<ORCH_FINAL>>([\s\S]*?)<<ORCH_FINAL_END>>/g;
const RE_TOOL_BLOCK = /<<ORCH_TOOL_CALLS>>([\s\S]*?)<<ORCH_TOOL_CALLS_END>>/g;

function compact_tool_catalog(tools: Record<string, unknown>[]): string {
  return tools
    .slice(0, 32)
    .map((row) => {
      const rec = (row && typeof row === "object") ? (row as Record<string, unknown>) : {};
      const fn = (rec.function && typeof rec.function === "object")
        ? (rec.function as Record<string, unknown>)
        : {};
      const name = String(fn.name || "").trim();
      if (!name) return "";
      const description = String(fn.description || "").trim();
      const parameters = (fn.parameters && typeof fn.parameters === "object")
        ? (fn.parameters as Record<string, unknown>)
        : {};
      const props_obj = (parameters.properties && typeof parameters.properties === "object")
        ? (parameters.properties as Record<string, unknown>)
        : {};
      const properties = Object.keys(props_obj).slice(0, 20);
      const required = Array.isArray(parameters.required)
        ? parameters.required.map((v) => String(v)).slice(0, 20)
        : [];
      return JSON.stringify({
        name,
        description: description || "",
        properties,
        required,
      });
    })
    .filter(Boolean)
    .join("\n");
}

export function messages_to_prompt(messages: ChatMessage[], tools?: Record<string, unknown>[] | null): string {
  const base = messages
    .map((m) => {
      const role = String(m.role || "user").toUpperCase();
      let content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      // assistant가 tool_call을 했을 때 content는 null이지만 tool_calls 정보는 유지해야 함.
      // 누락 시 다음 turn에서 LLM이 맥락을 잃고 같은 tool을 반복 호출함.
      if (Array.isArray((m as Record<string, unknown>).tool_calls)) {
        const tcs = (m as Record<string, unknown>).tool_calls as Array<Record<string, unknown>>;
        const calls = tcs.map((tc) => {
          const fn = tc.function as Record<string, unknown> | undefined;
          const name = String(fn?.name ?? tc.name ?? "");
          const args = fn?.arguments ?? tc.arguments ?? {};
          const id = String(tc.id ?? "");
          // id 포함 → [TOOL id=call_1] 결과와 매핑 가능
          return `called[${id}]: ${name}(${typeof args === "string" ? args : JSON.stringify(args)})`;
        }).join(", ");
        content = content ? `${content} [${calls}]` : `[${calls}]`;
      }
      // tool 응답에도 call_id 표시 → 어느 호출의 결과인지 LLM이 추적 가능
      const call_id = String((m as Record<string, unknown>).tool_call_id ?? "");
      return call_id
        ? `[${role} id=${call_id}] ${content}`
        : `[${role}] ${content}`;
    })
    .join("\n\n");
  const has_tools = Array.isArray(tools) && tools.length > 0;
  const tool_protocol = has_tools
    ? [
      "",
      "[TOOLS]",
      "If a tool is required, return only this exact block with valid JSON:",
      TOOL_BLOCK_START,
      '{"tool_calls":[{"id":"call_1","name":"tool_name","arguments":{"key":"value"}}]}',
      TOOL_BLOCK_END,
      "Otherwise, return the final answer block.",
      "Available tools (compact):",
      compact_tool_catalog(tools || []) || "(none)",
    ].join("\n")
    : "";
  const protocol = [
    "",
    "[SYSTEM]",
    has_tools
      ? "Return either a TOOL block or FINAL block. Never return both in one response."
      : "Return only the final user-facing answer wrapped in the exact block below.",
    "Start your response with the start marker immediately, stream the answer body, then close with end marker.",
    "Do not include execution logs, shell commands, env vars, or debug info.",
    OUTPUT_BLOCK_START,
    "<final answer>",
    OUTPUT_BLOCK_END,
  ].join("\n");
  return `${base}${tool_protocol}\n${protocol}`.trim();
}

export function extract_protocol_output(raw: string): string {
  return extract_last_block_re(String(raw || ""), RE_OUTPUT_BLOCK);
}

export function extract_protocol_partial(raw: string): string {
  const text = String(raw || "");
  if (!text) return "";
  const start_idx = text.indexOf(OUTPUT_BLOCK_START);
  if (start_idx < 0) return "";
  const body_start = start_idx + OUTPUT_BLOCK_START.length;
  const end_idx = text.indexOf(OUTPUT_BLOCK_END, body_start);
  if (end_idx >= 0) return text.slice(body_start, end_idx);
  return text.slice(body_start);
}

function extract_last_block_re(text: string, re: RegExp): string {
  if (!text) return "";
  re.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let last = "";
  while (true) {
    match = re.exec(text);
    if (!match) break;
    last = String(match[1] || "").trim();
  }
  return last;
}

export function strip_protocol_markers(raw: string): string {
  RE_OUTPUT_START.lastIndex = RE_OUTPUT_END.lastIndex = RE_TOOL_START.lastIndex = RE_TOOL_END.lastIndex = 0;
  return String(raw || "")
    .replace(RE_OUTPUT_START, "")
    .replace(RE_OUTPUT_END, "")
    .replace(RE_TOOL_START, "")
    .replace(RE_TOOL_END, "")
    .trim();
}

export function strip_protocol_scaffold(raw: string): string {
  const text = strip_protocol_markers(raw).replace(/\r/g, "");
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (/^\[SYSTEM\]$/i.test(t)) return false;
      if (/^Return only the final user-facing answer wrapped in the exact block below\.?$/i.test(t)) return false;
      if (/^Start your response with the start marker immediately/i.test(t)) return false;
      if (/^Do not include execution logs, shell commands, env vars, or debug info\.?$/i.test(t)) return false;
      if (/^Return either a TOOL block or FINAL block/i.test(t)) return false;
      if (/^If a tool is required, return only this exact block/i.test(t)) return false;
      if (/^Otherwise, return the final answer block\.?$/i.test(t)) return false;
      if (/^Available tools \(compact\):$/i.test(t)) return false;
      if (/^<final answer>$/i.test(t)) return false;
      return true;
    });
  return lines.join("\n").trim();
}

function as_string(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function collect_text_deep(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 16)
      .map((v) => collect_text_deep(v, depth + 1))
      .filter(Boolean)
      .join("");
  }
  if (!value || typeof value !== "object") return "";
  const rec = value as Record<string, unknown>;
  const direct = as_string(rec.text) || as_string(rec.value);
  if (direct) return direct;
  // string delta (OpenAI Responses API: { delta: "text" })
  if (typeof rec.delta === "string" && rec.delta) return rec.delta;
  if (rec.delta && typeof rec.delta === "object") {
    const d = rec.delta as Record<string, unknown>;
    const delta_text = as_string(d.text) || as_string(d.value);
    if (delta_text) return delta_text;
  }
  if (rec.message && typeof rec.message === "object") {
    const message = rec.message as Record<string, unknown>;
    const from_message = collect_text_deep(message.content, depth + 1) || as_string(message.text);
    if (from_message) return from_message;
  }
  if (rec.content) {
    const from_content = collect_text_deep(rec.content, depth + 1);
    if (from_content) return from_content;
  }
  return "";
}

export function parse_json_line(line: string): Record<string, unknown> | null {
  const raw = String(line || "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extract_json_event_text(
  event: Record<string, unknown>,
  state: { last_full_text: string; metadata?: Record<string, unknown> },
): { delta?: string; final?: string } {
  const type = as_string(event.type).toLowerCase();

  // OpenAI Chat Completions 스트리밍: { object: "chat.completion.chunk", choices: [{ delta: { content: "..." } }] }
  // type 필드 없음 — choices[].delta.content 구조로 식별 (OpenAI 호환 모든 프로바이더 공통)
  if (!type && Array.isArray(event.choices)) {
    const first = (event.choices[0] as Record<string, unknown>) || {};
    const finish_reason = as_string(first.finish_reason);
    const delta = (first.delta as Record<string, unknown>) || {};
    const content = as_string(delta.content);
    if (event.model) { state.metadata = state.metadata || {}; state.metadata.model = String(event.model); }
    if (event.id) { state.metadata = state.metadata || {}; state.metadata.session_id = String(event.id); }
    if (content) {
      state.last_full_text += content;
      return { delta: content };
    }
    if (finish_reason === "stop" || finish_reason === "tool_calls") {
      return state.last_full_text ? { final: state.last_full_text } : {};
    }
    return {};
  }

  if (!type) return {};

  // init/system 이벤트에서 session_id, model 등 메타데이터 캡처
  if (type === "init" || type === "system" || type === "session.created") {
    state.metadata = state.metadata || {};
    if (event.session_id) state.metadata.session_id = String(event.session_id);
    if (event.model) state.metadata.model = String(event.model);
    if (event.thread_id) state.metadata.thread_id = String(event.thread_id);
    return {};
  }

  // Gemini CLI: message 이벤트 — role=assistant인 청크만 추출
  if (type === "message" && as_string(event.role).toLowerCase() === "assistant") {
    const full = strip_protocol_markers(collect_text_deep(event));
    if (!full) return {};
    let delta = full;
    if (state.last_full_text && full.startsWith(state.last_full_text)) {
      delta = full.slice(state.last_full_text.length);
    }
    state.last_full_text = full;
    return { delta, final: full };
  }

  // Gemini CLI: result 이벤트 — response 필드에 최종 응답
  if (type === "result") {
    const response = as_string(event.response);
    if (!response) return {};
    const full = strip_protocol_markers(response);
    if (!full) return {};
    let delta = full;
    if (state.last_full_text && full.startsWith(state.last_full_text)) {
      delta = full.slice(state.last_full_text.length);
    }
    state.last_full_text = full;
    return { delta, final: full };
  }

  if (type === "item.completed" && event.item && typeof event.item === "object") {
    const item = event.item as Record<string, unknown>;
    const item_type = as_string(item.type).toLowerCase();
    const text = collect_text_deep(item);
    if (!text) return {};
    if (item_type === "agent_message" || item_type === "assistant_message" || item_type === "message") {
      const full = strip_protocol_markers(text);
      if (!full) return {};
      let delta = full;
      if (state.last_full_text && full.startsWith(state.last_full_text)) {
        delta = full.slice(state.last_full_text.length);
      }
      state.last_full_text = full;
      return { delta, final: full };
    }
    if (item_type === "reasoning") return {};
  }

  if (type.includes("delta")) {
    const delta = collect_text_deep(event);
    if (delta && delta.trim()) return { delta };
    return {};
  }

  if (type.includes("message.completed") || type === "assistant") {
    const full = strip_protocol_markers(collect_text_deep(event));
    if (!full) return {};
    let delta = full;
    if (state.last_full_text && full.startsWith(state.last_full_text)) {
      delta = full.slice(state.last_full_text.length);
    }
    state.last_full_text = full;
    return { delta, final: full };
  }

  return {};
}

export function extract_final_from_json_output(raw: string): string {
  const state = { last_full_text: "" };
  let out = "";
  const lines = String(raw || "").split(/\r?\n/g);
  for (const line of lines) {
    const parsed = parse_json_line(line);
    if (!parsed) continue;
    const extracted = extract_json_event_text(parsed, state);
    if (extracted.final && extracted.final.trim()) out = extracted.final.trim();
  }
  return out;
}

function parse_tool_calls_from_json_events(raw: string): ToolCallRequest[] {
  const out: ToolCallRequest[] = [];
  const lines = String(raw || "").split(/\r?\n/g);
  for (const line of lines) {
    const parsed = parse_json_line(line);
    if (!parsed) continue;
    const from_line = parse_tool_calls_from_unknown(parsed);
    for (const row of from_line) out.push(row);
  }
  return dedupe_tool_calls(out).slice(0, 32);
}

export function parse_tool_calls_from_output(raw: string): ToolCallRequest[] {
  const block = extract_last_block_re(String(raw || ""), RE_TOOL_BLOCK);
  const out: ToolCallRequest[] = [];
  if (block) {
    const from_block = parse_tool_calls_from_text(block);
    for (const row of from_block) out.push(row);
  }
  if (out.length > 0) return dedupe_tool_calls(out).slice(0, 32);

  const from_events = parse_tool_calls_from_json_events(raw);
  if (from_events.length > 0) return from_events;

  const final_from_json = extract_final_from_json_output(raw);
  if (final_from_json) {
    const final_block = extract_last_block_re(final_from_json, RE_TOOL_BLOCK);
    if (final_block) {
      const parsed = parse_tool_calls_from_text(final_block);
      if (parsed.length > 0) return parsed;
    }
    const parsed = parse_tool_calls_from_text(final_from_json);
    if (parsed.length > 0) return parsed;
  }

  const final_from_protocol = extract_protocol_output(raw);
  if (final_from_protocol) {
    const protocol_block = extract_last_block_re(final_from_protocol, RE_TOOL_BLOCK);
    if (protocol_block) {
      const parsed = parse_tool_calls_from_text(protocol_block);
      if (parsed.length > 0) return parsed;
    }
    const parsed = parse_tool_calls_from_text(final_from_protocol);
    if (parsed.length > 0) return parsed;
  }

  return [];
}

export const __cli_provider_test__ = {
  parse_tool_calls_from_output,
};

// ── 통합 NDJSON → StreamEvent 변환 ──

/** 모든 프로바이더의 NDJSON 파싱 공유 상태. */
export type NdjsonConverterState = {
  /** Gemini 등 누적 텍스트 방식 프로바이더용 — 마지막 완전한 텍스트 스냅샷. */
  last_full_text: string;
  metadata?: Record<string, unknown>;
  /** OpenAI Chat Completions tool call streaming: index → 진행 중인 도구 호출. */
  pending_tool_calls?: Map<number, { id: string; name: string; args_buf: string }>;
};

/**
 * 임의 프로바이더 NDJSON 라인 → StreamEvent[].
 * OpenAI(Chat Completions / Responses API), Gemini, Codex, 범용 delta 형식 처리.
 * 새 프로바이더 추가 시 이 함수에만 케이스를 추가하면 처리부 변경 불필요.
 */
export function ndjson_to_stream_events(
  event: Record<string, unknown>,
  state: NdjsonConverterState,
): StreamEvent[] {
  const type = as_string(event.type).toLowerCase();

  // === OpenAI Chat Completions: { choices: [{ delta: {...} }] } (type 필드 없음) ===
  if (!type && Array.isArray(event.choices)) {
    return _openai_chat_chunk_to_events(event, state);
  }
  if (!type) return [];

  // 메타데이터 캡처 (init/session)
  if (type === "init" || type === "system" || type === "session.created") {
    state.metadata = state.metadata || {};
    if (event.session_id) state.metadata.session_id = String(event.session_id);
    if (event.model) state.metadata.model = String(event.model);
    if (event.thread_id) state.metadata.thread_id = String(event.thread_id);
    return [];
  }

  // === OpenAI Responses API: response.output_text.delta → { delta: "text" } ===
  if (type === "response.output_text.delta") {
    const delta = as_string(event.delta);
    if (delta) { state.last_full_text += delta; return [{ type: "delta", content: delta }]; }
    return [];
  }

  // === OpenAI Responses API: response.completed → usage ===
  if (type === "response.completed") {
    const resp = (event.response as Record<string, unknown>) || {};
    const u = (resp.usage as Record<string, unknown>) || {};
    const input = Number(u.input_tokens || 0), output = Number(u.output_tokens || 0);
    return (input || output) ? [{ type: "usage", input, output }] : [];
  }

  // === Gemini CLI: message(role=assistant) ===
  if (type === "message" && as_string(event.role).toLowerCase() === "assistant") {
    const full = strip_protocol_markers(collect_text_deep(event));
    if (!full) return [];
    const delta = state.last_full_text && full.startsWith(state.last_full_text) ? full.slice(state.last_full_text.length) : full;
    state.last_full_text = full;
    return delta ? [{ type: "delta", content: delta }] : [];
  }

  // === Gemini CLI: result ===
  if (type === "result") {
    const response = as_string(event.response);
    if (!response) return [];
    const full = strip_protocol_markers(response);
    if (!full) return [];
    const delta = state.last_full_text && full.startsWith(state.last_full_text) ? full.slice(state.last_full_text.length) : full;
    state.last_full_text = full;
    return delta ? [{ type: "delta", content: delta }] : [];
  }

  // === Codex / OpenAI Responses API: item.completed ===
  if (type === "item.completed" && event.item && typeof event.item === "object") {
    const item = event.item as Record<string, unknown>;
    const item_type = as_string(item.type).toLowerCase();
    if (item_type === "agent_message" || item_type === "assistant_message" || item_type === "message") {
      const full = strip_protocol_markers(collect_text_deep(item));
      if (!full) return [];
      const delta = state.last_full_text && full.startsWith(state.last_full_text) ? full.slice(state.last_full_text.length) : full;
      state.last_full_text = full;
      return delta ? [{ type: "delta", content: delta }] : [];
    }
    return [];
  }

  // === 범용: type에 "delta" 포함 ===
  if (type.includes("delta")) {
    const str_delta = as_string(event.delta);
    if (str_delta) { state.last_full_text += str_delta; return [{ type: "delta", content: str_delta }]; }
    const text = collect_text_deep(event);
    return (text && text.trim()) ? [{ type: "delta", content: text }] : [];
  }

  // === 범용: message.completed / assistant 완료 이벤트 ===
  if (type.includes("message.completed") || type === "assistant") {
    const full = strip_protocol_markers(collect_text_deep(event));
    if (!full) return [];
    const delta = state.last_full_text && full.startsWith(state.last_full_text) ? full.slice(state.last_full_text.length) : full;
    state.last_full_text = full;
    return delta ? [{ type: "delta", content: delta }] : [];
  }

  return [];
}

/** OpenAI Chat Completions 청크 → StreamEvent[]. tool call streaming 누적 포함. */
function _openai_chat_chunk_to_events(
  event: Record<string, unknown>,
  state: NdjsonConverterState,
): StreamEvent[] {
  const events: StreamEvent[] = [];
  if (event.model) { state.metadata = state.metadata || {}; state.metadata.model = String(event.model); }
  if (event.id) { state.metadata = state.metadata || {}; state.metadata.session_id = String(event.id); }

  const choices = Array.isArray(event.choices) ? event.choices : [];
  const first = (choices[0] as Record<string, unknown>) || {};
  const finish_reason = as_string(first.finish_reason);
  const delta = (first.delta as Record<string, unknown>) || {};

  const content = as_string(delta.content);
  if (content) { state.last_full_text += content; events.push({ type: "delta", content }); }

  // tool call 인자 누적 — finish_reason=tool_calls에서 완성
  if (Array.isArray(delta.tool_calls)) {
    state.pending_tool_calls = state.pending_tool_calls || new Map();
    for (const tc of delta.tool_calls as Record<string, unknown>[]) {
      const idx = Number(tc.index ?? 0);
      const fn = (tc.function as Record<string, unknown>) || {};
      const pending = state.pending_tool_calls.get(idx) ?? { id: as_string(tc.id) || `call_${idx}`, name: "", args_buf: "" };
      if (as_string(tc.id)) pending.id = as_string(tc.id);
      if (as_string(fn.name)) pending.name = as_string(fn.name);
      pending.args_buf += as_string(fn.arguments);
      state.pending_tool_calls.set(idx, pending);
    }
  }
  if (finish_reason === "tool_calls" && state.pending_tool_calls?.size) {
    for (const [, tc] of state.pending_tool_calls) {
      let params: Record<string, unknown> = {};
      try { params = JSON.parse(tc.args_buf) as Record<string, unknown>; } catch { /* 불완전 args */ }
      events.push({ type: "tool_start", id: tc.id, name: tc.name, params });
    }
    state.pending_tool_calls.clear();
  }

  // 최종 청크 usage
  if (event.usage && typeof event.usage === "object") {
    const u = event.usage as Record<string, unknown>;
    const input = Number(u.prompt_tokens || 0), output = Number(u.completion_tokens || 0);
    if (input || output) events.push({ type: "usage", input, output });
  }
  return events;
}
