import type { InboundMessage, ProgressEvent } from "../bus/types.js";
import type { ChannelProvider } from "../channels/types.js";

export type ExecutionMode = "once" | "agent" | "task";

/** Phi-4 분류기 전체 출력. builtin/inquiry는 실행 전에 해소되는 라우팅 신호. */
export type ClassificationResult =
  | { mode: ExecutionMode }
  | { mode: "inquiry" }
  | { mode: "builtin"; command: string; args?: string };

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
  signal?: AbortSignal;
  /** TaskResumeService가 재개한 Task ID. 이 값이 있으면 새 orchestration 대신 기존 Task을 이어서 실행. */
  resumed_task_id?: string;
  /** ProcessTracker가 부여한 실행 추적 ID. */
  run_id?: string;
  /** PTY HITL: 사용자 입력 전송 콜백 등록. */
  register_send_input?: (cb: (text: string) => void) => void;
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
};
