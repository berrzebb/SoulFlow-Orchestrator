import type { ProviderId } from "./types.js";

export type ExecutorProvider = ProviderId;

export type ProviderCapabilities = {
  chatgpt_available: boolean;
  claude_available: boolean;
  openrouter_available: boolean;
};

export function parse_executor_preference(raw: string): ExecutorProvider {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "claude_code") return "claude_code";
  if (normalized === "openrouter") return "openrouter";
  if (normalized === "orchestrator_llm") return "orchestrator_llm";
  return "chatgpt";
}

export function resolve_executor_provider(
  preferred: ExecutorProvider,
  caps: ProviderCapabilities,
): ExecutorProvider {
  if (preferred === "orchestrator_llm") return "orchestrator_llm";
  if (preferred === "openrouter") {
    if (caps.openrouter_available) return "openrouter";
    if (caps.chatgpt_available) return "chatgpt";
    if (caps.claude_available) return "claude_code";
    return preferred;
  }
  if (preferred === "claude_code") {
    if (caps.claude_available) return "claude_code";
    if (caps.chatgpt_available) return "chatgpt";
    if (caps.openrouter_available) return "openrouter";
    return preferred;
  }
  if (caps.chatgpt_available) return "chatgpt";
  if (caps.claude_available) return "claude_code";
  if (caps.openrouter_available) return "openrouter";
  return preferred;
}
