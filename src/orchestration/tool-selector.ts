/** 도구를 카테고리로 분류하여 요청에 필요한 서브셋만 선택. */

type ToolCategory = "filesystem" | "shell" | "web" | "messaging" | "scheduling" | "memory" | "decision" | "promise" | "secret" | "diagram" | "admin" | "spawn";

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  read_file: "filesystem",
  write_file: "filesystem",
  edit_file: "filesystem",
  list_dir: "filesystem",
  exec: "shell",
  web_search: "web",
  web_fetch: "web",
  web_browser: "web",
  message: "messaging",
  request_file: "messaging",
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
};

/** 항상 포함되는 카테고리. */
const ALWAYS_INCLUDED: ReadonlySet<ToolCategory> = new Set(["messaging"]);

/** 모드별 기본 포함 카테고리. */
const MODE_DEFAULTS: Record<string, ReadonlySet<ToolCategory>> = {
  once: new Set(["scheduling", "memory", "decision", "promise", "secret", "messaging", "diagram"]),
  agent: new Set(["filesystem", "shell", "web", "messaging", "scheduling", "memory", "decision", "promise", "secret", "diagram", "spawn"]),
  task: new Set(["filesystem", "shell", "web", "messaging", "scheduling", "memory", "decision", "promise", "secret", "diagram", "spawn", "admin"]),
};

type KeywordRule = { pattern: RegExp; categories: ToolCategory[] };

const KEYWORD_RULES: KeywordRule[] = [
  { pattern: /(파일|file|read|write|edit|디렉토리|directory|folder)/i, categories: ["filesystem"] },
  { pattern: /(실행|execute|run|shell|bash|command|명령|커맨드|스크립트|script)/i, categories: ["shell"] },
  { pattern: /(검색|search|web|url|fetch|browse|크롤|crawl|사이트|site|http)/i, categories: ["web"] },
  { pattern: /(cron|크론|스케줄|schedule|예약|알림|remind|매일|매주|every|periodic)/i, categories: ["scheduling"] },
  { pattern: /(메모리|memory|기억|longterm|daily|검색.*메모|메모.*검색)/i, categories: ["memory"] },
  { pattern: /(결정|decision|지침|정책|policy|규칙|rule)/i, categories: ["decision"] },
  { pattern: /(약속|promise|제약|constraint|금지|prohibit|하지.*않|never)/i, categories: ["promise"] },
  { pattern: /(시크릿|secret|비밀|암호|password|token|key|credential)/i, categories: ["secret"] },
  { pattern: /(다이어그램|diagram|mermaid|svg|차트|chart|그래프|graph|시각화|visualize)/i, categories: ["diagram"] },
  { pattern: /(에이전트|agent|spawn|서브|sub.*agent|백그라운드|background)/i, categories: ["spawn"] },
  { pattern: /(도구|tool|admin|설치|install|mcp|서버|server)/i, categories: ["admin"] },
];

export type ToolDefinition = Record<string, unknown>;

export type ToolSelectionResult = {
  tools: ToolDefinition[];
  categories: ToolCategory[];
};

/** 도구 이름으로부터 카테고리를 역매핑. */
function resolve_skill_tool_categories(tool_names: string[]): Set<ToolCategory> {
  const out = new Set<ToolCategory>();
  for (const name of tool_names) {
    const cat = TOOL_CATEGORIES[name];
    if (cat) out.add(cat);
  }
  return out;
}

/** 요청 텍스트, 실행 모드, 스킬 요구 도구에 따라 관련 도구만 선택. */
export function select_tools_for_request(
  all_tools: ToolDefinition[],
  request_text: string,
  mode: "once" | "agent" | "task",
  skill_tool_names: string[] = [],
): ToolSelectionResult {
  const detected = detect_categories(request_text);
  const skill_cats = resolve_skill_tool_categories(skill_tool_names);

  // once 모드: 키워드도 스킬 도구도 없으면 도구 없이 직접 응답
  if (mode === "once" && detected.size === 0 && skill_cats.size === 0) {
    return { tools: [], categories: [] };
  }

  const mode_defaults = MODE_DEFAULTS[mode] || MODE_DEFAULTS.agent;
  const selected = new Set<ToolCategory>([...ALWAYS_INCLUDED, ...detected, ...skill_cats]);

  if (detected.size === 0 && skill_cats.size === 0) {
    for (const cat of mode_defaults) selected.add(cat);
  }

  // once 모드: messaging 제외 — 최종 응답은 deliver_result이 전송
  if (mode === "once") selected.delete("messaging");

  const tools = all_tools.filter((def) => {
    const name = String((def as Record<string, unknown>).name || tool_name_from_def(def));
    const category = TOOL_CATEGORIES[name];
    if (!category) return true;
    return selected.has(category);
  });

  return { tools, categories: [...selected] };
}

function detect_categories(text: string): Set<ToolCategory> {
  const out = new Set<ToolCategory>();
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(text)) {
      for (const cat of rule.categories) out.add(cat);
    }
  }
  return out;
}

function tool_name_from_def(def: ToolDefinition): string {
  const fn = def.function as Record<string, unknown> | undefined;
  return String(fn?.name || def.name || "");
}
