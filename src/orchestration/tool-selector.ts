/** 도구를 카테고리로 분류하여 요청에 필요한 서브셋만 선택. */

type ToolCategory = "filesystem" | "shell" | "web" | "messaging" | "file_transfer" | "scheduling" | "memory" | "decision" | "promise" | "secret" | "diagram" | "admin" | "spawn" | "external";

export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  read_file: "filesystem",
  write_file: "filesystem",
  edit_file: "filesystem",
  list_dir: "filesystem",
  exec: "shell",
  web_search: "web",
  web_fetch: "web",
  web_browser: "web",
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
  once: new Set(["scheduling", "memory", "decision", "promise", "secret", "messaging", "file_transfer", "diagram"]),
  agent: new Set(["filesystem", "shell", "web", "messaging", "file_transfer", "scheduling", "memory", "decision", "promise", "secret", "diagram", "spawn", "external"]),
  task: new Set(["filesystem", "shell", "web", "messaging", "file_transfer", "scheduling", "memory", "decision", "promise", "secret", "diagram", "spawn", "admin", "external"]),
};


export type ToolDefinition = Record<string, unknown>;

export type ToolSelectionResult = {
  tools: ToolDefinition[];
  categories: ToolCategory[];
};

/** 도구 이름으로부터 카테고리를 역매핑. */
function resolve_skill_tool_categories(tool_names: string[]): Set<ToolCategory> {
  const out = new Set<ToolCategory>();
  for (const name of tool_names) {
    out.add(TOOL_CATEGORIES[name] ?? "external");
  }
  return out;
}

/** 모드 기본값 + 스킬 요구 도구 기반으로 관련 도구 선택. 키워드 정규식 없음 — Phi-4 분류에 위임. */
export function select_tools_for_request(
  all_tools: ToolDefinition[],
  _request_text: string,
  mode: "once" | "agent" | "task",
  skill_tool_names: string[] = [],
): ToolSelectionResult {
  const skill_cats = resolve_skill_tool_categories(skill_tool_names);
  const mode_defaults = MODE_DEFAULTS[mode] || MODE_DEFAULTS.agent;
  const selected = new Set<ToolCategory>([...ALWAYS_INCLUDED, ...mode_defaults, ...skill_cats]);

  const tools = all_tools.filter((def) => {
    const name = String((def as Record<string, unknown>).name || tool_name_from_def(def));
    const category = TOOL_CATEGORIES[name] ?? "external";
    return selected.has(category);
  });

  return { tools, categories: [...selected] };
}

function tool_name_from_def(def: ToolDefinition): string {
  const fn = def.function as Record<string, unknown> | undefined;
  return String(fn?.name || def.name || "");
}
