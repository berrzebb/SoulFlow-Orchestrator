export type JsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean;
  description?: string;
};

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export type ToolExecuteResult = string;

export type ToolExecutionContext = {
  signal?: AbortSignal;
  task_id?: string;
  channel?: string;
  chat_id?: string;
  sender_id?: string;
};

export interface ToolLike {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolExecuteResult>;
  validate_params(params: Record<string, unknown>): string[];
  to_schema(): ToolSchema;
}

export type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type BackgroundTaskRecord = {
  id: string;
  tool_name: string;
  params: Record<string, unknown>;
  status: BackgroundTaskStatus;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  result?: string;
  error?: string;
};

export type BackgroundExecuteResult = {
  task_id: string;
  status: BackgroundTaskStatus;
};
