export type WorkflowPhase = "assign" | "progress" | "blocked" | "done" | "approval";

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
  limit?: number;
  offset?: number;
};

