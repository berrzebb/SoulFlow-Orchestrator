export type LoopType = "agent" | "task";
export type WorkflowPhase = "assign" | "progress" | "blocked" | "done" | "approval";

export interface Soul {
  identity: string;
  tone: string;
  values: string[];
}

export interface Heart {
  coreDirective: string;
  principles: string[];
  boundaries: string[];
}

export interface AgentProfile {
  id: string;
  role: string;
  soul: Soul;
  heart: Heart;
}

export interface AgentLoopState {
  loopId: string;
  agentId: string;
  objective: string;
  currentTurn: number;
  maxTurns: number;
  checkShouldContinue: boolean;
  status: "running" | "stopped" | "failed" | "completed" | "max_turns_reached";
  terminationReason?: string;
}

export interface TaskState {
  taskId: string;
  title: string;
  currentTurn: number;
  maxTurns: number;
  status: "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | "max_turns_reached";
  currentStep?: string;
  exitReason?: string;
  memory: Record<string, unknown>;
}

export interface Message {
  provider: string;
  channel: string;
  sender_id: string;
  chat_id: string;
  content: string;
  thread_id?: string;
}

export interface Provider {
  id: string;
  send(message: Message): Promise<{ messageId: string }>;
  read(channelId: string, limit?: number): Promise<Message[]>;
}

export interface BusEvent {
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface WorkflowEventContract {
  event_id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  phase: WorkflowPhase;
  summary: string;
  payload: Record<string, unknown>;
  channel: string;
  chat_id: string;
  thread_id?: string;
  source: "outbound" | "inbound" | "system";
  at: string;
}
