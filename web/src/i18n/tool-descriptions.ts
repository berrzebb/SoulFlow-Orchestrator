/**
 * 빌트인 도구 설명 번역 맵.
 * tools.tsx에서 locale에 따라 API 스키마 설명을 오버라이드.
 * MCP 도구는 외부 서버 제공이므로 여기에 포함하지 않음.
 */

interface ToolI18n {
  desc: string;
  params?: Record<string, string>;
}

type ToolI18nMap = Record<string, ToolI18n>;

const en: ToolI18nMap = {
  exec: {
    desc: "Execute a shell command and return stdout/stderr.",
    params: { command: "Shell command to run", working_dir: "Optional working directory", timeout_seconds: "Timeout in seconds" },
  },
  web_search: {
    desc: "Search the web and return results.",
    params: { query: "Search query", count: "Max result count", session: "Browser session name", max_chars: "Max characters in output" },
  },
  web_fetch: {
    desc: "Fetch a web page and return extracted text.",
    params: { url: "Target URL", max_chars: "Max characters in output", session: "Browser session name" },
  },
  web_browser: {
    desc: "Control a browser (open/snapshot/click/fill/wait/screenshot/close).",
    params: {
      action: "Action to perform", url: "Target URL (for 'open')", selector: "CSS/XPath selector",
      text: "Text to fill", wait_ms: "Wait duration (ms)", session: "Session identifier",
      path: "Screenshot output path", max_chars: "Max characters in output",
    },
  },
  message: {
    desc: "Send a workflow event message (assign/progress/blocked/done/approval).",
    params: {
      content: "Message content", phase: "Workflow phase", task_id: "Task ID",
      run_id: "Run ID", event_id: "Idempotent event ID", agent_id: "Agent ID",
      detail: "Detailed body", payload: "Structured event payload",
      channel: "Target channel", chat_id: "Target chat ID",
      reply_to: "Reply-to ID", media: "Media URLs or file references",
    },
  },
  diagram_render: {
    desc: "Render Mermaid diagrams to SVG or ASCII.",
    params: {
      action: "Action (render or list_themes)", diagram: "Mermaid diagram source",
      format: "Output format (svg/ascii)", theme: "SVG theme", animate: "Enable animation",
      use_ascii: "ASCII mode for format=ascii", max_chars: "Output truncation limit",
    },
  },
  request_file: {
    desc: "Request a file upload from the user.",
    params: { prompt: "Request message shown to user", channel: "Target channel", chat_id: "Target chat ID", accept: "Accepted file types" },
  },
  http_request: {
    desc: "Make an HTTP/REST API request (GET/POST/PUT/PATCH/DELETE).",
    params: {
      url: "Target URL (https:// recommended)", method: "HTTP method (default: GET)",
      headers: "Request headers (key-value)", body: "Request body",
      timeout_ms: "Timeout (ms, default: 10000)", max_response_chars: "Max response characters",
    },
  },
  send_file: {
    desc: "Send a local file to the current channel/chat.",
    params: { file_path: "Local file path to send", caption: "Optional accompanying message" },
  },
  cron: {
    desc: "Manage scheduled jobs (add/list/remove/enable/disable/run/status).",
    params: {
      action: "Action to perform", name: "Job name", message: "Message to send when job runs",
      every_seconds: "Run every N seconds", cron_expr: "Cron expression", tz: "Timezone",
      at: "ISO datetime for one-shot", job_id: "Job identifier", deliver: "Delivery mode",
      channel: "Target channel", to: "Target chat ID", delete_after_run: "Delete after execution",
      include_disabled: "Include disabled jobs", force: "Force execution",
    },
  },
  datetime: {
    desc: "Get current date/time or convert formats (now/format/diff).",
    params: { action: "Action to perform", tz: "Timezone ID (e.g. Asia/Seoul, UTC)", iso: "Input date (ISO 8601)", other_iso: "Comparison date for diff" },
  },
  decision: {
    desc: "Query and set decisions (list/set/get_effective).",
    params: {
      action: "Action to perform", key: "Decision key", value: "Decision value",
      scope: "Scope (global/team/agent)", rationale: "Reason for decision",
      search: "Search term for list", limit: "Max results",
    },
  },
  task_query: {
    desc: "Query the status of a spawned subagent/task.",
    params: { task_id: "Task ID returned by spawn tool" },
  },
  secret: {
    desc: "Manage the secret vault (list/get/set/remove/status).",
    params: { action: "Action to perform", name: "Secret name", value: "Secret value" },
  },
  memory: {
    desc: "Search, read, and append memory (search/read_longterm/read_daily/list_daily/append_daily).",
    params: { action: "Action to perform", query: "Search query", day: "Date (YYYY-MM-DD)", content: "Content to append", limit: "Max results" },
  },
  spawn: {
    desc: "Spawn a headless subagent for a background task.",
    params: {
      task: "Task description", label: "Short label for tracking", role: "Role hint",
      soul: "Soul override", heart: "Heart override", model: "Model override", max_turns: "Turn budget",
    },
  },
  promise: {
    desc: "Query and set promises/constraints (list/set/get_effective).",
    params: {
      action: "Action to perform", key: "Promise key", value: "Promise content",
      scope: "Scope (global/team/agent)", rationale: "Reason",
      search: "Search term for list", limit: "Max results",
    },
  },
  runtime_admin: {
    desc: "Manage runtime: skills, dynamic tools, and MCP servers.",
    params: {
      action: "Action to perform",
      skill_name: "Skill name", skill_summary: "Skill summary", skill_body: "Skill body",
      skill_always: "Always enable", tool_name: "Tool name", tool_description: "Tool description",
      tool_parameters: "JSON schema parameters", tool_command_template: "Shell command template",
      tool_working_dir: "Working directory", tool_overwrite: "Overwrite if exists",
      tool_requires_approval: "Requires approval",
      mcp_server_name: "MCP server name", mcp_command: "Launch command",
      mcp_args: "Command arguments", mcp_env: "Environment variables",
      mcp_cwd: "Working directory", mcp_url: "Server URL", mcp_startup_timeout_sec: "Startup timeout",
    },
  },
  read_file: {
    desc: "Read UTF-8 content from a file.",
    params: { path: "File path to read" },
  },
  write_file: {
    desc: "Write UTF-8 content to a file (creates directories if needed).",
    params: { path: "File path to write", content: "Content to write", append: "Append mode (default: false)" },
  },
  edit_file: {
    desc: "Edit a file by replacing exact old text with new text.",
    params: { path: "File path to edit", old_text: "Exact old text", new_text: "Replacement text" },
  },
  list_dir: {
    desc: "List entries in a directory.",
    params: { path: "Directory path", limit: "Max entries to return" },
  },
  oauth_fetch: {
    desc: "Make an OAuth-authenticated API request (auto token injection and refresh).",
    params: {
      service_id: "OAuth integration ID (e.g. 'github')", url: "Target URL",
      method: "HTTP method (default: GET)", headers: "Additional request headers", body: "Request body",
    },
  },
};

