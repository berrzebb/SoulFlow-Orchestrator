import { dedupe_tool_calls, parse_tool_calls_from_text, parse_tool_calls_from_unknown } from "../agent/tool-call-parser.js";
import { escape_regexp } from "../utils/common.js";
import type { ChatMessage, ToolCallRequest } from "./types.js";

export const OUTPUT_BLOCK_START = "<<ORCH_FINAL>>";
export const OUTPUT_BLOCK_END = "<<ORCH_FINAL_END>>";
export const TOOL_BLOCK_START = "<<ORCH_TOOL_CALLS>>";
export const TOOL_BLOCK_END = "<<ORCH_TOOL_CALLS_END>>";
export const DEFAULT_CAPTURE_MAX_CHARS = 500_000;
export const DEFAULT_STREAM_STATE_MAX_CHARS = 200_000;

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
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      return `[${role}] ${content}`;
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
  return extract_last_block(raw, OUTPUT_BLOCK_START, OUTPUT_BLOCK_END);
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

function extract_last_block(raw: string, start_marker: string, end_marker: string): string {
  const text = String(raw || "");
  if (!text) return "";
  const escapedStart = escape_regexp(start_marker);
  const escapedEnd = escape_regexp(end_marker);
  const re = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, "g");
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
  return String(raw || "")
    .replace(new RegExp(escape_regexp(OUTPUT_BLOCK_START), "g"), "")
    .replace(new RegExp(escape_regexp(OUTPUT_BLOCK_END), "g"), "")
    .replace(new RegExp(escape_regexp(TOOL_BLOCK_START), "g"), "")
    .replace(new RegExp(escape_regexp(TOOL_BLOCK_END), "g"), "")
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
  state: { last_full_text: string },
): { delta?: string; final?: string } {
  const type = as_string(event.type).toLowerCase();
  if (!type) return {};

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
  const block = extract_last_block(raw, TOOL_BLOCK_START, TOOL_BLOCK_END);
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
    const final_block = extract_last_block(final_from_json, TOOL_BLOCK_START, TOOL_BLOCK_END);
    if (final_block) {
      const parsed = parse_tool_calls_from_text(final_block);
      if (parsed.length > 0) return parsed;
    }
    const parsed = parse_tool_calls_from_text(final_from_json);
    if (parsed.length > 0) return parsed;
  }

  const final_from_protocol = extract_protocol_output(raw);
  if (final_from_protocol) {
    const protocol_block = extract_last_block(final_from_protocol, TOOL_BLOCK_START, TOOL_BLOCK_END);
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
