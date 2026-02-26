import type { ToolCallRequest } from "../providers/index.js";

function as_tool_arguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function normalize_tool_call(rec_raw: unknown, idx: number): ToolCallRequest | null {
  if (!rec_raw || typeof rec_raw !== "object" || Array.isArray(rec_raw)) return null;
  const rec = rec_raw as Record<string, unknown>;
  const fn = (rec.function && typeof rec.function === "object" && !Array.isArray(rec.function))
    ? (rec.function as Record<string, unknown>)
    : null;
  const name = String(
    rec.name
    || rec.tool_name
    || rec.toolName
    || rec.function_name
    || rec.functionName
    || fn?.name
    || "",
  ).trim();
  if (!name) return null;
  const id = String(
    rec.id
    || rec.call_id
    || rec.callId
    || rec.tool_call_id
    || rec.toolCallId
    || `call_${idx + 1}`,
  ).trim() || `call_${idx + 1}`;
  const args_raw = rec.arguments ?? rec.args ?? rec.input ?? rec.params ?? fn?.arguments ?? {};
  return { id, name, arguments: as_tool_arguments(args_raw) };
}

function collect_tool_calls_from_value(raw: unknown, out: ToolCallRequest[], state: { idx: number }, depth = 0): void {
  if (depth > 8 || !raw) return;
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const normalized = normalize_tool_call(row, state.idx++);
      if (normalized) out.push(normalized);
      collect_tool_calls_from_value(row, out, state, depth + 1);
    }
    return;
  }
  if (typeof raw !== "object") return;
  const rec = raw as Record<string, unknown>;
  const direct = normalize_tool_call(rec, state.idx++);
  if (direct) out.push(direct);

  const likely_lists = [
    rec.tool_calls,
    rec.toolCalls,
    rec.calls,
    rec.output,
    rec.items,
    rec.messages,
  ];
  for (const list of likely_lists) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const normalized = normalize_tool_call(row, state.idx++);
      if (normalized) out.push(normalized);
    }
  }

  for (const [key, row] of Object.entries(rec)) {
    if (key === "function" && direct) continue;
    if (!row || typeof row !== "object") continue;
    collect_tool_calls_from_value(row, out, state, depth + 1);
  }
}

export function dedupe_tool_calls(rows: ToolCallRequest[]): ToolCallRequest[] {
  const out: ToolCallRequest[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.name}|${JSON.stringify(row.arguments || {})}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function parse_tool_calls_from_unknown(raw: unknown): ToolCallRequest[] {
  const out: ToolCallRequest[] = [];
  collect_tool_calls_from_value(raw, out, { idx: 0 }, 0);
  return dedupe_tool_calls(out).slice(0, 32);
}

function extract_json_fenced_block(raw: string): string | null {
  const text = String(raw || "");
  if (!text.trim()) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) return null;
  return fenced[1].trim() || null;
}

function extract_last_between_markers(text: string, start_marker: string, end_marker: string): string | null {
  const start = text.lastIndexOf(start_marker);
  if (start < 0) return null;
  const body_start = start + start_marker.length;
  const end = text.indexOf(end_marker, body_start);
  if (end < 0) return null;
  const body = text.slice(body_start, end).trim();
  return body || null;
}

function extract_balanced_json_from(text: string, start_index: number): string | null {
  if (start_index < 0 || start_index >= text.length) return null;
  const opener = text[start_index];
  if (opener !== "{" && opener !== "[") return null;
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let in_string = false;
  let escaping = false;
  for (let i = start_index; i < text.length; i += 1) {
    const ch = text[i];
    if (in_string) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === "\"") {
        in_string = false;
      }
      continue;
    }
    if (ch === "\"") {
      in_string = true;
      continue;
    }
    if (ch === opener) {
      depth += 1;
      continue;
    }
    if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start_index, i + 1);
      }
    }
  }
  return null;
}

function extract_balanced_candidates_around_keyword(text: string, keyword: string, max_scan = 10): string[] {
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = text.indexOf(keyword, cursor);
    if (idx < 0) break;
    cursor = idx + keyword.length;

    let scan_count = 0;
    let start = idx;
    while (scan_count < max_scan) {
      const brace = text.lastIndexOf("{", start);
      const bracket = text.lastIndexOf("[", start);
      const candidate_start = Math.max(brace, bracket);
      if (candidate_start < 0) break;
      const candidate = extract_balanced_json_from(text, candidate_start);
      if (candidate && candidate.includes(keyword)) {
        out.push(candidate.trim());
        break;
      }
      start = candidate_start - 1;
      scan_count += 1;
    }
  }
  return out;
}

export function parse_tool_calls_from_text(raw: string | null | undefined): ToolCallRequest[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  const candidates: string[] = [];
  const marker_block = extract_last_between_markers(text, "<<ORCH_TOOL_CALLS>>", "<<ORCH_TOOL_CALLS_END>>");
  if (marker_block) candidates.push(marker_block);
  const fenced = extract_json_fenced_block(text);
  if (fenced) candidates.push(fenced);
  if (text.startsWith("{") || text.startsWith("[")) candidates.push(text);
  for (const candidate of extract_balanced_candidates_around_keyword(text, "\"tool_calls\"")) {
    candidates.push(candidate);
  }
  for (const candidate of extract_balanced_candidates_around_keyword(text, "\"id\":\"call_")) {
    candidates.push(candidate);
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const calls = parse_tool_calls_from_unknown(parsed);
      if (calls.length > 0) return calls;
    } catch {
      // try next candidate
    }
  }
  return [];
}
