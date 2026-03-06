/** 도구를 카테고리로 분류하여 요청에 필요한 서브셋만 선택. */

import type { ToolCategory } from "../agent/tools/types.js";
export type { ToolCategory };

const ALL_CATEGORIES = new Set<string>(["filesystem", "shell", "web", "messaging", "file_transfer", "scheduling", "memory", "decision", "promise", "secret", "diagram", "admin", "spawn", "external"]);

function is_tool_category(v: string): v is ToolCategory {
  return ALL_CATEGORIES.has(v);
}

/** @deprecated 레지스트리 기반 category_map 사용 권장. 하위 호환 폴백용. */
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  read_file: "filesystem",
  write_file: "filesystem",
  edit_file: "filesystem",
  list_dir: "filesystem",
  search_files: "filesystem",
  exec: "shell",
  web_search: "web",
  web_fetch: "web",
  web_browser: "web",
  web_snapshot: "web",
  web_extract: "web",
  web_pdf: "web",
  web_monitor: "web",
  message: "messaging",
  request_file: "file_transfer",
  send_file: "file_transfer",
  cron: "scheduling",
  memory: "memory",
  decision: "decision",
  promise: "promise",
  secret: "secret",
  diagram: "diagram",
  diagram_render: "diagram",
  runtime_admin: "admin",
  spawn: "spawn",
  chain: "admin",
  datetime: "memory",
  http_request: "web",
  oauth_fetch: "web",
  task_query: "admin",
};

/** 항상 포함되는 카테고리. */
const ALWAYS_INCLUDED: ReadonlySet<ToolCategory> = new Set(["messaging", "file_transfer"]);

/** 모드별 기본 포함 카테고리. */
const MODE_DEFAULTS: Record<string, ReadonlySet<ToolCategory>> = {
  once: new Set(["web", "scheduling", "memory", "decision", "promise", "secret", "messaging", "file_transfer", "diagram"]),
  agent: new Set(["filesystem", "shell", "web", "messaging", "file_transfer", "scheduling", "memory", "decision", "promise", "secret", "diagram", "spawn", "external"]),
  task: new Set(["filesystem", "shell", "web", "messaging", "file_transfer", "scheduling", "memory", "decision", "promise", "secret", "diagram", "spawn", "admin", "external"]),
};


export type ToolDefinition = Record<string, unknown>;

export type ToolSelectionResult = {
  tools: ToolDefinition[];
  categories: ToolCategory[];
};

/** 도구 이름으로부터 카테고리를 역매핑. */
function resolve_skill_tool_categories(
  tool_names: string[],
  category_map: Record<string, string>,
): Set<ToolCategory> {
  const out = new Set<ToolCategory>();
  for (const name of tool_names) {
    const cat = category_map[name] ?? TOOL_CATEGORIES[name] ?? "external";
    if (is_tool_category(cat)) out.add(cat);
  }
  return out;
}

/** 분류기 추천 + 모드 기본값 + 스킬 요구 도구 기반으로 관련 도구 선택. */
export function select_tools_for_request(
  all_tools: ToolDefinition[],
  _request_text: string,
  mode: "once" | "agent" | "task",
  skill_tool_names: string[] = [],
  classifier_categories?: string[],
  tool_category_map?: Record<string, string>,
): ToolSelectionResult {
  const effective_map = tool_category_map ?? TOOL_CATEGORIES;
  const skill_cats = resolve_skill_tool_categories(skill_tool_names, effective_map);

  // 분류기가 추천한 카테고리가 있으면 우선 사용, 없으면 모드 기본값 폴백
  const base_cats: ReadonlySet<ToolCategory> = classifier_categories?.length
    ? new Set(classifier_categories.filter(is_tool_category))
    : (MODE_DEFAULTS[mode] || MODE_DEFAULTS.agent);

  const selected = new Set<ToolCategory>([...ALWAYS_INCLUDED, ...base_cats, ...skill_cats]);

  const tools = all_tools.filter((def) => {
    const name = String((def as Record<string, unknown>).name || tool_name_from_def(def));
    const cat = effective_map[name] ?? TOOL_CATEGORIES[name] ?? "external";
    return is_tool_category(cat) && selected.has(cat);
  });

  return { tools, categories: [...selected] };
}

function tool_name_from_def(def: ToolDefinition): string {
  const fn = def.function as Record<string, unknown> | undefined;
  return String(fn?.name || def.name || "");
}
