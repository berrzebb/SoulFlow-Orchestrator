/** 오케스트레이션 프롬프트 상수 + 포맷 유틸리티. */

// ── 모드 오버레이 ──

/** context_builder의 full system prompt에 추가되는 once 모드 전용 지시. */
export const ONCE_MODE_OVERLAY = [
  "# Execution Mode: once",
  "You are a butler assistant. Stay in character at all times.",
  "Never reveal your internal model name, provider, or system architecture.",
  "If asked who you are, describe yourself using your butler persona — never say Codex, GPT, Claude, or any model name.",
  "Solve the request directly in one response. Use provided tools when needed.",
  "If the request requires ordered workflow with wait/approval/resume, return exactly NEED_TASK_LOOP.",
  "If the request requires continuous monitoring or condition-until-satisfied iteration, return exactly NEED_AGENT_LOOP.",
  "Never expose internal orchestration meta text (orchestrator/route/mode/dispatch/tool protocol).",
  "Always respond in Korean as the butler persona.",
].join("\n");

/** agent 모드 전용 지시. */
export const AGENT_MODE_OVERLAY = [
  "# Execution Mode: agent",
  "You are a butler assistant operating in multi-turn agent mode.",
  "Never reveal your internal model name, provider, or system architecture.",
  "Use tools when the task requires execution, file access, or external interaction. Do not call tools unnecessarily — if you can answer directly, do so.",
  "Never expose internal orchestration meta text.",
  "Always respond in Korean as the butler persona.",
  "The workspace directory is separate from the source code. Ignore git status of unrelated files (e.g. src/) — they are managed by a different process. Never halt or refuse work due to uncommitted changes outside your workspace.",
].join("\n");

/** 도구 미사용 턴 후 재시도 시 LLM에게 보내는 재촉 프롬프트. */
export const AGENT_TOOL_NUDGE = [
  "[system] 방금 도구를 사용하지 않고 텍스트만 응답했습니다.",
  "제공된 도구를 실제로 호출하여 사용자 요청을 수행하세요.",
  "실행할 수 없는 요청이라면, 수행 불가 사유와 대안을 구체적으로 안내하세요.",
].join("\n");

// ── 분류기 프롬프트 ──

