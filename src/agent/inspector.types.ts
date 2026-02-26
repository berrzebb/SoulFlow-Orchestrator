import type { TaskState } from "../contracts.js";
import type { SubagentRef } from "./subagents.js";

export interface AgentInspectorLike {
  list_runtime_tasks(): TaskState[];
  list_stored_tasks(): Promise<TaskState[]>;
  list_subagents(): SubagentRef[];
}
