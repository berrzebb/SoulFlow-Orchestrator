export type WorkflowPhase = "assign" | "progress" | "blocked" | "done" | "approval";

const WORKFLOW_PHASES = new Set<WorkflowPhase>(["assign", "progress", "blocked", "done", "approval"]);

/** unknown 값을 WorkflowPhase로 정규화. 유효하지 않으면 "progress" 반환. */
export function normalize_phase(value: unknown): WorkflowPhase {
  const phase = String(value || "").trim().toLowerCase();
  if (WORKFLOW_PHASES.has(phase as WorkflowPhase)) return phase as WorkflowPhase;
  return "progress";
}

export type WorkflowEventSource = "outbound" | "inbound" | "system";

export type WorkflowEvent = {
  event_id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  phase: WorkflowPhase;
  summary: string;
  payload: Record<string, unknown>;
  provider?: string;
  channel?: string;
  chat_id: string;
  thread_id?: string;
  source: WorkflowEventSource;
  detail_file?: string | null;
  at: string;
  team_id: string;
  /** FE-6: 이벤트 소유자. 사용자별 이벤트 스코핑 기준. */
  user_id: string;
};

export type AppendWorkflowEventInput = {
  event_id?: string;
  run_id?: string;
  task_id?: string;
  agent_id?: string;
  phase: WorkflowPhase;
  summary: string;
  payload?: Record<string, unknown>;
  provider?: string;
  channel?: string;
  chat_id?: string;
  thread_id?: string;
  source?: WorkflowEventSource;
  detail?: string | null;
  at?: string;
  team_id?: string;
  /** FE-6: 이벤트 소유자. */
  user_id?: string;
};

export type AppendWorkflowEventResult = {
  deduped: boolean;
  event: WorkflowEvent;
};

export type ListWorkflowEventsFilter = {
  phase?: WorkflowPhase;
  task_id?: string;
  run_id?: string;
  agent_id?: string;
  chat_id?: string;
  source?: WorkflowEventSource;
  team_id?: string;
  /** FE-6: 사용자별 이벤트 필터. */
  user_id?: string;
  limit?: number;
  offset?: number;
};

