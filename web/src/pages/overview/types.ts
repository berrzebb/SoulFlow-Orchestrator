export interface SystemMetrics {
  cpu_percent: number;
  mem_total_mb: number;
  mem_used_mb: number;
  mem_percent: number;
  swap_total_mb: number | null;
  swap_used_mb: number | null;
  swap_percent: number | null;
  net_rx_kbps: number | null;
  net_tx_kbps: number | null;
  uptime_s: number;
}

export interface AgentInfo {
  id: string; label: string; role: string; model: string;
  status: string; last_message: string;
}

/** FE-4: request_class — GW가 분류한 실행 경로. guardrail_blocked — EG에 의한 차단 여부. */
export type RequestClass = "builtin" | "direct_tool" | "model_direct" | "workflow_compile" | "workflow_run" | "agent";

export interface ProcessInfo {
  run_id: string; alias: string; mode: string; status: string;
  provider?: string; executor_provider?: string;
  tool_calls_count: number; error?: string;
  started_at?: string; ended_at?: string;
  /** FE-4: GW 분류 결과. */
  request_class?: RequestClass;
  /** FE-4: EG guardrail 차단 여부. */
  guardrail_blocked?: boolean;
}

export interface TaskInfo {
  taskId: string; title: string; status: string;
  currentTurn: number; maxTurns: number;
}

export interface CronJob {
  id: string; name: string; enabled: boolean;
  schedule: { kind: string; every_ms?: number; expr?: string; at_ms?: number };
  state?: { running?: boolean; next_run_at_ms?: number; last_status?: string; last_error?: string };
}

export interface MessageInfo { sender_id: string; content: string; direction: string }
export interface DecisionInfo { id: string; canonical_key: string; value: unknown; priority: number }
export interface WorkflowEvent {
  event_id: string; phase: string; task_id: string; agent_id: string; summary: string;
  /** FE-5: TR 검색 소스 (vector/fts5/hybrid). */
  retrieval_source?: string;
  /** FE-5: TR 콘텐츠 신규성 점수 (0~1). */
  novelty_score?: number;
}

export interface AgentProvider {
  instance_id: string; provider_type: string; label: string;
  enabled: boolean; available: boolean; circuit_state: string;
  token_configured: boolean;
}

export interface FailedValidatorEntry {
  kind: string;
  command: string;
  output?: string;
}

export interface ValidatorSummary {
  repo_id: string;
  total_validators: number;
  passed_validators: number;
  failed_validators: FailedValidatorEntry[];
  artifact_bundle_id?: string;
  created_at: string;
  /** RPF-6: 변경 표면의 최고 위험 등급. */
  risk_tier?: string;
  /** RPF-6: eval 통과율 (0~1). */
  eval_score?: number;
}

export interface DashboardState {
  now: string;
  queue: { inbound: number; outbound: number };
  channels: {
    enabled: string[];
    mention_loop_running: boolean;
    health?: Record<string, { healthy: boolean; running: boolean }>;
  };
  agents: AgentInfo[];
  processes: { active: ProcessInfo[]; recent: ProcessInfo[] };
  tasks: TaskInfo[];
  cron: { paused: boolean; jobs: CronJob[]; next_wake_at_ms: number } | null;
  messages: MessageInfo[];
  decisions: DecisionInfo[];
  workflow_events: WorkflowEvent[];
  cd_score: { total: number } | null;
  agent_providers?: AgentProvider[];
  validator_summary?: ValidatorSummary;
  /** FE-4: 요청 분류별 집계 (builtin/direct_tool/model_direct/workflow/agent). */
  request_class_summary?: Record<string, number>;
  /** FE-4: guardrail 통계 (차단/전체). */
  guardrail_stats?: { blocked: number; total: number };
}

export const ACTIVE_TASK_STATUSES = new Set(["running", "waiting_approval", "waiting_user_input"]);

export const PHASE_VARIANT: Record<string, "ok" | "warn" | "err" | "info" | undefined> = {
  done: "ok", start: "info", error: "err", fail: "err", warn: "warn",
};
