/** Phase Loop — Multi-Agent Phase-Based Workflow 타입 정의. */

import type { OrcheNodeState, OrcheNodeType, TriggerType, WorkflowNodeDefinition } from "./workflow-node.types.js";

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
  /** 오케스트레이션 노드 상태 (HTTP/Code/IF/Merge/Set). */
  orche_states?: OrcheNodeState[];
  memory: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /** 워크플로우 정의 원본 (YAML 또는 dashboard 생성). 재실행/UI 표시용. */
  definition?: WorkflowDefinition;
  /** Approval 노드 + ask_channel 대기를 자동으로 승인. */
  auto_approve?: boolean;
  /** HITL/ask_user 대기를 빈 응답으로 자동 재개. */
  auto_resume?: boolean;
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

export type FilesystemIsolation = "none" | "directory" | "worktree";

export interface PhaseAgentDefinition {
  agent_id: string;
  role: string;
  label: string;
  backend: string;
  model?: string;
  system_prompt: string;
  tools?: string[];
  max_turns?: number;
  /** 파일시스템 격리 모드. none(기본): 격리 없음, directory: 전용 디렉토리, worktree: git worktree 격리. */
  filesystem_isolation?: FilesystemIsolation;
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
  description?: string;
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
  /** Phase에 바인딩된 도구 ID 목록 (tool_nodes 참조). */
  tools?: string[];
  /** Phase에 바인딩된 스킬 이름 목록 (skill_nodes 참조). */
  skills?: string[];
}

/** 보조 Tool 노드 정의. */
export interface ToolNodeDefinition {
  id: string;
  tool_id: string;
  description: string;
  attach_to?: string[];
}

/** 보조 Skill 노드 정의. */
export interface SkillNodeDefinition {
  id: string;
  skill_name: string;
  description: string;
  attach_to?: string[];
}

/** Cron 트리거 정의. */
/** HITL 채널 바인딩. */
export interface HitlChannelDefinition {
  channel_type: string;
  chat_id?: string;
}

export interface WorkflowDefinition {
  title: string;
  objective: string;
  /** 레거시: Phase 전용 배열. nodes[]가 없을 때 사용. nodes[]가 있으면 이쪽이 우선. */
  phases?: PhaseDefinition[];
  /** 통합 노드 배열 (Phase + 오케스트레이션). 있으면 phases[]보다 우선. */
  nodes?: WorkflowNodeDefinition[];
  /** 변수: `{{objective}}`, `{{channel}}` 등 런타임 치환. */
  variables?: Record<string, string>;
  /** 보조 Tool 노드 목록. */
  tool_nodes?: ToolNodeDefinition[];
  /** 보조 Skill 노드 목록. */
  skill_nodes?: SkillNodeDefinition[];
  /** 트리거 노드 (복수 지원). */
  trigger_nodes?: TriggerNodeRecord[];
  /** HITL 채널 바인딩 (interactive/sequential_loop 모드용). */
  hitl_channel?: HitlChannelDefinition;
  /** 오케스트레이션 노드 (UI에서 추가한 HTTP/Code/IF/Merge/Set). */
  orche_nodes?: OrcheNodeRecord[];
  /** 종료 노드 — 채널/웹훅/HTTP/미디어로 최종 결과 출력. */
  end_nodes?: EndNodeRecord[];
  /** 노드 간 필드 매핑 (UI에서 드래그 연결로 생성). */
  field_mappings?: FieldMapping[];
}

/** UI 오케스트레이션 노드 (Phase가 아닌 보조 실행 노드). */
export interface OrcheNodeRecord {
  node_id: string;
  node_type: OrcheNodeType;
  title: string;
  depends_on?: string[];
  [key: string]: unknown;
}

/** 워크플로우 종료 노드 — 출력 대상(채널/웹훅/HTTP/미디어)으로 결과를 전송. */
export interface EndNodeRecord {
  node_id: string;
  depends_on?: string[];
  output_targets: string[];    // "channel" | "media" | "webhook" | "http"
  target_config?: Record<string, {
    message?: string;
    url?: string;
    status?: number;
    data?: unknown;
    mime_type?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }>;
}

