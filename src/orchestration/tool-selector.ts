/** 도구를 키워드 매칭 + 카테고리로 분류하여 요청에 필요한 서브셋만 선택. */

import type { ToolCategory, ToolSchema } from "../agent/tools/types.js";
import type { ToolIndex } from "./tool-index.js";

export type { ToolCategory };

const ALL_CATEGORIES = new Set<string>([
  "filesystem", "shell", "web", "messaging", "file_transfer",
  "scheduling", "memory", "decision", "promise", "secret",
  "diagram", "admin", "spawn", "external", "security", "ai", "data",
]);

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

/** 키워드 기반 도구 선택이 활성화되는 최소 도구 수. 이 미만이면 카테고리 방식 폴백. */
const KEYWORD_SELECTION_THRESHOLD = 30;

export type ToolDefinition = Record<string, unknown>;

export type ToolSelectionResult = {
  tools: ToolDefinition[];
  categories: ToolCategory[];
  /** 키워드 매칭으로 선택된 도구 수 (디버깅용). */
  keyword_matched?: number;
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

/** 분류기 추천 + 키워드 매칭 + 모드 기본값 + 스킬 요구 도구 기반으로 관련 도구 선택. */
export async function select_tools_for_request(
  all_tools: ToolDefinition[],
  request_text: string,
  mode: "once" | "agent" | "task",
  skill_tool_names: string[] = [],
  classifier_categories?: string[],
  tool_category_map?: Record<string, string>,
  classifier_tools?: string[],
  tool_index?: ToolIndex | null,
): Promise<ToolSelectionResult> {
  const effective_map = tool_category_map ?? TOOL_CATEGORIES;

  // 키워드 인덱스가 빌드되어 있고 도구 수가 충분하면 키워드 매칭 사용
  const index = tool_index;
  if (index && index.size >= KEYWORD_SELECTION_THRESHOLD && all_tools.length >= KEYWORD_SELECTION_THRESHOLD) {
    return select_with_keyword_index(
      all_tools, request_text, mode, skill_tool_names,
      classifier_categories, classifier_tools, effective_map, index,
    );
  }

  // 폴백: 카테고리 기반 선택 (기존 로직)
  return select_with_categories(all_tools, mode, skill_tool_names, classifier_categories, effective_map);
}

/** 키워드 인덱스 기반 세밀 도구 선택. */
async function select_with_keyword_index(
  all_tools: ToolDefinition[],
  request_text: string,
  mode: "once" | "agent" | "task",
  skill_tool_names: string[],
  classifier_categories: string[] | undefined,
  classifier_tools: string[] | undefined,
  effective_map: Record<string, string>,
  index: import("./tool-index.js").ToolIndex,
): Promise<ToolSelectionResult> {
  // 스킬이 요구하는 도구는 항상 포함
  const explicit_tools = [...(classifier_tools || []), ...skill_tool_names];

  const selected_names = await index.select(request_text, {
    max_tools: mode === "once" ? 10 : 35,
    mode,
    classifier_tools: explicit_tools,
    classifier_categories,
  });

  // 선택된 도구만 필터
  const tools = all_tools.filter((def) => {
    const name = tool_name_from_def(def);
    return selected_names.has(name);
  });

  // 선택된 도구의 카테고리 수집
  const categories = new Set<ToolCategory>();
  for (const name of selected_names) {
    const cat = effective_map[name] ?? TOOL_CATEGORIES[name] ?? "external";
    if (is_tool_category(cat)) categories.add(cat);
  }

  return { tools, categories: [...categories], keyword_matched: selected_names.size };
}

/** 카테고리 기반 도구 선택 (폴백). */
function select_with_categories(
  all_tools: ToolDefinition[],
  mode: "once" | "agent" | "task",
  skill_tool_names: string[],
  classifier_categories: string[] | undefined,
  effective_map: Record<string, string>,
): ToolSelectionResult {
  const skill_cats = resolve_skill_tool_categories(skill_tool_names, effective_map);

  const base_cats: ReadonlySet<ToolCategory> = classifier_categories?.length
    ? new Set(classifier_categories.filter(is_tool_category))
    : (MODE_DEFAULTS[mode] || MODE_DEFAULTS.agent);

  const selected = new Set<ToolCategory>([...ALWAYS_INCLUDED, ...base_cats, ...skill_cats]);

  const tools = all_tools.filter((def) => {
    const name = tool_name_from_def(def);
    const cat = effective_map[name] ?? TOOL_CATEGORIES[name] ?? "external";
    return is_tool_category(cat) && selected.has(cat);
  });

  return { tools, categories: [...selected] };
}

function tool_name_from_def(def: ToolDefinition): string {
  const fn = def.function as Record<string, unknown> | undefined;
  return String(fn?.name || def.name || "");
}

/** 도구 인덱스를 빌드/갱신. 도구 레지스트리 변경 시 호출. */
export function rebuild_tool_index(
  schemas: ToolSchema[],
  category_map: Record<string, string>,
  db_path?: string,
  tool_index?: ToolIndex | null,
): void {
  tool_index?.build(schemas, category_map, db_path);
}
