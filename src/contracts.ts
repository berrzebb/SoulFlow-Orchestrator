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
  objective: string;
  channel: string;
  chatId: string;
  currentTurn: number;
  maxTurns: number;
  status: "running" | "waiting_approval" | "waiting_user_input" | "completed" | "failed" | "cancelled" | "max_turns_reached";
  currentStep?: string;
  exitReason?: string;
  memory: Record<string, unknown>;
}
