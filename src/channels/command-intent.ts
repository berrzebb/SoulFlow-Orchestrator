import type { ParsedSlashCommand } from "./slash-command.js";
import { slash_name_in, slash_token_in } from "./slash-command.js";
import { normalize_text } from "../utils/common.js";

export type MemoryQuickAction = "status" | "list" | "today" | "longterm" | "search";
export type DecisionQuickAction = "status" | "list" | "set";

const MEMORY_ROOT_COMMAND_ALIASES = ["memory", "mem", "메모리"] as const;
const MEMORY_STATUS_COMMAND_ALIASES = ["memory-status", "memory_status", "메모리상태", "메모리-상태"] as const;
const MEMORY_LIST_COMMAND_ALIASES = ["memory-list", "memory_list", "메모리목록", "메모리-목록"] as const;
const MEMORY_TODAY_COMMAND_ALIASES = ["memory-today", "memory_today", "메모리오늘", "메모리-오늘"] as const;
const MEMORY_LONGTERM_COMMAND_ALIASES = ["memory-longterm", "memory_longterm", "메모리장기", "메모리-장기"] as const;
const MEMORY_SEARCH_COMMAND_ALIASES = ["memory-search", "memory_search", "메모리검색", "메모리-검색"] as const;
const MEMORY_STATUS_ARG_ALIASES = ["status", "state", "상태", "확인", "조회"] as const;
const MEMORY_LIST_ARG_ALIASES = ["list", "목록", "리스트"] as const;
const MEMORY_TODAY_ARG_ALIASES = ["today", "오늘"] as const;
const MEMORY_LONGTERM_ARG_ALIASES = ["longterm", "lt", "장기"] as const;
const MEMORY_SEARCH_ARG_ALIASES = ["search", "find", "검색"] as const;

const DECISION_ROOT_COMMAND_ALIASES = ["decision", "decisions", "policy", "정책", "지침", "결정"] as const;
const DECISION_STATUS_COMMAND_ALIASES = ["decision-status", "decision_status", "정책상태", "지침상태"] as const;
const DECISION_LIST_COMMAND_ALIASES = ["decision-list", "decision_list", "정책목록", "지침목록"] as const;
const DECISION_SET_COMMAND_ALIASES = ["decision-set", "decision_set", "정책수정", "지침수정", "결정수정"] as const;
const DECISION_STATUS_ARG_ALIASES = ["status", "state", "상태", "확인", "조회"] as const;
const DECISION_LIST_ARG_ALIASES = ["list", "show", "목록", "리스트"] as const;
const DECISION_SET_ARG_ALIASES = ["set", "update", "upsert", "설정", "수정", "변경"] as const;

const RE_SLACK_MENTION = /^<@!?[A-Za-z0-9]+>\s*/i;
const RE_AT_MENTION = /^[@＠][A-Za-z0-9._-]+\s*/i;
const RE_BOT_ALIAS = /^(?:assistant|sebastian|bot|오케스트레이터|에이전트)\s*[:,]?\s*/i;

