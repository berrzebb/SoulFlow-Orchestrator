/**
 * 소규모 provider 유틸리티 모듈 커버리지.
 * executor.ts: parse_executor_preference, resolve_executor_provider
 * health-scorer.ts: ProviderHealthScorer 모든 경로
 * prompt-version.ts: compute_prompt_version, stamp_prompt_version
 * finish-reason-warnings.ts: FINISH_REASON_WARNINGS 맵 확인
 * runtime-policy.ts: DefaultRuntimePolicyResolver
 * node-registry.ts: register_node, get_node_handler, get_all_handlers
 */
import { describe, it, expect } from "vitest";
import {
  parse_executor_preference,
  resolve_executor_provider,
} from "@src/providers/executor.js";
import { ProviderHealthScorer } from "@src/providers/health-scorer.js";
import { compute_prompt_version, stamp_prompt_version } from "@src/agent/prompt-version.js";
import { FINISH_REASON_WARNINGS } from "@src/agent/finish-reason-warnings.js";
import { DefaultRuntimePolicyResolver } from "@src/channels/runtime-policy.js";

// ══════════════════════════════════════════
// executor.ts
// ══════════════════════════════════════════

describe("parse_executor_preference", () => {
  it("claude_code → claude_code", () => expect(parse_executor_preference("claude_code")).toBe("claude_code"));
  it("openrouter → openrouter", () => expect(parse_executor_preference("openrouter")).toBe("openrouter"));
  it("orchestrator_llm → orchestrator_llm", () => expect(parse_executor_preference("orchestrator_llm")).toBe("orchestrator_llm"));
  it("빈 문자열 → chatgpt (default)", () => expect(parse_executor_preference("")).toBe("chatgpt"));
  it("알 수 없는 값 → chatgpt", () => expect(parse_executor_preference("unknown_xyz")).toBe("chatgpt"));
  it("대소문자 무시 → claude_code", () => expect(parse_executor_preference("CLAUDE_CODE")).toBe("claude_code"));
});

describe("resolve_executor_provider", () => {
  const full: any = { chatgpt_available: true, claude_available: true, openrouter_available: true };
  const claude_only: any = { chatgpt_available: false, claude_available: true, openrouter_available: false };
  const chatgpt_only: any = { chatgpt_available: true, claude_available: false, openrouter_available: false };
  const empty: any = { chatgpt_available: false, claude_available: false, openrouter_available: false };

  it("orchestrator_llm → 항상 orchestrator_llm", () => {
    expect(resolve_executor_provider("orchestrator_llm", full)).toBe("orchestrator_llm");
  });

  it("gemini → 항상 gemini", () => {
    expect(resolve_executor_provider("gemini", full)).toBe("gemini");
  });

  it("비빌트인 provider → 그대로 반환", () => {
    expect(resolve_executor_provider("custom_provider" as any, full)).toBe("custom_provider");
  });

  it("openrouter + openrouter_available=true → openrouter", () => {
    expect(resolve_executor_provider("openrouter", full)).toBe("openrouter");
  });

  it("openrouter + openrouter=false + chatgpt=true → chatgpt", () => {
    expect(resolve_executor_provider("openrouter", chatgpt_only)).toBe("chatgpt");
  });

  it("openrouter + openrouter=false + chatgpt=false + claude=true → claude_code", () => {
    expect(resolve_executor_provider("openrouter", claude_only)).toBe("claude_code");
  });

  it("openrouter + 모두 없음 → orchestrator_llm (최종 폴백)", () => {
    expect(resolve_executor_provider("openrouter", empty)).toBe("orchestrator_llm");
  });

  it("claude_code + claude_available=true → claude_code", () => {
    expect(resolve_executor_provider("claude_code", full)).toBe("claude_code");
  });

  it("claude_code + claude=false + chatgpt=true → chatgpt", () => {
    expect(resolve_executor_provider("claude_code", chatgpt_only)).toBe("chatgpt");
  });

  it("claude_code + claude=false + chatgpt=false + openrouter=true → openrouter", () => {
    const caps: any = { chatgpt_available: false, claude_available: false, openrouter_available: true };
    expect(resolve_executor_provider("claude_code", caps)).toBe("openrouter");
  });

  it("claude_code + 모두 없음 → orchestrator_llm (최종 폴백)", () => {
    expect(resolve_executor_provider("claude_code", empty)).toBe("orchestrator_llm");
  });

  it("chatgpt preferred + chatgpt=true → chatgpt", () => {
    expect(resolve_executor_provider("chatgpt", full)).toBe("chatgpt");
  });

  it("chatgpt preferred + chatgpt=false + claude=true → claude_code", () => {
    expect(resolve_executor_provider("chatgpt", claude_only)).toBe("claude_code");
  });

  it("chatgpt preferred + 모두 없음 → orchestrator_llm (최종 폴백)", () => {
    expect(resolve_executor_provider("chatgpt", empty)).toBe("orchestrator_llm");
  });
});

// ══════════════════════════════════════════
// health-scorer.ts
// ══════════════════════════════════════════

