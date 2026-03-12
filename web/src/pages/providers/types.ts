export interface ProviderInstance {
  instance_id: string;
  provider_type: string;
  label: string;
  enabled: boolean;
  priority: number;
  model_purpose: "chat" | "embedding";
  supported_modes: string[];
  settings: Record<string, unknown>;
  connection_id?: string;
  created_at: string;
  updated_at: string;
  available: boolean;
  circuit_state: string;
  capabilities: Record<string, boolean> | null;
  token_configured: boolean;
}

export interface ProviderConnection {
  connection_id: string;
  provider_type: string;
  label: string;
  enabled: boolean;
  api_base?: string;
  token_configured: boolean;
  preset_count: number;
  created_at: string;
  updated_at: string;
}

export interface CliAuthStatus {
  cli: string;
  authenticated: boolean;
  account?: string;
  error?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  purpose: "chat" | "embedding" | "both";
  context_length?: number;
  pricing_input?: number;
  pricing_output?: number;
  cost_score?: number;
}

export type ModalMode = { kind: "add"; defaultPurpose?: "chat" | "embedding" } | { kind: "edit"; instance: ProviderInstance };
export type ConnectionModalMode = { kind: "add" } | { kind: "edit"; connection: ProviderConnection };

export const MODE_OPTIONS = ["once", "agent", "task"] as const;
export const PURPOSE_OPTIONS = ["chat", "embedding"] as const;

export const TYPES_WITH_SETTINGS = new Set(["openai_compatible", "openrouter", "ollama"]);

/** 모델 목록 동적 조회를 지원하는 프로바이더 타입. */
export const TYPES_WITH_MODELS = new Set([
  "openrouter", "openai_compatible", "claude_sdk", "claude_cli",
  "gemini_cli", "codex_cli", "codex_appserver", "container_cli", "ollama",
]);
