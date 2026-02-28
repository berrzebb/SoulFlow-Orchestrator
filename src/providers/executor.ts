import type { ProviderId } from "./types.js";

export type ExecutorProvider = ProviderId;

export function parse_executor_preference(raw: string): ExecutorProvider {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "claude_code") return "claude_code";
  if (normalized === "openrouter") return "openrouter";
  if (normalized === "phi4_local") return "phi4_local";
  return "chatgpt";
}

export function resolve_executor_provider(preferred: ExecutorProvider): ExecutorProvider {
  const chatgpt_headless = String(process.env.CHATGPT_HEADLESS_COMMAND || "").trim();
  const claude_headless = String(process.env.CLAUDE_HEADLESS_COMMAND || "").trim();
  const allow_claude = String(process.env.ALLOW_CLAUDE_CODE_EXECUTOR || "0").trim() === "1";
  const openrouter_api_key = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (preferred === "phi4_local") return "phi4_local";
  if (preferred === "openrouter") {
    if (openrouter_api_key) return "openrouter";
    if (chatgpt_headless) return "chatgpt";
    if (allow_claude && claude_headless) return "claude_code";
    return preferred;
  }
  if (preferred === "claude_code") {
    if (allow_claude && claude_headless) return "claude_code";
    if (chatgpt_headless) return "chatgpt";
    if (openrouter_api_key) return "openrouter";
    return preferred;
  }
  if (chatgpt_headless) return "chatgpt";
  if (allow_claude && claude_headless) return "claude_code";
  if (openrouter_api_key) return "openrouter";
  return preferred;
}
