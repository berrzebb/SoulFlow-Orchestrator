import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export type SpawnRequest = {
  task: string;
  label?: string;
  role?: string;
  soul?: string;
  heart?: string;
  model?: string;
  max_turns?: number;
  origin_channel?: string;
  origin_chat_id?: string;
  metadata?: Record<string, unknown>;
};

export type SpawnCallback = (request: SpawnRequest) => Promise<{ subagent_id: string; status: string; message?: string }>;

export class SpawnTool extends Tool {
  readonly name = "spawn";
  readonly category = "spawn" as const;
  readonly description = "Spawn a headless subagent to run a background task.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      task: { type: "string", description: "Task description for the subagent" },
      label: { type: "string", description: "Optional short label for tracking" },
      role: { type: "string", description: "Optional role hint for subagent. Standard roles: implementer, debugger, reviewer, validator, pl, pm, concierge, generalist. Each role loads its SKILL.md soul/heart/protocols automatically." },
      soul: { type: "string", description: "Optional soul override — behavioral rule (e.g. '항상 가설 3개 이상 먼저 세운다'). Overrides role default." },
      heart: { type: "string", description: "Optional heart override — output style rule. Overrides role default." },
      model: { type: "string", description: "Optional model override" },
      max_turns: { type: "integer", minimum: 1, maximum: 500, description: "Turn budget for spawned loop" },
    },
    required: ["task"],
    additionalProperties: false,
  };
  private readonly spawn_callback: SpawnCallback;

  constructor(spawn_callback: SpawnCallback) {
    super();
    this.spawn_callback = spawn_callback;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    if (_context?.signal?.aborted) return JSON.stringify({ error: "cancelled" });
    const context = _context || {};
    const request: SpawnRequest = {
      task: String(params.task || ""),
      label: params.label ? String(params.label) : undefined,
      role: params.role ? String(params.role) : undefined,
      soul: params.soul ? String(params.soul) : undefined,
      heart: params.heart ? String(params.heart) : undefined,
      model: params.model ? String(params.model) : undefined,
      max_turns: params.max_turns ? Number(params.max_turns) : undefined,
      origin_channel: String(context.channel || "") || undefined,
      origin_chat_id: String(context.chat_id || "") || undefined,
      metadata: {
        parent_id: context?.task_id || undefined,
      },
    };
    const result = await this.spawn_callback(request);
    return JSON.stringify(result);
  }
}
