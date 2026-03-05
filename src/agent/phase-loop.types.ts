/** Phase Loop — Multi-Agent Phase-Based Workflow 타입 정의. */

// ── State ────────────────────────────────────────────

export type PhaseWorkflowStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_user_input";

export type PhaseStatus =
  | "pending"
  | "running"
  | "reviewing"
  | "completed"
  | "failed";

export type PhaseAgentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type PhaseCriticStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface PhaseMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
}

export interface PhaseAgentState {
  agent_id: string;
  role: string;
  label: string;
  model: string;
  status: PhaseAgentStatus;
  messages: PhaseMessage[];
  result?: string;
  error?: string;
  usage?: { input: number; output: number; cost?: number };
  /** SubagentRegistry 실행 ID. 에이전트 채팅 전달에 사용. */
  subagent_id?: string;
}

export interface PhaseCriticState {
  agent_id: string;
  model: string;
  status: PhaseCriticStatus;
  review?: string;
  approved?: boolean;
  messages: PhaseMessage[];
}

export interface PhaseState {
  phase_id: string;
  title: string;
  status: PhaseStatus;
  agents: PhaseAgentState[];
  critic?: PhaseCriticState;
  /** sequential_loop/interactive 모드: 현재 반복 횟수. */
  loop_iteration?: number;
  /** sequential_loop/interactive 모드: 각 반복 결과 누적. */
  loop_results?: string[];
  /** interactive 모드: 사용자 입력 대기 중 여부. */
  pending_user_input?: boolean;
}

export interface PhaseLoopState {
  workflow_id: string;
  title: string;
  objective: string;
  channel: string;
  chat_id: string;
  status: PhaseWorkflowStatus;
  current_phase: number;
  phases: PhaseState[];
  memory: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /** 워크플로우 정의 원본 (YAML 또는 dashboard 생성). 재실행/UI 표시용. */
  definition?: WorkflowDefinition;
}

// ── Definition (워크플로우 템플릿) ───────────────────

export type PhaseFailurePolicy = "fail_fast" | "best_effort" | "quorum";
export type CriticRejectionPolicy = "retry_all" | "retry_targeted" | "escalate" | "goto";
export type PhaseMode = "parallel" | "interactive" | "sequential_loop";

/** Critic 검토 결과 (per-agent 평가 포함). */
export interface CriticReview {
  approved: boolean;
  summary: string;
  /** targeted retry를 위한 에이전트별 평가. */
  agent_reviews?: Array<{
    agent_id: string;
    quality: "good" | "needs_improvement" | "low_quality";
    feedback: string;
  }>;
}

export interface PhaseAgentDefinition {
  agent_id: string;
  role: string;
  label: string;
  backend: string;
  model?: string;
  system_prompt: string;
  tools?: string[];
  max_turns?: number;
}

export interface PhaseCriticDefinition {
  backend: string;
  model?: string;
  system_prompt: string;
  gate?: boolean;
  on_rejection?: CriticRejectionPolicy;
  /** on_rejection이 "goto"일 때 점프할 phase_id. */
  goto_phase?: string;
  max_retries?: number;
}

export interface PhaseDefinition {
  phase_id: string;
  title: string;
  agents: PhaseAgentDefinition[];
  critic?: PhaseCriticDefinition;
  context_template?: string;
  failure_policy?: PhaseFailurePolicy;
  quorum_count?: number;
  /** Phase 실행 모드. parallel(기본): 병렬, interactive: 사용자 대화, sequential_loop: fresh context 반복. */
  mode?: PhaseMode;
  /** sequential_loop 종료 조건. */
  loop_until?: string;
  /** interactive/sequential_loop 최대 반복 횟수. */
  max_loop_iterations?: number;
  /** Fork-Join: 이 Phase 시작 전에 완료되어야 하는 phase_id 목록. */
  depends_on?: string[];
}

export interface WorkflowDefinition {
  title: string;
  objective: string;
  phases: PhaseDefinition[];
  /** 변수: `{{objective}}`, `{{channel}}` 등 런타임 치환. */
  variables?: Record<string, string>;
}

// ── Run Options / Result ─────────────────────────────

export interface PhaseLoopRunOptions {
  workflow_id: string;
  title: string;
  objective: string;
  channel: string;
  chat_id: string;
  phases: PhaseDefinition[];
  initial_memory?: Record<string, unknown>;
  on_phase_change?: (state: PhaseLoopState) => void;
  on_agent_update?: (phase_id: string, agent_id: string, state: PhaseAgentState) => void;
  abort_signal?: AbortSignal;
  /** Interactive/sequential_loop 모드에서 사용자에게 질문하고 응답을 받는 콜백. */
  ask_user?: (question: string) => Promise<string>;
}

export interface PhaseLoopRunResult {
  workflow_id: string;
  status: PhaseWorkflowStatus;
  phases: PhaseState[];
  memory: Record<string, unknown>;
  error?: string;
}

// ── SSE Events ───────────────────────────────────────

export type PhaseLoopEvent =
  | { type: "workflow_started"; workflow_id: string }
  | { type: "phase_started"; workflow_id: string; phase_id: string }
  | { type: "agent_started"; workflow_id: string; phase_id: string; agent_id: string }
  | { type: "agent_completed"; workflow_id: string; phase_id: string; agent_id: string; result: string }
  | { type: "agent_failed"; workflow_id: string; phase_id: string; agent_id: string; error: string }
  | { type: "agent_message"; workflow_id: string; phase_id: string; agent_id: string; message: PhaseMessage }
  | { type: "critic_started"; workflow_id: string; phase_id: string }
  | { type: "critic_completed"; workflow_id: string; phase_id: string; approved: boolean; review: string }
  | { type: "phase_completed"; workflow_id: string; phase_id: string }
  | { type: "workflow_completed"; workflow_id: string }
  | { type: "workflow_failed"; workflow_id: string; error: string }
  | { type: "user_input_requested"; workflow_id: string; phase_id: string; question: string }
  | { type: "user_input_received"; workflow_id: string; phase_id: string }
  | { type: "loop_iteration"; workflow_id: string; phase_id: string; iteration: number }
  | { type: "phase_goto"; workflow_id: string; from_phase: string; to_phase: string; reason: string };
