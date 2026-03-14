import type { InboundMessage, ProgressEvent } from "../bus/types.js";
import type { ChannelProvider } from "../channels/types.js";
import type { CorrelationContext } from "../observability/correlation.js";

export type ExecutionMode = "once" | "agent" | "task" | "phase";

/** 오케스트레이터 LLM 분류기 전체 출력. builtin/inquiry는 실행 전에 해소되는 라우팅 신호. */
export type ClassificationResult =
  | { mode: ExecutionMode; tools?: string[] }
  | { mode: "inquiry" }
  | { mode: "identity" }
  | { mode: "builtin"; command: string; args?: string }
  | { mode: "phase"; workflow_id?: string; nodes?: string[] };

export type OrchestrationRequest = {
  message: InboundMessage;
  alias: string;
  provider: ChannelProvider;
  media_inputs: string[];
  session_history: Array<{ role: string; content: string }>;
  on_stream?: (chunk: string) => void;
  /** 도구 실행 블록을 별도 메시지로 발행. 호출 시 현재 스트리밍 메시지를 확정하고 새 메시지 발행. */
  on_tool_block?: (block: string) => void;
  /** 실행 진행 상황을 bus ProgressEvent로 발행. task_lifecycle 이벤트를 브릿지. */
  on_progress?: (event: ProgressEvent) => void;
  /** AgentEvent를 대시보드 SSE로 릴레이. native backend + legacy 양쪽에서 호출. */
  on_agent_event?: (event: import("../agent/agent.types.js").AgentEvent) => void;
  /** 헤드리스 LLM 프로바이더에서 직접 발행되는 StreamEvent 수신. on_agent_event의 headless 경로 대응. */
  on_stream_event?: (event: import("../channels/stream-event.js").StreamEvent) => void;
  signal?: AbortSignal;
  /** TaskResumeService가 재개한 Task ID. 이 값이 있으면 새 orchestration 대신 기존 Task을 이어서 실행. */
  resumed_task_id?: string;
  /** ProcessTracker가 부여한 실행 추적 ID. */
  run_id?: string;
  /** PTY HITL: 사용자 입력 전송 콜백 등록. */
  register_send_input?: (cb: (text: string) => void) => void;
  /** Task 최대 턴 수 (create_task에서 전달). */
  max_turns?: number;
  /** Task 초기 메모리 (create_task에서 전달). */
  initial_memory?: Record<string, unknown>;
  /** 사용자 지정 프로바이더 ID (웹 채팅에서 전달). 미설정 시 자동 선택. */
  preferred_provider_id?: string;
  /** 사용자 지정 모델 ID (웹 채팅에서 전달). */
  preferred_model?: string;
  /** 에이전트 컨텍스트 시스템 프롬프트 오버라이드 (웹 채팅 에이전트 선택 시). build_system_prompt 결과를 대체. */
  system_prompt_override?: string;
  /** per-request 워크스페이스 경로. 멀티테넌트 환경에서 유저별 cwd를 오버라이드. */
  workspace_override?: string;
  /** per-request 유저 콘텐츠 루트. 워크플로우/스킬 템플릿 로드 경로. */
  user_dir_override?: string;
  /** OB-1: 실행 경로 correlation context. 채널/대시보드 진입점에서 생성. */
  correlation?: CorrelationContext;
};

/** 결과에 포함되는 토큰/비용 요약. */
export type ResultUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  total_cost_usd?: number;
};

export type OrchestrationResult = {
  reply: string | null;
  error?: string;
  suppress_reply?: boolean;
  mode: ExecutionMode;
  tool_calls_count: number;
  streamed: boolean;
  /** 스트리밍 전체 누적 텍스트. 세션 기록·감사용. */
  stream_full_content?: string;
  /** structured_output 사용 시 백엔드가 반환한 파싱된 결과. */
  parsed_output?: unknown;
  /** 토큰/비용 사용량. */
  usage?: ResultUsage;
  /** 실행 추적 ID. */
  run_id?: string;
  /** 분류기가 builtin 커맨드로 라우팅한 경우. ChannelManager가 CommandRouter에 위임. */
  builtin_command?: string;
  builtin_args?: string;
  /** SkillIndex가 매칭한 스킬 이름 목록 (SessionMessage.tools_used와 별개). */
  matched_skills?: string[];
  /** 이번 실행에서 사용된 도구 이름 목록. SessionMessage.tools_used에 저장. */
  tools_used?: string[];
  /** EG-4: 정상적 조기 종료 사유. error와 구분 — error는 실패, stop_reason은 정책 기반 종료. */
  stop_reason?: string;
};
