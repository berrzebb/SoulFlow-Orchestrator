/** 팀 스코핑 옵션. team_id가 정의되면 소유권 검증, undefined면 무제한(superadmin). */
export type TeamScopeOpts = { team_id?: string };

export interface AgentLoopState {
  loopId: string;
  agentId: string;
  /** 소유 팀. 외부 채널 기원은 빈 문자열. */
  team_id: string;
  objective: string;
  currentTurn: number;
  maxTurns: number;
  checkShouldContinue: boolean;
  status: "running" | "stopped" | "failed" | "completed" | "max_turns_reached";
  terminationReason?: string;
}

export interface TaskState {
  taskId: string;
  /** 소유 팀. 외부 채널 기원은 빈 문자열. */
  team_id: string;
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