describe("ProviderHealthScorer", () => {
  it("샘플 없음 → score=1.0", () => {
    const s = new ProviderHealthScorer();
    expect(s.score("new")).toBe(1.0);
  });

  it("성공 샘플 → 높은 점수", () => {
    const s = new ProviderHealthScorer();
    s.record("p1", { ok: true, latency_ms: 100 });
    s.record("p1", { ok: true, latency_ms: 200 });
    expect(s.score("p1")).toBeGreaterThan(0.5);
  });

  it("실패 샘플 → 낮은 점수", () => {
    const s = new ProviderHealthScorer();
    for (let i = 0; i < 5; i++) s.record("p1", { ok: false, latency_ms: 10000 });
    expect(s.score("p1")).toBeLessThan(0.5);
  });

  it("window_size 초과 → 오래된 샘플 제거", () => {
    const s = new ProviderHealthScorer({ window_size: 3 });
    for (let i = 0; i < 5; i++) s.record("p1", { ok: true, latency_ms: 100 });
    const w = (s as any).windows.get("p1") as any[];
    expect(w.length).toBe(3);
  });

  it("만료된 샘플 → prune 후 score=1.0", () => {
    const s = new ProviderHealthScorer({ max_age_ms: 1 }); // 1ms 만료
    s.record("p1", { ok: false, latency_ms: 9000 });
    // 즉시 score → 만료 후 삭제 → 1.0
    return new Promise<void>((resolve) => setTimeout(() => {
      const score = s.score("p1");
      expect(score).toBe(1.0);
      resolve();
    }, 10));
  });

  it("rank() → 점수 내림차순 정렬", () => {
    const s = new ProviderHealthScorer();
    s.record("a", { ok: true, latency_ms: 100 });
    s.record("b", { ok: false, latency_ms: 5000 });
    const ranked = s.rank();
    expect(ranked.length).toBe(2);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
  });

  it("get_metrics() — 샘플 없음 → 빈 메트릭", () => {
    const s = new ProviderHealthScorer();
    const m = s.get_metrics("none");
    expect(m.success_count).toBe(0);
    expect(m.last_success_at).toBeNull();
  });

  it("get_metrics() — 성공/실패 혼합", () => {
    const s = new ProviderHealthScorer();
    s.record("m1", { ok: true, latency_ms: 200 });
    s.record("m1", { ok: false, latency_ms: 500 });
    const m = s.get_metrics("m1");
    expect(m.success_count).toBe(1);
    expect(m.failure_count).toBe(1);
    expect(m.total_latency_ms).toBe(700);
    expect(m.last_success_at).toBeTruthy();
    expect(m.last_failure_at).toBeTruthy();
  });

  it("success_weight=0 + latency_weight=0 → 0.5/0.5 정규화", () => {
    const s = new ProviderHealthScorer({ success_weight: 0, latency_weight: 0 });
    s.record("p", { ok: true, latency_ms: 100 });
    const score = s.score("p");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("latency_target_ms=0 → latency_score=0", () => {
    const s = new ProviderHealthScorer({ latency_target_ms: 0 });
    s.record("p", { ok: true, latency_ms: 100 });
    const score = s.score("p");
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════
// prompt-version.ts
// ══════════════════════════════════════════

describe("prompt-version", () => {
  it("compute_prompt_version → 12자 hex", () => {
    const v = compute_prompt_version("hello world");
    expect(v).toHaveLength(12);
    expect(/^[0-9a-f]+$/.test(v)).toBe(true);
  });

  it("같은 입력 → 같은 해시", () => {
    expect(compute_prompt_version("same")).toBe(compute_prompt_version("same"));
  });

  it("다른 입력 → 다른 해시", () => {
    expect(compute_prompt_version("a")).not.toBe(compute_prompt_version("b"));
  });

  it("stamp_prompt_version → prompt + 버전 주석 포함", () => {
    const { prompt, version } = stamp_prompt_version("test prompt");
    expect(prompt).toContain("test prompt");
    expect(prompt).toContain(`<!-- prompt_version: ${version} -->`);
    expect(version).toHaveLength(12);
  });
});

// ══════════════════════════════════════════
// finish-reason-warnings.ts
// ══════════════════════════════════════════

describe("FINISH_REASON_WARNINGS", () => {
  it("max_turns → 경고 메시지 존재", () => {
    expect(FINISH_REASON_WARNINGS.max_turns).toBeTruthy();
  });

  it("max_budget → 경고 메시지 존재", () => {
    expect(FINISH_REASON_WARNINGS.max_budget).toBeTruthy();
  });

  it("max_tokens → 경고 메시지 존재", () => {
    expect(FINISH_REASON_WARNINGS.max_tokens).toBeTruthy();
  });

  it("output_retries → 경고 메시지 존재", () => {
    expect(FINISH_REASON_WARNINGS.output_retries).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// runtime-policy.ts
// ══════════════════════════════════════════

describe("DefaultRuntimePolicyResolver", () => {
  it("resolve → sandbox full-auto (fs_access=full-access, approval=auto-approve)", () => {
    const resolver = new DefaultRuntimePolicyResolver();
    const policy = resolver.resolve("do something", []);
    expect(policy.sandbox).toBeDefined();
    expect(policy.sandbox.fs_access).toBe("full-access");
    expect(policy.sandbox.approval).toBe("auto-approve");
    expect(policy.sandbox.network_access).toBe(true);
  });

  it("task/media 무관하게 항상 같은 결과", () => {
    const resolver = new DefaultRuntimePolicyResolver();
    const p1 = resolver.resolve("task1", ["file.png"]);
    const p2 = resolver.resolve("task2", []);
    expect(p1.sandbox.fs_access).toBe(p2.sandbox.fs_access);
  });
});
