import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export type TaskQueryResult = {
  task_id: string;
  title?: string;
  status: string;
  current_step?: string;
  exit_reason?: string;
  current_turn?: number;
  max_turns?: number;
  updated_at?: string;
};

export type TaskQueryCallback = (task_id: string) => Promise<TaskQueryResult | null>;

/** 스폰된 서브에이전트/백그라운드 작업의 현재 상태를 조회하는 도구. */
export class TaskQueryTool extends Tool {
  readonly name = "task_query";
  readonly description = "spawn 도구로 실행한 서브에이전트/작업의 현재 상태 조회.";
  readonly parameters: JsonSchema = {
    type: "object",
    required: ["task_id"],
    properties: {
      task_id: { type: "string", description: "spawn 도구가 반환한 subagent_id 또는 task_id" },
    },
    additionalProperties: false,
  };

  private readonly query_callback: TaskQueryCallback;

  constructor(query_callback: TaskQueryCallback) {
    super();
    this.query_callback = query_callback;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const task_id = String(params.task_id || "").trim();
    if (!task_id) return "Error: task_id is required";
    const result = await this.query_callback(task_id);
    if (!result) return JSON.stringify({ error: "not_found", task_id });
    return JSON.stringify(result);
  }
}
