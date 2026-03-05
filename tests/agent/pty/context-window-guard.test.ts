import { describe, it, expect } from "vitest";
import { evaluate_context_window_guard } from "@src/agent/pty/context-window-guard.ts";

describe("evaluate_context_window_guard", () => {
  it("짧은 프롬프트는 ok: true", () => {
    const result = evaluate_context_window_guard({ prompt_chars: 100 });
    expect(result.ok).toBe(true);
    expect(result.estimated_tokens).toBe(25); // 100 / 4
  });

  it("hard_min_tokens 초과 시 hard_block", () => {
    // default hard_min=16000, 64000 chars / 4 = 16000 tokens → hard_block
    const result = evaluate_context_window_guard({ prompt_chars: 64_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hard_block");
  });

  it("warn_below_tokens 이상 hard_min 미만이면 warn", () => {
    // 5000 chars / 4 = 1250 tokens → warn_below(1000) <= 1250 < hard_min(2000) → warn
    const result = evaluate_context_window_guard({
      prompt_chars: 5000,
      hard_min_tokens: 2000,
      warn_below_tokens: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("warn");
  });

  it("warn 범위 정확히 테스트", () => {
    // warn: estimated >= warn_below, hard: estimated >= hard_min
    // hard_min > warn_below일 때, warn_below <= estimated < hard_min → warn
    const result = evaluate_context_window_guard({
      prompt_chars: 6000, // 1500 tokens
      chars_per_token: 4,
      hard_min_tokens: 2000,
      warn_below_tokens: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("warn");
  });

  it("커스텀 chars_per_token 적용", () => {
    const result = evaluate_context_window_guard({
      prompt_chars: 300,
      chars_per_token: 3,
    });
    expect(result.estimated_tokens).toBe(100); // 300 / 3
  });

  it("빈 프롬프트는 ok: true", () => {
    const result = evaluate_context_window_guard({ prompt_chars: 0 });
    expect(result.ok).toBe(true);
    expect(result.estimated_tokens).toBe(0);
  });
});