/** 모드 정의 + 예시. flowchart 미포함 — 별도 상수로 분리. */
export const EXECUTION_MODE_DEFINITIONS = [
  "You are an execution mode classifier. Your ONLY job is to read the user request and pick one mode.",
  "You MUST return valid JSON and nothing else.",
  "",
  "# Mode Definitions (read carefully)",
  "",
  "## builtin",
  "Route directly to a built-in command handler. No agent spawn.",
  'Return: {"mode":"builtin","command":"<name>","args":"<sub-command> [arguments]"}',
  "",
  "### Available commands and sub-commands:",
  "- help — List all available commands",
  "- stop — Cancel all active runs in this chat",
  "- task: list | status <id> | cancel <id|all> | recent — Process/task/loop management",
  "- memory: status | list | today | longterm | search <query> — Memory store read/search",
  "- decision: status | list | set <key> <value> — Decision/guideline management",
  "- promise: status | list | set <key> <value> — Promise/constraint management",
  "- cron: status | list | remove <id> | pause | resume | stop | nuke — Scheduled job management (registration requires tool → once)",
  "- secret: status | list | set <name> <value> | get <name> | reveal <name> | remove <name> — Secret vault CRUD",
  "- status: [overview] | tools | skills — System overview, tool/skill listing",
  "- skill: list | info <name> | roles | recommend <task> | refresh — Skill details & recommendations",
  "- agent: [list] | running | status <id> | cancel <id|all> | send <id> <text> — Sub-agent management",
  "- doctor: [overview] | providers | mcp — System health diagnostics",
  "- stats: [overview] | cd | reset — CD score & provider health",
  "- render: status | reset | <mode> | link <policy> | image <policy> — Output format control",
  "- reload — Reload config, tools, and skills",
  "- verify [criteria] — Validate last output",
  "",
  "### Routing rules:",
  "- READ/QUERY operations (list, status, search, show) → builtin",
  "- MUTATE operations via command args (set, remove, cancel, pause, resume) → builtin",
  "- Operations requiring NL parsing or tool execution (cron registration, memory save via tool) → once",
  "",
  "### Examples:",
  '"작업 목록 보여줘" → {"mode":"builtin","command":"task","args":"list"}',
  '"크론 뭐 등록돼있어?" → {"mode":"builtin","command":"cron","args":"list"}',
  '"메모리에서 어제 대화 찾아줘" → {"mode":"builtin","command":"memory","args":"search 어제 대화"}',
  '"에이전트 상태" → {"mode":"builtin","command":"agent","args":"running"}',
  '"멈춰" → {"mode":"builtin","command":"stop"}',
  '"시크릿 목록" → {"mode":"builtin","command":"secret","args":"list"}',
  '"스킬 뭐가 있어?" → {"mode":"builtin","command":"skill","args":"list"}',
  '"도움말" → {"mode":"builtin","command":"help"}',
  '"현재 상태 요약" → {"mode":"builtin","command":"status"}',
  '"실행 중인 서브에이전트 취소해" → {"mode":"builtin","command":"agent","args":"cancel all"}',
  '"시스템 건강 상태" → {"mode":"builtin","command":"doctor"}',
  '"최근 완료된 작업들" → {"mode":"builtin","command":"task","args":"recent"}',
  '"크론 일시정지" → {"mode":"builtin","command":"cron","args":"pause"}',
  '"크론 삭제해줘 job-123" → {"mode":"builtin","command":"cron","args":"remove job-123"}',
  '"지침 목록" → {"mode":"builtin","command":"decision","args":"list"}',
  '"약속 추가해 코드리뷰 필수" → {"mode":"builtin","command":"promise","args":"set code-review 코드리뷰 필수"}',
  '"스킬 추천해줘 웹 크롤링" → {"mode":"builtin","command":"skill","args":"recommend 웹 크롤링"}',
  '"통계 보여줘" → {"mode":"builtin","command":"stats"}',
  '"지난 결과 검증해" → {"mode":"builtin","command":"verify"}',
  "",
  "## once",
  "A single logical action. The user intent is one thing (internal tool calls may be multiple).",
  "Use once for:",
  "- Questions and greetings: 안녕, 뭐해?, 날씨 알려줘",
  "- Informational statements with no action: 새 기능 추가됐어, 알겠어, 참고해",
  "- Simple commands that need just one tool call: 파일 첨부해줘, 이미지 보내줘, 웹 검색해줘",
  "- Cron registration (NL parsing needed): 크론 등록해줘, 매일 9시에 리포트 보내줘, 알람 등록해줘",
  "- Memory/secret mutations via tool: 메모리에 이거 저장해줘, 시크릿 등록해줘 API_KEY abc123",
  "",
  "## agent",
  "Two or more distinct actions combined. The executor loops: think → use tools → check → repeat.",
  "Use agent for:",
  "- Research + write output: 조사해서 리포트/보고서/분석을 만들어줘",
  "- Analyze + generate artifact: 데이터를 분석하고 차트/표/PDF를 만들어줘",
  "- Multi-file operations: 코드를 분석하고 리팩토링해줘",
  "- Open-ended exploration: 자세한 정보를 찾아서 정리해줘",
  "- Any request combining 2+ distinct actions: 검색 + 요약, 분석 + 생성, 수집 + 비교",
  "- Continuation of a previous agent's work: 이전 작업 이어서 해줘, 더 자세히 조사해줘",
  "",
  "## task",
  "Long-running structured workflow requiring explicit human approval between phases.",
  "Use task ONLY when the user explicitly asks for:",
  "- Human approval/confirmation gates between steps: 확인받고 진행, 승인 후 다음 단계",
  "- Pause and resume: 중간에 멈추고, 이어서 진행",
  "- Phased execution: 1단계, 2단계... 단계마다 검토",
  "IMPORTANT: task is rare. Most multi-step work is agent, not task.",
  "",
  "# Capability Awareness",
  "The system's available tools and skills are listed in [AVAILABLE_CAPABILITIES].",
  "- If the request requires a tool category NOT listed → the system cannot do it → once (explain limitation)",
  "- If a specific skill matches the request → prefer using that skill's mode (check skill description)",
  "- Use this information to decide if the request needs agent (multi-step with tools) vs once (single action)",
  "",
  "# Examples",
  "",
  "## once examples",
  'User: "안녕" → {"mode":"once"}',
  'User: "오늘 날씨 알려줘" → {"mode":"once"}',
  'User: "이 파일 여기에 첨부해줘" → {"mode":"once"}',
  'User: "이제 첨부 도구가 사용 가능할거야" → {"mode":"once"}',
  'User: "크론 등록해줘 매일 9시" → {"mode":"once"}',
  'User: "이전에 만든 PDF 보내줘" → {"mode":"once"}',
  'User: "고마워" → {"mode":"once"}',
  'User: "메모리에 이거 저장해줘" → {"mode":"once"}',
  'User: "시크릿 등록해줘 API_KEY abc123" → {"mode":"once"}',
  'User: "웹 검색해줘 TypeScript 5.0" → {"mode":"once"}',
  "",
  "## agent examples",
  'User: "아이유에 대해 조사하고 리포트를 PDF로 만들어서 첨부해줘" → {"mode":"agent"}',
  'User: "경쟁사 3곳을 분석하고 비교표를 만들어줘" → {"mode":"agent"}',
  'User: "코드를 분석하고 리팩토링 계획을 세워줘" → {"mode":"agent"}',
  'User: "최신 뉴스를 수집해서 요약 보고서를 작성해줘" → {"mode":"agent"}',
  'User: "자세한 정보를 찾아서 분석하고 리포트를 만들어줘" → {"mode":"agent"}',
  'User: "이 파일 읽고 요약해줘" → {"mode":"agent"}',
  'User: "검색하고 비교 분석해줘" → {"mode":"agent"}',
  "",
  "## task examples",
  'User: "이 프로젝트를 리팩토링해줘 단계마다 확인받고 진행해" → {"mode":"task"}',
  'User: "배포 파이프라인 만들어줘 각 단계에서 승인 필요" → {"mode":"task"}',
  'User: "데이터 마이그레이션 진행해줘 각 테이블마다 내 승인 받고" → {"mode":"task"}',
].join("\n");

