import type { ProviderId } from "./types.js";

export type ExecutorProvider = ProviderId;

export type ProviderCapabilities = {
  chatgpt_available: boolean;
  claude_available: boolean;
  openrouter_available: boolean;
};

export function parse_executor_preference(raw: string): ExecutorProvider {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "claude_code" || normalized === "claude_cli" || normalized === "claude_sdk") return "claude_code";
  if (normalized === "codex_cli" || normalized === "codex_appserver") return "chatgpt";
  if (normalized === "openrouter") return "openrouter";
  if (normalized === "orchestrator_llm") return "orchestrator_llm";
  if (normalized === "gemini" || normalized === "gemini_cli") return "gemini";
  return "chatgpt";
}

const BUILTIN_PROVIDERS = new Set(["chatgpt", "claude_code", "openrouter", "orchestrator_llm", "gemini"]);

export function resolve_executor_provider(
  preferred: ExecutorProvider,
  caps: ProviderCapabilities,
): ExecutorProvider {
  if (!BUILTIN_PROVIDERS.has(preferred)) return preferred;
  if (preferred === "orchestrator_llm") return "orchestrator_llm";
  if (preferred === "gemini") return "gemini";
  if (preferred === "openrouter") {
    if (caps.openrouter_available) return "openrouter";
    if (caps.chatgpt_available) return "chatgpt";
    if (caps.claude_available) return "claude_code";
    return "orchestrator_llm";
  }
  if (preferred === "claude_code") {
    if (caps.claude_available) return "claude_code";
    if (caps.chatgpt_available) return "chatgpt";
    if (caps.openrouter_available) return "openrouter";
    return "orchestrator_llm";
  }
  if (caps.chatgpt_available) return "chatgpt";
  if (caps.claude_available) return "claude_code";
  if (caps.openrouter_available) return "openrouter";
  return "orchestrator_llm";
}
