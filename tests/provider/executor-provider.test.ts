import { describe, it, expect } from "vitest";
import { parse_executor_preference, resolve_executor_provider } from "@src/providers/executor.js";
import type { ProviderCapabilities } from "@src/providers/executor.js";

describe("parse_executor_preference", () => {
  it("대소문자 무시하여 정규화", () => {
    expect(parse_executor_preference("ChatGPT")).toBe("chatgpt");
    expect(parse_executor_preference("CLAUDE_CODE")).toBe("claude_code");
    expect(parse_executor_preference("OpenRouter")).toBe("openrouter");
    expect(parse_executor_preference("PHI4_LOCAL")).toBe("phi4_local");
  });

  it("알 수 없는 값 → chatgpt (기본값)", () => {
    expect(parse_executor_preference("unknown")).toBe("chatgpt");
    expect(parse_executor_preference("")).toBe("chatgpt");
    expect(parse_executor_preference("  ")).toBe("chatgpt");
  });
});

describe("resolve_executor_provider", () => {
  const ALL_AVAILABLE: ProviderCapabilities = {
    chatgpt_available: true,
    claude_available: true,
    openrouter_available: true,
  };

  const NONE_AVAILABLE: ProviderCapabilities = {
    chatgpt_available: false,
    claude_available: false,
    openrouter_available: false,
  };

  it("phi4_local → 항상 phi4_local (caps 무관)", () => {
    expect(resolve_executor_provider("phi4_local", ALL_AVAILABLE)).toBe("phi4_local");
    expect(resolve_executor_provider("phi4_local", NONE_AVAILABLE)).toBe("phi4_local");
  });

  it("chatgpt 선호 + chatgpt 가용 → chatgpt", () => {
    expect(resolve_executor_provider("chatgpt", ALL_AVAILABLE)).toBe("chatgpt");
  });

  it("chatgpt 선호 + chatgpt 불가 + claude 가용 → claude_code", () => {
    expect(resolve_executor_provider("chatgpt", {
      chatgpt_available: false,
      claude_available: true,
      openrouter_available: false,
    })).toBe("claude_code");
  });

  it("chatgpt 선호 + chatgpt 불가 + openrouter 가용 → openrouter", () => {
    expect(resolve_executor_provider("chatgpt", {
      chatgpt_available: false,
      claude_available: false,
      openrouter_available: true,
    })).toBe("openrouter");
  });

  it("chatgpt 선호 + 전부 불가 → chatgpt (원래 선호 반환)", () => {
    expect(resolve_executor_provider("chatgpt", NONE_AVAILABLE)).toBe("chatgpt");
  });

  it("openrouter 선호 + openrouter 가용 → openrouter", () => {
    expect(resolve_executor_provider("openrouter", ALL_AVAILABLE)).toBe("openrouter");
  });

  it("openrouter 선호 + openrouter 불가 + chatgpt 가용 → chatgpt", () => {
    expect(resolve_executor_provider("openrouter", {
      chatgpt_available: true,
      claude_available: false,
      openrouter_available: false,
    })).toBe("chatgpt");
  });

  it("claude_code 선호 + claude 가용 → claude_code", () => {
    expect(resolve_executor_provider("claude_code", ALL_AVAILABLE)).toBe("claude_code");
  });

  it("claude_code 선호 + claude 불가 + chatgpt 가용 → chatgpt", () => {
    expect(resolve_executor_provider("claude_code", {
      chatgpt_available: true,
      claude_available: false,
      openrouter_available: false,
    })).toBe("chatgpt");
  });
});
