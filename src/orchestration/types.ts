import type { InboundMessage } from "../bus/types.js";
import type { ChannelProvider } from "../channels/types.js";

export type ExecutionMode = "once" | "agent" | "task";

export type OrchestrationRequest = {
  message: InboundMessage;
  alias: string;
  provider: ChannelProvider;
  media_inputs: string[];
  session_history: Array<{ role: string; content: string }>;
  skill_names: string[];
  on_stream?: (chunk: string) => void;
  signal?: AbortSignal;
  /** TaskResumeService가 재개한 Task ID. 이 값이 있으면 새 orchestration 대신 기존 Task을 이어서 실행. */
  resumed_task_id?: string;
};

export type OrchestrationResult = {
  reply: string | null;
  error?: string;
  suppress_reply?: boolean;
  mode: ExecutionMode;
  tool_calls_count: number;
  streamed: boolean;
  stream_full_content?: string;
};
