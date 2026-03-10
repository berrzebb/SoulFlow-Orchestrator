/** 노드 타입별 프리셋 템플릿 레지스트리. 백엔드/프론트엔드 공유. */

export interface NodePreset {
  node_type: string;
  preset_id: string;
  label: string;
  description: string;
  defaults: Record<string, unknown>;
}

export const BUILTIN_PRESETS: NodePreset[] = [
  // Code
  { node_type: "code", preset_id: "py-csv", label: "Python CSV Parser", description: "CSV -> JSON",
    defaults: { language: "python", code: "import csv, io, json\n\nreader = csv.DictReader(io.StringIO(memory['csv_text']))\nresult = list(reader)\nprint(json.dumps(result))" } },
  { node_type: "code", preset_id: "js-fetch", label: "JS API Client", description: "fetch REST API",
    defaults: { language: "javascript", code: "const res = await fetch(memory.url);\nreturn await res.json();" } },
  { node_type: "code", preset_id: "shell-cmd", label: "Shell Command", description: "shell command",
    defaults: { language: "shell", code: "echo 'Hello'" } },
  // HTTP
  { node_type: "http", preset_id: "rest-get", label: "REST GET", description: "JSON API GET",
    defaults: { url: "", method: "GET", headers: { Accept: "application/json" } } },
  { node_type: "http", preset_id: "rest-post", label: "REST POST", description: "JSON API POST",
    defaults: { url: "", method: "POST", headers: { "Content-Type": "application/json" } } },
  // LLM
  { node_type: "llm", preset_id: "summarize", label: "Summarizer", description: "text summarization",
    defaults: { backend: "openrouter", prompt_template: "Summarize:\n\n{{memory.text}}", temperature: 0.3 } },
  { node_type: "llm", preset_id: "translate", label: "Translator", description: "translation",
    defaults: { backend: "openrouter", prompt_template: "Translate to {{memory.lang}}:\n\n{{memory.text}}", temperature: 0.2 } },
  { node_type: "llm", preset_id: "classify", label: "Classifier", description: "structured classification",
    defaults: { backend: "openrouter", prompt_template: "Classify:\n{{memory.text}}", temperature: 0, output_json_schema: { type: "object", properties: { category: { type: "string" } } } } },
  // Analyzer
  { node_type: "analyzer", preset_id: "sentiment", label: "Sentiment", description: "sentiment analysis",
    defaults: { backend: "openrouter", prompt_template: "Analyze sentiment:\n\n{{input}}", input_field: "text", categories: ["positive", "negative", "neutral"] } },
  // Notify
  { node_type: "notify", preset_id: "origin-reply", label: "Origin Reply", description: "reply to trigger channel",
    defaults: { content: "{{memory.result}}", target: "origin" } },
  // Template
  { node_type: "template", preset_id: "md-report", label: "Markdown Report", description: "report generation",
    defaults: { template: "# Report\n\n{{memory.summary}}" } },
  // DB
  { node_type: "db", preset_id: "sql-select", label: "SQL SELECT", description: "data query",
    defaults: { operation: "query", query: "SELECT * FROM {{memory.table}}" } },

  // ── AI Agent role presets ──
  { node_type: "ai_agent", preset_id: "agent-researcher", label: "Researcher", description: "web search + information gathering agent",
    defaults: {
      backend: "openrouter",
      system_prompt: "You are a research specialist. Search for information, verify facts from multiple sources, and compile comprehensive findings. Always cite your sources and distinguish between confirmed facts and inferences.",
      user_prompt: "{{memory.query}}",
      max_turns: 15,
    } },
  { node_type: "ai_agent", preset_id: "agent-code-reviewer", label: "Code Reviewer", description: "code review + improvement suggestions",
    defaults: {
      backend: "openrouter",
      system_prompt: "You are an expert code reviewer. Analyze code for bugs, security vulnerabilities, performance issues, and maintainability. Provide specific, actionable feedback with corrected code examples. Focus on critical issues first.",
      user_prompt: "Review this code:\n\n{{memory.code}}",
      max_turns: 5,
    } },
  { node_type: "ai_agent", preset_id: "agent-writer", label: "Content Writer", description: "document/blog/report authoring",
    defaults: {
      backend: "openrouter",
      system_prompt: "You are a skilled technical writer. Create clear, well-structured content adapted to the target audience. Use appropriate formatting (headings, lists, code blocks) and maintain a consistent tone throughout.",
      user_prompt: "{{memory.writing_task}}",
      max_turns: 5,
    } },
  { node_type: "ai_agent", preset_id: "agent-data-analyst", label: "Data Analyst", description: "data analysis + insight extraction",
    defaults: {
      backend: "openrouter",
      system_prompt: "You are a data analyst. Analyze datasets, identify patterns and trends, compute statistics, and present findings with clear visualizations descriptions. Always validate data quality before analysis.",
      user_prompt: "Analyze:\n\n{{memory.data}}",
      max_turns: 10,
      output_json_schema: { type: "object", properties: { summary: { type: "string" }, insights: { type: "array", items: { type: "string" } }, metrics: { type: "object" } } },
    } },
  { node_type: "ai_agent", preset_id: "agent-planner", label: "Task Planner", description: "task decomposition + execution planning",
    defaults: {
      backend: "openrouter",
      system_prompt: "You are a project planner. Break down complex objectives into concrete, actionable tasks with clear dependencies, priorities, and success criteria. Estimate effort and identify risks for each task.",
      user_prompt: "Plan: {{memory.objective}}",
      max_turns: 5,
      output_json_schema: { type: "object", properties: { tasks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, priority: { type: "string" }, depends_on: { type: "array", items: { type: "string" } } } } } } },
    } },
  { node_type: "ai_agent", preset_id: "agent-qa", label: "QA Tester", description: "test case generation + verification",
    defaults: {
      backend: "openrouter",
      system_prompt: "You are a QA engineer. Generate comprehensive test cases covering happy paths, edge cases, error scenarios, and boundary conditions. Verify outputs against expected behavior and report discrepancies with reproduction steps.",
      user_prompt: "Test: {{memory.feature}}",
      max_turns: 10,
    } },
  { node_type: "ai_agent", preset_id: "agent-translator", label: "Translator Agent", description: "multilingual translation (context-aware)",
    defaults: {
      backend: "openrouter",
      system_prompt: "You are a professional translator. Translate content while preserving tone, cultural nuances, and technical terminology. For ambiguous terms, choose the most contextually appropriate translation. Keep code identifiers, URLs, and proper nouns untranslated.",
      user_prompt: "Translate to {{memory.target_language}}:\n\n{{memory.text}}",
      max_turns: 3,
      temperature: 0.2,
    } },
  { node_type: "ai_agent", preset_id: "agent-critic", label: "Critic / Evaluator", description: "output quality evaluation + feedback",
    defaults: {
      backend: "openrouter",
      system_prompt: "You are a critical evaluator. Assess the quality, accuracy, and completeness of the given output against the original requirements. Score on a 1-10 scale with specific justification. Suggest concrete improvements for any score below 8.",
      user_prompt: "Evaluate:\n\nRequirements: {{memory.requirements}}\n\nOutput: {{memory.output}}",
      max_turns: 3,
      output_json_schema: { type: "object", properties: { score: { type: "number" }, passed: { type: "boolean" }, feedback: { type: "string" }, improvements: { type: "array", items: { type: "string" } } } },
    } },

  // ── Spawn Agent role presets ──
  { node_type: "spawn_agent", preset_id: "spawn-researcher", label: "Spawn Researcher", description: "research sub-agent",
    defaults: { task: "{{memory.query}}", role: "generalist", await_completion: true, max_iterations: 15 } },
  { node_type: "spawn_agent", preset_id: "spawn-coder", label: "Spawn Coder", description: "coding sub-agent",
    defaults: { task: "{{memory.coding_task}}", role: "implementer", await_completion: true, max_iterations: 20 } },
  { node_type: "spawn_agent", preset_id: "spawn-reviewer", label: "Spawn Reviewer", description: "review sub-agent",
    defaults: { task: "Review: {{memory.output}}", role: "reviewer", await_completion: true, max_iterations: 5 } },
];

