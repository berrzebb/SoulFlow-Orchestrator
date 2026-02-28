import type { ParsedSlashCommand } from "./slash-command.js";
import { slash_name_in, slash_token_in } from "./slash-command.js";

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

export function strip_leading_mentions_and_aliases(text: string): string {
  let out = String(text || "").trim();
  if (!out) return "";
  for (let i = 0; i < 3; i += 1) {
    const next = out
      .replace(/^<@!?[A-Za-z0-9]+>\s*/i, "")
      .replace(/^[@＠][A-Za-z0-9._-]+\s*/i, "")
      .replace(/^(?:assistant|sebastian|bot|오케스트레이터|에이전트)\s*[:,]?\s*/i, "")
      .trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

export function normalize_common_command_text(content: string): string {
  const stripped = strip_leading_mentions_and_aliases(String(content || ""));
  return stripped.replace(/\s+/g, " ").trim();
}

export function has_explicit_memory_intent(text_raw: string): boolean {
  const text = normalize_common_command_text(text_raw).toLowerCase();
  if (!text || text.startsWith("/")) return false;
  return /(메모리\s*(상태|확인|조회|검색|목록)|현재\s*메모리|memory\s*(status|state|search|list))/i.test(text);
}

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
  if (/^(?:메모리|memory)\s*(?:상태|status|state|확인|조회)?$/.test(text)) return "status";
  if (/^(?:메모리|memory)\s*(?:목록|list|리스트)$/.test(text)) return "list";
  if (/^(?:오늘\s*메모리|메모리\s*오늘|memory\s*today)$/.test(text)) return "today";
  if (/^(?:장기\s*메모리|메모리\s*장기|memory\s*longterm|longterm\s*memory)$/.test(text)) return "longterm";
  if (/^(?:메모리|memory)\s*(?:검색|search)\b/.test(text)) return "search";
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
  const m = text.match(/^(?:메모리|memory)\s*(?:검색|search)\s+(.+)$/i);
  if (!m) return "";
  return String(m[1] || "").trim();
}

export type StatusQuickAction = "tools" | "skills" | "overview";

export function has_explicit_status_intent(text_raw: string): boolean {
  const text = normalize_common_command_text(text_raw).toLowerCase();
  if (!text || text.startsWith("/")) return false;
  return /(?:사용\s*(?:가능|할\s*수\s*있는)|현재|available|list)\s*(?:도구|스킬|tool|skill|기능|능력|command|명령)/i.test(text)
    || /(?:도구|스킬|tool|skill|기능|능력|command|명령)\s*(?:목록|리스트|list|알려|뭐가?\s*있|어떤|뭐야|뭡니까|는\??)/i.test(text)
    || /(?:뭐\s*(?:할\s*수\s*있|할수있|도와줄\s*수)|무엇을?\s*할\s*수\s*있|what\s*can\s*you\s*do)/i.test(text);
}

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

  if (/(?:도구|tool|command|명령)/i.test(text)) return "tools";
  if (/(?:스킬|skill|기능|능력)/i.test(text)) return "skills";
  if (has_explicit_status_intent(text_raw)) return "overview";
  return null;
}

export function has_explicit_decision_intent(text_raw: string): boolean {
  const text = normalize_common_command_text(text_raw).toLowerCase();
  if (!text || text.startsWith("/")) return false;
  return /(현재\s*(지침|정책)|결정\s*사항\s*(확인|조회|목록|리스트)|정책\s*(확인|조회|목록|수정|변경)|decision\s*(status|list|show|set)|policy\s*(status|list|show|set))/i.test(text);
}

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
  if (/^(?:현재\s*)?(?:지침|정책)(?:은|는|이|가)?\s*\??$/.test(text)) return "status";
  if (/(?:결정\s*사항|지침|정책)\s*(?:상태|확인|조회|목록|리스트)/.test(text)) return "list";
  if (/^(?:decision|policy)\s*(?:status|state|list|show)\b/.test(text)) return "list";
  if (/(?:지침|정책|결정\s*사항)\s*(?:수정|변경|업데이트)/.test(text)) return "set";
  if (/^(?:decision|policy)\s*set\b/.test(text)) return "set";
  return null;
}

export function parse_decision_set_pair(raw: string): { key: string; value: string } | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const eq = text.match(/^([^=:=]{1,120})\s*[:=]\s*(.+)$/);
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
  const m = text.match(/^(?:지침|정책|결정\s*사항)\s*(?:수정|변경|업데이트)\s*[:：]?\s*(.+)$/i)
    || text.match(/^(?:decision|policy)\s*set\s+(.+)$/i);
  if (!m) return null;
  return parse_decision_set_pair(String(m[1] || ""));
}
