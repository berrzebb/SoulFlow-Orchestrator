/** Hooks 이벤트 시스템 — 타입 정의. */

/** 지원하는 훅 이벤트 이름. */
export type HookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
  | "TaskCompleted"
  | "Notification";

/** 훅 핸들러 유형. */
export type HookHandlerType = "command" | "http";

/** command 핸들러 설정. */
export type CommandHookHandler = {
  type: "command";
  /** 실행할 셸 명령. 환경변수 치환 지원. */
  command: string;
  /** 작업 디렉토리. 미지정 시 workspace. */
  cwd?: string;
  /** 타임아웃 (ms). 기본값 10000. */
  timeout_ms?: number;
};

/** http 핸들러 설정. */
export type HttpHookHandler = {
  type: "http";
  /** POST 요청 대상 URL. */
  url: string;
  /** 추가 헤더. */
  headers?: Record<string, string>;
  /** 타임아웃 (ms). 기본값 5000. */
  timeout_ms?: number;
};

export type HookHandler = CommandHookHandler | HttpHookHandler;

/** 훅 정의. 설정 파일이나 HOOK.md에서 로드. */
export type HookDefinition = {
  /** 사람이 읽을 수 있는 이름. */
  name: string;
  /** 트리거할 이벤트. */
  event: HookEventName;
  /** 도구 이름 매칭 정규식 (PreToolUse/PostToolUse). 미지정 시 전체 매칭. */
  matcher?: string;
  /** 핸들러 설정. */
  handler: HookHandler;
  /** true면 비동기 실행 (결과를 기다리지 않음). */
  async?: boolean;
  /** 비활성화 여부. */
  disabled?: boolean;
};

/** 훅 실행 시 stdin/body로 전달되는 입력. */
export type HookInput = {
  /** 이벤트 이름. */
  hook_event_name: HookEventName;
  /** 세션 ID. */
  session_id?: string;
  /** 현재 작업 디렉토리. */
  cwd?: string;
  /** 도구 이름 (도구 이벤트만). */
  tool_name?: string;
  /** 도구 파라미터 (도구 이벤트만). */
  tool_input?: Record<string, unknown>;
  /** 도구 실행 결과 (PostToolUse/PostToolUseFailure). */
  tool_output?: string;
  /** 에러 여부 (PostToolUseFailure). */
  is_error?: boolean;
  /** 추가 메타데이터. */
  metadata?: Record<string, unknown>;
};

/** 훅 실행 결과. */
export type HookOutput = {
  /** 훅이 차단 결정을 내렸는지. */
  decision?: "allow" | "deny" | "ignore";
  /** 사유. */
  reason?: string;
  /** 수정된 입력 (PreToolUse에서 파라미터 변경). */
  updated_input?: Record<string, unknown>;
  /** 추가 컨텍스트 (에이전트에게 주입). */
  additional_context?: string;
};

/** 훅 실행 결과 + 메타. */
export type HookExecutionResult = {
  hook_name: string;
  output: HookOutput;
  duration_ms: number;
  error?: string;
};

/** 전체 훅 설정. */
export type HooksConfig = {
  hooks?: Partial<Record<HookEventName, HookDefinition[]>>;
};
