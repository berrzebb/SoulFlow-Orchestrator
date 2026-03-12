/** 프로바이더별 설정 타입. AgentProviderConfig.settings의 구체 타입. */

import type { SecretMapping } from "./pty/secret-reader.js";

/** CLI 백엔드 공통 설정 (claude_cli, codex_cli, gemini_cli, container_cli). */
export interface CliProviderSettings {
  command?: string;
  args?: string;
  timeout_ms?: number;
  cwd?: string;
  env?: Record<string, string>;
  secret_mappings?: SecretMapping[];
  execution_mode?: "local" | "docker";
  image?: string;
  max_idle_ms?: number;
  auth_profiles?: AuthProfile[];
  auth_profile_count?: number;
  fallback_configured?: boolean;
}

export interface AuthProfile {
  env?: Record<string, string>;
}

export interface CodexCliSettings extends CliProviderSettings {
  bypass_sandbox?: boolean;
  sandbox_mode?: string;
  additional_dirs?: string;
}

export interface ClaudeCliSettings extends CliProviderSettings {
  permission_mode?: string;
}

export interface GeminiCliSettings extends CliProviderSettings {
  approval_mode?: string;
}

export interface ContainerCliSettings extends CliProviderSettings {
  cli_type?: "claude" | "codex" | "gemini";
}

/** Claude SDK 백엔드 설정. */
export interface ClaudeSdkSettings {
  cwd?: string;
  model?: string;
  max_budget_usd?: number;
}

/** Codex AppServer 백엔드 설정. */
export interface CodexAppServerSettings {
  cwd?: string;
  command?: string;
  model?: string;
  request_timeout_ms?: number;
}

/** OpenAI 호환 백엔드 설정 (openai_compatible, openrouter, ollama). */
export interface OpenAiCompatibleSettings {
  api_base?: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  request_timeout_ms?: number;
}

export interface OpenRouterSettings extends OpenAiCompatibleSettings {
  site_url?: string;
  app_name?: string;
  http_referer?: string;
  app_title?: string;
}

export interface OllamaSettings extends OpenAiCompatibleSettings {
  no_tool_choice?: boolean;
}

/** 알려진 프로바이더 설정 유니온. 저장소에서 로드한 후 provider_type에 따라 캐스팅. */
export type AnyProviderSettings =
  | CliProviderSettings
  | CodexCliSettings
  | ClaudeCliSettings
  | GeminiCliSettings
  | ContainerCliSettings
  | ClaudeSdkSettings
  | CodexAppServerSettings
  | OpenAiCompatibleSettings
  | OpenRouterSettings
  | OllamaSettings
  | Record<string, unknown>;