export function strip_leading_mentions_and_aliases(text: string): string {
  let out = String(text || "").trim();
  if (!out) return "";
  for (let i = 0; i < 3; i += 1) {
    const next = out
      .replace(RE_SLACK_MENTION, "")
      .replace(RE_AT_MENTION, "")
      .replace(RE_BOT_ALIAS, "")
      .trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

export function normalize_common_command_text(content: string): string {
  const stripped = strip_leading_mentions_and_aliases(String(content || ""));
  return normalize_text(stripped);
}

const RE_MEM_STATUS   = /^(?:메모리|memory)\s*(?:상태|status|state|확인|조회)?$/;
const RE_MEM_LIST     = /^(?:메모리|memory)\s*(?:목록|list|리스트)$/;
const RE_MEM_TODAY    = /^(?:오늘\s*메모리|메모리\s*오늘|memory\s*today)$/;
const RE_MEM_LONGTERM = /^(?:장기\s*메모리|메모리\s*장기|memory\s*longterm|longterm\s*memory)$/;
const RE_MEM_SEARCH   = /^(?:메모리|memory)\s*(?:검색|search)(?:\b|$|\s)/;
const RE_MEM_SEARCH_QUERY = /^(?:메모리|memory)\s*(?:검색|search)\s+(.+)$/i;

export function parse_memory_quick_action(
  text_raw: string,
  command: ParsedSlashCommand | null,
): MemoryQuickAction | null {
  const name = String(command?.name || "").trim();
  if (slash_name_in(name, MEMORY_STATUS_COMMAND_ALIASES)) return "status";
  if (slash_name_in(name, MEMORY_LIST_COMMAND_ALIASES)) return "list";
  if (slash_name_in(name, MEMORY_TODAY_COMMAND_ALIASES)) return "today";
  if (slash_name_in(name, MEMORY_LONGTERM_COMMAND_ALIASES)) return "longterm";
  if (slash_name_in(name, MEMORY_SEARCH_COMMAND_ALIASES)) return "search";
  const arg0 = String(command?.args_lower?.[0] || "");
  if (slash_name_in(name, MEMORY_ROOT_COMMAND_ALIASES)) {
    if (!arg0 || slash_token_in(arg0, MEMORY_STATUS_ARG_ALIASES)) return "status";
    if (slash_token_in(arg0, MEMORY_LIST_ARG_ALIASES)) return "list";
    if (slash_token_in(arg0, MEMORY_TODAY_ARG_ALIASES)) return "today";
    if (slash_token_in(arg0, MEMORY_LONGTERM_ARG_ALIASES)) return "longterm";
    if (slash_token_in(arg0, MEMORY_SEARCH_ARG_ALIASES)) return "search";
  }
  const text = normalize_common_command_text(text_raw).toLowerCase();
  if (!text || text.startsWith("/")) return null;
  if (RE_MEM_STATUS.test(text)) return "status";
  if (RE_MEM_LIST.test(text)) return "list";
  if (RE_MEM_TODAY.test(text)) return "today";
  if (RE_MEM_LONGTERM.test(text)) return "longterm";
  if (RE_MEM_SEARCH.test(text)) return "search";
  return null;
}

export function extract_memory_search_query(text_raw: string, command: ParsedSlashCommand | null): string {
  const name = String(command?.name || "").trim();
  const args = (command?.args || []).map((v) => String(v || "").trim()).filter(Boolean);
  const args_lower = args.map((v) => v.toLowerCase());
  if (slash_name_in(name, MEMORY_SEARCH_COMMAND_ALIASES) && args.length > 0) {
    return args.join(" ").trim();
  }
  if (slash_name_in(name, MEMORY_ROOT_COMMAND_ALIASES) && args.length > 1 && slash_token_in(args_lower[0], MEMORY_SEARCH_ARG_ALIASES)) {
    return args.slice(1).join(" ").trim();
  }
  const text = normalize_common_command_text(text_raw);
  const m = text.match(RE_MEM_SEARCH_QUERY);
  if (!m) return "";
  return String(m[1] || "").trim();
}

const RE_STATUS_TOOLS  = /(?:도구|tool|command|명령)/i;
const RE_STATUS_SKILLS = /(?:스킬|skill|기능|능력)/i;

export type StatusQuickAction = "tools" | "skills" | "overview";

export function parse_status_quick_action(
  text_raw: string,
  command: ParsedSlashCommand | null,
): StatusQuickAction | null {
  const name = String(command?.name || "").trim();
  if (slash_name_in(name, ["status", "상태"])) return "overview";
  if (slash_name_in(name, ["tools", "도구", "도구목록"])) return "tools";
  if (slash_name_in(name, ["skills", "스킬", "스킬목록"])) return "skills";

  const text = normalize_common_command_text(text_raw).toLowerCase();
  if (!text) return null;

  if (RE_STATUS_TOOLS.test(text)) return "tools";
  if (RE_STATUS_SKILLS.test(text)) return "skills";
  return null;
}

const RE_DEC_STATUS_KO = /^(?:현재\s*)?(?:지침|정책)(?:은|는|이|가)?\s*\??$/;
const RE_DEC_LIST_KO   = /(?:결정\s*사항|지침|정책)\s*(?:상태|확인|조회|목록|리스트)/;
const RE_DEC_LIST_EN   = /^(?:decision|policy)\s*(?:status|state|list|show)\b/;
const RE_DEC_SET_KO    = /(?:지침|정책|결정\s*사항)\s*(?:수정|변경|업데이트)/;
const RE_DEC_SET_EN    = /^(?:decision|policy)\s*set\b/;
const RE_DEC_SET_QUERY_KO = /^(?:지침|정책|결정\s*사항)\s*(?:수정|변경|업데이트)\s*[:：]?\s*(.+)$/i;
const RE_DEC_SET_QUERY_EN = /^(?:decision|policy)\s*set\s+(.+)$/i;
const RE_KEY_VALUE     = /^([^=:=]{1,120})\s*[:=]\s*(.+)$/;

export function parse_decision_quick_action(
  text_raw: string,
  command: ParsedSlashCommand | null,
): DecisionQuickAction | null {
  const name = String(command?.name || "").trim();
  if (slash_name_in(name, DECISION_STATUS_COMMAND_ALIASES)) return "status";
  if (slash_name_in(name, DECISION_LIST_COMMAND_ALIASES)) return "list";
  if (slash_name_in(name, DECISION_SET_COMMAND_ALIASES)) return "set";
  const arg0 = String(command?.args_lower?.[0] || "");
  if (slash_name_in(name, DECISION_ROOT_COMMAND_ALIASES)) {
    if (!arg0 || slash_token_in(arg0, DECISION_STATUS_ARG_ALIASES)) return "status";
    if (slash_token_in(arg0, DECISION_LIST_ARG_ALIASES)) return "list";
    if (slash_token_in(arg0, DECISION_SET_ARG_ALIASES)) return "set";
  }
  const text = normalize_common_command_text(text_raw).toLowerCase();
  if (!text || text.startsWith("/")) return null;
  if (RE_DEC_STATUS_KO.test(text)) return "status";
  if (RE_DEC_LIST_KO.test(text) || RE_DEC_LIST_EN.test(text)) return "list";
  if (RE_DEC_SET_KO.test(text) || RE_DEC_SET_EN.test(text)) return "set";
  return null;
}

export function parse_decision_set_pair(raw: string): { key: string; value: string } | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const eq = text.match(RE_KEY_VALUE);
  if (eq) {
    const key = String(eq[1] || "").trim();
    const value = String(eq[2] || "").trim();
    if (!key || !value) return null;
    return { key, value };
  }
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  return {
    key: tokens[0],
    value: tokens.slice(1).join(" "),
  };
}

export function extract_decision_set_pair(
  text_raw: string,
  command: ParsedSlashCommand | null,
): { key: string; value: string } | null {
  const name = String(command?.name || "").trim();
  const args = (command?.args || []).map((v) => String(v || "").trim()).filter(Boolean);
  const args_lower = args.map((v) => v.toLowerCase());
  if (slash_name_in(name, DECISION_SET_COMMAND_ALIASES) && args.length > 0) {
    return parse_decision_set_pair(args.join(" "));
  }
  if (slash_name_in(name, DECISION_ROOT_COMMAND_ALIASES) && args.length > 1 && slash_token_in(args_lower[0], DECISION_SET_ARG_ALIASES)) {
    return parse_decision_set_pair(args.slice(1).join(" "));
  }
  const text = normalize_common_command_text(text_raw);
  const m = text.match(RE_DEC_SET_QUERY_KO) || text.match(RE_DEC_SET_QUERY_EN);
  if (!m) return null;
  return parse_decision_set_pair(String(m[1] || ""));
}