const ko: ToolI18nMap = {
  exec: {
    desc: "셸 명령어를 실행하고 stdout/stderr을 반환합니다.",
    params: { command: "실행할 셸 명령어", working_dir: "작업 디렉터리 (선택)", timeout_seconds: "타임아웃 (초)" },
  },
  web_search: {
    desc: "웹 검색을 수행하고 결과를 반환합니다.",
    params: { query: "검색어", count: "최대 결과 수", session: "브라우저 세션 이름", max_chars: "출력 최대 문자 수" },
  },
  web_fetch: {
    desc: "웹 페이지를 가져와 텍스트를 추출합니다.",
    params: { url: "대상 URL", max_chars: "출력 최대 문자 수", session: "브라우저 세션 이름" },
  },
  web_browser: {
    desc: "브라우저를 제어합니다 (열기/스냅샷/클릭/입력/대기/스크린샷/닫기).",
    params: {
      action: "수행할 작업", url: "대상 URL ('open' 시)", selector: "CSS/XPath 선택자",
      text: "입력할 텍스트", wait_ms: "대기 시간 (ms)", session: "세션 식별자",
      path: "스크린샷 출력 경로", max_chars: "출력 최대 문자 수",
    },
  },
  message: {
    desc: "워크플로우 이벤트 메시지를 전송합니다 (assign/progress/blocked/done/approval).",
    params: {
      content: "메시지 내용", phase: "워크플로우 단계", task_id: "작업 ID",
      run_id: "실행 ID", event_id: "멱등성 이벤트 ID", agent_id: "에이전트 ID",
      detail: "상세 본문", payload: "구조화된 이벤트 페이로드",
      channel: "대상 채널", chat_id: "대상 채팅 ID",
      reply_to: "답장 대상 ID", media: "미디어 URL 또는 파일 참조",
    },
  },
  diagram_render: {
    desc: "Mermaid 다이어그램을 SVG 또는 ASCII로 렌더링합니다.",
    params: {
      action: "작업 (render 또는 list_themes)", diagram: "Mermaid 다이어그램 소스",
      format: "출력 형식 (svg/ascii)", theme: "SVG 테마", animate: "애니메이션 활성화",
      use_ascii: "ASCII 모드 (format=ascii 시)", max_chars: "출력 최대 문자 수",
    },
  },
  request_file: {
    desc: "사용자에게 파일 업로드를 요청합니다.",
    params: { prompt: "사용자에게 표시할 요청 메시지", channel: "대상 채널", chat_id: "대상 채팅 ID", accept: "허용 파일 유형" },
  },
  http_request: {
    desc: "HTTP/REST API 요청을 수행합니다 (GET/POST/PUT/PATCH/DELETE).",
    params: {
      url: "대상 URL (https:// 권장)", method: "HTTP 메서드 (기본: GET)",
      headers: "요청 헤더 (key-value)", body: "요청 바디",
      timeout_ms: "타임아웃 (ms, 기본: 10000)", max_response_chars: "응답 최대 문자 수",
    },
  },
  send_file: {
    desc: "로컬 파일을 현재 채널/채팅으로 전송합니다.",
    params: { file_path: "전송할 로컬 파일 경로", caption: "함께 보낼 메시지 (선택)" },
  },
  cron: {
    desc: "예약 작업을 관리합니다 (추가/목록/제거/활성화/비활성화/실행/상태).",
    params: {
      action: "수행할 작업", name: "작업 이름", message: "작업 실행 시 전송할 메시지",
      every_seconds: "N초마다 실행", cron_expr: "크론 표현식", tz: "시간대",
      at: "일회성 예약 (ISO datetime)", job_id: "작업 식별자", deliver: "전달 모드",
      channel: "대상 채널", to: "대상 채팅 ID", delete_after_run: "실행 후 삭제",
      include_disabled: "비활성 작업 포함", force: "강제 실행",
    },
  },
  datetime: {
    desc: "현재 날짜/시간 조회 또는 형식 변환 (now/format/diff).",
    params: { action: "수행할 작업", tz: "시간대 ID (예: Asia/Seoul, UTC)", iso: "입력 날짜 (ISO 8601)", other_iso: "비교할 날짜 (diff용)" },
  },
  decision: {
    desc: "결정사항을 조회하고 설정합니다 (list/set/get_effective).",
    params: {
      action: "수행할 작업", key: "결정 키", value: "결정 값",
      scope: "범위 (global/team/agent)", rationale: "결정 이유",
      search: "목록 검색어", limit: "최대 결과 수",
    },
  },
  task_query: {
    desc: "spawn으로 실행한 서브에이전트/작업의 상태를 조회합니다.",
    params: { task_id: "spawn 도구가 반환한 작업 ID" },
  },
  secret: {
    desc: "시크릿 저장소를 관리합니다 (list/get/set/remove/status).",
    params: { action: "수행할 작업", name: "시크릿 이름", value: "시크릿 값" },
  },
  memory: {
    desc: "메모리를 검색, 읽기, 추가합니다 (search/read_longterm/read_daily/list_daily/append_daily).",
    params: { action: "수행할 작업", query: "검색어", day: "날짜 (YYYY-MM-DD)", content: "추가할 내용", limit: "최대 결과 수" },
  },
  spawn: {
    desc: "백그라운드 작업을 위한 서브에이전트를 생성합니다.",
    params: {
      task: "작업 설명", label: "추적용 짧은 라벨", role: "역할 힌트",
      soul: "소울 오버라이드", heart: "하트 오버라이드", model: "모델 오버라이드", max_turns: "턴 예산",
    },
  },
  promise: {
    desc: "약속(제약 조건)을 조회하고 설정합니다 (list/set/get_effective).",
    params: {
      action: "수행할 작업", key: "약속 키", value: "약속 내용",
      scope: "범위 (global/team/agent)", rationale: "약속 이유",
      search: "목록 검색어", limit: "최대 결과 수",
    },
  },
  runtime_admin: {
    desc: "런타임을 관리합니다: 스킬, 동적 도구, MCP 서버.",
    params: {
      action: "수행할 작업",
      skill_name: "스킬 이름", skill_summary: "스킬 요약", skill_body: "스킬 본문",
      skill_always: "항상 활성화", tool_name: "도구 이름", tool_description: "도구 설명",
      tool_parameters: "JSON 스키마 매개변수", tool_command_template: "셸 명령 템플릿",
      tool_working_dir: "작업 디렉터리", tool_overwrite: "기존 항목 덮어쓰기",
      tool_requires_approval: "승인 필요 여부",
      mcp_server_name: "MCP 서버 이름", mcp_command: "실행 명령",
      mcp_args: "명령 인수", mcp_env: "환경 변수",
      mcp_cwd: "작업 디렉터리", mcp_url: "서버 URL", mcp_startup_timeout_sec: "시작 타임아웃",
    },
  },
  read_file: {
    desc: "파일의 UTF-8 내용을 읽습니다.",
    params: { path: "읽을 파일 경로" },
  },
  write_file: {
    desc: "파일에 UTF-8 내용을 씁니다 (필요 시 디렉터리 자동 생성).",
    params: { path: "쓸 파일 경로", content: "쓸 내용", append: "추가 모드 (기본: false)" },
  },
  edit_file: {
    desc: "파일의 기존 텍스트를 새 텍스트로 교체합니다.",
    params: { path: "편집할 파일 경로", old_text: "기존 텍스트 (정확히 일치)", new_text: "교체할 텍스트" },
  },
  list_dir: {
    desc: "디렉터리의 항목을 나열합니다.",
    params: { path: "디렉터리 경로", limit: "최대 항목 수" },
  },
  oauth_fetch: {
    desc: "OAuth 인증된 외부 API 요청을 수행합니다 (토큰 자동 주입, 만료 시 갱신).",
    params: {
      service_id: "OAuth 연동 ID (예: 'github')", url: "대상 URL",
      method: "HTTP 메서드 (기본: GET)", headers: "추가 요청 헤더", body: "요청 바디",
    },
  },
};

export const tool_i18n: Record<string, ToolI18nMap> = { en, ko };