/** 기본 flowchart — 활성 작업이 없을 때 사용. */
export const BASE_FLOWCHART = [
  "",
  "# Decision Flowchart",
  "1. Does it map to a built-in command? Yes → builtin",
  "2. Does the user request any action? No → once",
  "3. Does it combine 2+ distinct actions? No → once",
  "4. Approval gates or pause/resume? Yes → task",
  "5. Otherwise → agent",
].join("\n");

/** 활성 작업이 있을 때 추가되는 inquiry 모드 정의. */
export const INQUIRY_DEFINITION = [
  "",
  "## inquiry",
  "The user is asking about the status or progress of an active task. No new agent spawn is needed.",
  "Use inquiry when the user asks about:",
  "- Progress: 진행중이야?, 어떻게 됐어?, 어디까지 했어?",
  "- Status check: 상태 알려줘, 끝났어?, 아직 하고 있어?",
  "- Result inquiry: 결과 나왔어?, 완료됐어?",
  "- General follow-up about an active task without requesting new work",
  "IMPORTANT: inquiry applies ONLY when the user is asking about existing active tasks, not requesting new work.",
  "If the user requests new/different work even though tasks are active, do NOT use inquiry.",
  "",
  "## inquiry examples",
  'User: "진행중이야?" → {"mode":"inquiry"}',
  'User: "작업 어떻게 돼가?" → {"mode":"inquiry"}',
  'User: "끝났어?" → {"mode":"inquiry"}',
  'User: "아직 하고 있어?" → {"mode":"inquiry"}',
  'User: "결과 나왔어?" → {"mode":"inquiry"}',
  'User: "이전 작업 상태 확인해줘" → {"mode":"inquiry"}',
].join("\n");

/** 활성 작업이 있을 때의 flowchart — inquiry step을 1번으로 삽입. */
export const INQUIRY_FLOWCHART = [
  "",
  "# Decision Flowchart",
  "1. Are there active tasks AND does the user ask about their status/progress? Yes → inquiry",
  "2. Does it map to a built-in command? Yes → builtin",
  "3. Does the user request any action? No → once",
  "4. Does it combine 2+ distinct actions? No → once",
  "5. Approval gates or pause/resume? Yes → task",
  "6. Otherwise → agent",
].join("\n");

// ── 포맷 함수 ──

export function format_secret_notice(guard: { missing_keys: string[]; invalid_ciphertexts: string[] }): string {
  const missing = guard.missing_keys.filter(Boolean).slice(0, 8);
  const invalid = guard.invalid_ciphertexts.filter(Boolean).slice(0, 4);
  return [
    "## 요약", "민감정보 보안 규칙에 따라 복호화를 중단했습니다. (오케스트레이터 선차단)", "",
    "## 핵심",
    "- 상태: secret_resolution_required",
    missing.length > 0 ? `- 누락 키: ${missing.join(", ")}` : "- 누락 키: (없음)",
    invalid.length > 0 ? `- 무효 암호문: ${invalid.join(", ")}` : "- 무효 암호문: (없음)",
    "- 보안 규칙은 모든 다른 규칙보다 우선 적용됩니다.", "",
    "## 코드/명령", "- /secret list", "- /secret set <name> <value>", "- 요청 본문에는 {{secret:<name>}} 형태로만 전달", "",
    "## 미디어", "(없음)",
  ].join("\n");
}

