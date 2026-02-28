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