/** 트리거 노드 레코드. */
export interface TriggerNodeRecord {
  id: string;
  trigger_type: TriggerType;
  schedule?: string;
  timezone?: string;
  webhook_path?: string;
  channel_type?: string;
  chat_id?: string;
  kanban_board_id?: string;
  kanban_actions?: string[];
  kanban_column_id?: string;
  watch_path?: string;
  watch_events?: Array<"add" | "change" | "unlink">;
  watch_pattern?: string;
  watch_batch_ms?: number;
}

/** 노드 간 필드 레벨 데이터 매핑. */
export interface FieldMapping {
  from_node: string;
  from_field: string;   // "body.data[0].id"
  to_node: string;
  to_field: string;     // 타겟 노드의 입력 위치
}

// ── Run Options / Result ─────────────────────────────

/** 채널 메시지 전송 요청. */
export interface ChannelSendRequest {
  /** 대상 채널 타입. origin이면 트리거 채널 사용. */
  target: "origin" | "specified";
  channel?: string;
  chat_id?: string;
  content: string;
  /** Approval/Form 등에서 사용하는 구조화 데이터. */
  structured?: {
    type: "approval" | "form";
    payload: Record<string, unknown>;
  };
  parse_mode?: string;
}

/** 채널 응답 결과. */
export interface ChannelResponse {
  response: string;
  responded_by?: { user_id?: string; username?: string; channel?: string; chat_id?: string };
  responded_at: string;
  timed_out: boolean;
  /** Approval 전용. */
  approved?: boolean;
  comment?: string;
  votes?: Array<Record<string, unknown>>;
  /** Form 전용. */
  fields?: Record<string, unknown>;
}

export interface PhaseLoopRunOptions {
  workflow_id: string;
  title: string;
  objective: string;
  channel: string;
  chat_id: string;
  phases: PhaseDefinition[];
  /** 통합 노드 배열 (Phase + 오케스트레이션). 있으면 phases[]보다 우선. */
  nodes?: WorkflowNodeDefinition[];
  initial_memory?: Record<string, unknown>;
  on_phase_change?: (state: PhaseLoopState) => void;
  on_agent_update?: (phase_id: string, agent_id: string, state: PhaseAgentState) => void;
  abort_signal?: AbortSignal;
  /** 런타임 워크스페이스 경로. 노드 실행·worktree 격리의 기준 디렉터리. */
  workspace: string;
  /** Interactive/sequential_loop 모드에서 사용자에게 질문하고 응답을 받는 콜백. */
  ask_user?: (question: string) => Promise<string>;
  /** 채널에 메시지 전송 (fire-and-forget). Notify, Escalation, SendFile 등. */
  send_message?: (req: ChannelSendRequest) => Promise<{ ok: boolean; message_id?: string }>;
  /** 채널로 질문 전송 + 응답 대기. HITL, Approval, Form 등. */
  ask_channel?: (req: ChannelSendRequest, timeout_ms: number) => Promise<ChannelResponse>;
  /** 도구 호출 (Tool Invoke 노드용). tool_id + params + context → 결과 문자열. */
  invoke_tool?: (tool_id: string, params: Record<string, unknown>, context?: { workflow_id?: string; channel?: string; chat_id?: string; sender_id?: string }) => Promise<string>;
  /** 노드 간 필드 매핑 (from_node.from_field → to_node.to_field). */
  field_mappings?: FieldMapping[];
  /** resume 시 기존 상태 전달. 있으면 새 state 대신 이 state에서 이어서 실행. */
  resume_state?: PhaseLoopState;
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
  | { type: "phase_goto"; workflow_id: string; from_phase: string; to_phase: string; reason: string }
  | { type: "node_started"; workflow_id: string; node_id: string; node_type: string }
  | { type: "node_completed"; workflow_id: string; node_id: string; node_type: string; output_preview?: string }
  | { type: "node_skipped"; workflow_id: string; node_id: string; reason: string }
  | { type: "node_waiting"; workflow_id: string; node_id: string; node_type: string; reason: string }
  | { type: "node_retry"; workflow_id: string; node_id: string; attempt: number; max_attempts: number; error: string }
  | { type: "node_error"; workflow_id: string; node_id: string; error: string };