export function get_presets_for_type(node_type: string): NodePreset[] {
  return BUILTIN_PRESETS.filter((p) => p.node_type === node_type);
}

export function get_preset(preset_id: string): NodePreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.preset_id === preset_id);
}

/** 에이전트 역할 프리셋만 추출 (ai_agent + spawn_agent). */
export function get_agent_role_presets(): NodePreset[] {
  return BUILTIN_PRESETS.filter((p) => p.node_type === "ai_agent" || p.node_type === "spawn_agent");
}

/** 프리셋 카탈로그 텍스트 생성 (LLM 프롬프트 주입용). */
export function build_preset_catalog(node_type?: string): string {
  const presets = node_type ? get_presets_for_type(node_type) : BUILTIN_PRESETS;
  if (!presets.length) return "";

  const by_type = new Map<string, NodePreset[]>();
  for (const p of presets) {
    const list = by_type.get(p.node_type) || [];
    list.push(p);
    by_type.set(p.node_type, list);
  }

  const sections: string[] = [];
  for (const [type, items] of by_type) {
    const lines = items.map((p) => `  - ${p.preset_id}: "${p.label}" — ${p.description}`);
    sections.push(`${type}:\n${lines.join("\n")}`);
  }

  return `## Available Presets\n\n${sections.join("\n\n")}`;
}
