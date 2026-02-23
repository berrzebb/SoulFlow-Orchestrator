import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export type SpawnRequest = {
  task: string;
  label?: string;
  role?: string;
  model?: string;
  max_turns?: number;
  origin_channel?: string;
  origin_chat_id?: string;
  metadata?: Record<string, unknown>;
};

export type SpawnCallback = (request: SpawnRequest) => Promise<{ subagent_id: string; status: string; message?: string }>;

export class SpawnTool extends Tool {
  readonly name = "spawn";
  readonly description = "Spawn a headless subagent to run a background task.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      task: { type: "string", description: "Task description for the subagent" },
      label: { type: "string", description: "Optional short label for tracking" },
      role: { type: "string", description: "Optional role hint for subagent" },
      model: { type: "string", description: "Optional model override" },
      max_turns: { type: "integer", minimum: 1, maximum: 500, description: "Turn budget for spawned loop" },
    },
    required: ["task"],
    additionalProperties: false,
  };
  private readonly spawn_callback: SpawnCallback;
  private origin_channel = "";
  private origin_chat_id = "";

  constructor(spawn_callback: SpawnCallback) {
    super();
    this.spawn_callback = spawn_callback;
  }

  set_context(channel: string, chat_id: string): void {
    this.origin_channel = channel;
    this.origin_chat_id = chat_id;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const context = _context || {};
    const request: SpawnRequest = {
      task: String(params.task || ""),
      label: params.label ? String(params.label) : undefined,
      role: params.role ? String(params.role) : undefined,
      model: params.model ? String(params.model) : undefined,
      max_turns: params.max_turns ? Number(params.max_turns) : undefined,
      origin_channel: String(context.channel || this.origin_channel || "") || undefined,
      origin_chat_id: String(context.chat_id || this.origin_chat_id || "") || undefined,
      metadata: {},
    };
    const result = await this.spawn_callback(request);
    return JSON.stringify(result);
  }
}