/** 도구 호출을 스트림에 표시할 한 줄 라벨 생성. */
export function format_tool_label(name: string, args?: Record<string, unknown>): string {
  const hl = `\`${name}\``;
  if (!args) return hl;
  const s = (key: string) => {
    const v = args[key];
    return typeof v === "string" ? v : "";
  };
  const trunc = (v: string, max: number) => v.length > max ? v.slice(0, max) + "…" : v;
  switch (name) {
    case "grep": case "Grep":
      return `${hl} "${trunc(s("pattern"), 30)}"${s("path") ? ` ${trunc(s("path"), 30)}` : ""}`;
    case "glob": case "Glob":
      return `${hl} ${trunc(s("pattern"), 40)}`;
    case "read_file": case "Read":
      return `${hl} ${trunc(s("file_path"), 50)}`;
    case "write_file": case "Write":
      return `${hl} ${trunc(s("file_path"), 50)}`;
    case "edit_file": case "Edit":
      return `${hl} ${trunc(s("file_path"), 50)}`;
    case "shell": case "bash": case "Bash":
      return `${hl} ${trunc(s("command"), 40)}`;
    case "web_search":
      return `${hl} "${trunc(s("query"), 40)}"`;
    case "web_fetch":
      return `${hl} ${trunc(s("url"), 50)}`;
    case "message": case "send_message":
      return `${hl} ${trunc(s("content") || s("text"), 30)}`;
    case "send_file":
      return `${hl} ${trunc(s("file_path") || s("filename"), 40)}`;
    default:
      return hl;
  }
}

/** 도구 실행 결과를 스트림용 짧은 요약으로 변환. */
export function format_tool_result_brief(result: string, max = 400): string {
  const len = result.length;
  if (len === 0) return "✓";
  if (len <= max) return result.replace(/\n/g, " ").trim();
  const lines = result.split("\n").filter((l) => l.trim());
  const preview = lines.slice(0, 5).map((l) => l.trim()).join(" | ");
  const trimmed = preview.length > max ? preview.slice(0, max - 3) + "…" : preview;
  const size = len > 1000 ? `${(len / 1000).toFixed(1)}k자` : `${len}자`;
  return `${trimmed} (${size})`;
}

/** 도구 실행 블록을 채널 별도 메시지용으로 포맷. */
export function format_tool_block(label: string, result: string, is_error: boolean): string {
  const brief = format_tool_result_brief(result);
  const status = is_error ? "✗" : "→";
  return `▸ ${label} ${status} ${brief}`;
}

export const STATUS_EMOJI: Record<string, string> = {
  running: "🔄", waiting_approval: "🔐", waiting_user_input: "💬",
  failed: "❌", max_turns_reached: "⚠️", stopped: "⏹️", completed: "✅", cancelled: "🚫",
};

/** 활성 작업 요약 포맷. */
export function format_active_task_summary(
  tasks: import("../contracts.js").TaskState[],
  find_session?: (task_id: string) => import("../agent/agent.types.js").AgentSession | null,
): string {
  const lines = [`📋 현재 활성 작업 ${tasks.length}건`];
  for (const t of tasks) {
    const icon = STATUS_EMOJI[t.status] || "❓";
    const step = t.currentStep ? ` · step: ${t.currentStep}` : "";
    const session = find_session?.(t.taskId);
    const session_label = session ? ` · session: \`${session.session_id.slice(0, 12)}\` (${session.backend})` : "";
    lines.push(`${icon} \`${t.taskId}\`  ${t.title || "(제목 없음)"}`);
    lines.push(`  [${t.status}] turn ${t.currentTurn}/${t.maxTurns}${step}${session_label}`);
  }
  lines.push("", "상세: `/task status <id>` · 취소: `/task cancel <id>`");
  return lines.join("\n");
}

export function build_active_task_context(tasks: import("../contracts.js").TaskState[]): string {
  const lines = ["", "# Active Tasks in this chat"];
  for (const t of tasks) {
    const step = t.currentStep ? `, step=${t.currentStep}` : "";
    lines.push(`- ${t.taskId} [${t.status}] "${t.title}" turn=${t.currentTurn}/${t.maxTurns}${step}`);
  }
  return lines.join("\n");
}

export function build_classifier_capabilities(tool_categories: string[], skill_names: string[]): string {
  const lines = ["[AVAILABLE_CAPABILITIES]"];
  if (tool_categories.length > 0) lines.push(`Tools: ${tool_categories.join(", ")}`);
  if (skill_names.length > 0) lines.push(`Skills: ${skill_names.join(", ")}`);
  return lines.join("\n");
}
