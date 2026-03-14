/**
 * EG-5: GuardrailEvalExecutor + guardrails bundle 테스트.
 *
 * - session_reuse 4개 시나리오 (exact, similar, new, empty history)
 * - budget 4개 시나리오 (exceeded, at-limit, within, disabled)
 * - 잘못된 입력 에러 처리
 * - guardrails bundle 등록 + 데이터셋 로드
 * - eval runner 통합: 전체 데이터셋 실행 → 8/8 통과
 */
import { describe, it, expect, beforeEach } from "vitest";
import { create_guardrail_executor } from "@src/evals/guardrail-executor.js";
import {
  clear_registry, register_bundle, get_bundle,
  load_bundle_datasets,
} from "@src/evals/bundles.js";
import { EvalRunner } from "@src/evals/runner.js";
import { EXACT_MATCH_SCORER } from "@src/evals/scorers.js";

const executor = create_guardrail_executor();

// ── session_reuse ──

describe("guardrail executor — session_reuse", () => {
  it("동일 질문 반복 → reuse_summary", async () => {
    const input = JSON.stringify({
      type: "session_reuse",
      query: "오늘 날씨 어때?",
      session_history: [
        { role: "user", content: "오늘 날씨 어때?" },
        { role: "assistant", content: "서울은 맑음입니다." },
        { role: "user", content: "오늘 날씨 어때?" },
      ],
      freshness_window_ms: 300_000,
    });
    const result = await executor.execute(input);
    expect(result.output).toBe("reuse_summary");
    expect(result.error).toBeUndefined();
  });

  it("유사 질문 (단어 추가) → same_topic", async () => {
    // Jaccard: {오늘, 서울, 날씨, 어때} ∩ {오늘, 서울, 날씨, 기온, 어때} = 4/5 = 0.8
    // threshold 0.7 → same_topic (0.8 ≥ 0.7, < 0.999)
    const input = JSON.stringify({
      type: "session_reuse",
      query: "오늘 서울 날씨 기온 어때",
      session_history: [
        { role: "user", content: "오늘 서울 날씨 어때" },
        { role: "assistant", content: "서울은 맑음입니다." },
        { role: "user", content: "오늘 서울 날씨 기온 어때" },
      ],
      freshness_window_ms: 300_000,
      similarity_threshold: 0.7,
    });
    const result = await executor.execute(input);
    expect(result.output).toBe("same_topic");
  });

  it("완전히 다른 질문 → new_search", async () => {
    const input = JSON.stringify({
      type: "session_reuse",
      query: "주식 시장 분석해줘",
      session_history: [
        { role: "user", content: "오늘 날씨 어때?" },
        { role: "assistant", content: "서울은 맑음입니다." },
        { role: "user", content: "주식 시장 분석해줘" },
      ],
      freshness_window_ms: 300_000,
    });
    const result = await executor.execute(input);
    expect(result.output).toBe("new_search");
  });

  it("히스토리 1건 (자기 자신 제외) → new_search", async () => {
    const input = JSON.stringify({
      type: "session_reuse",
      query: "안녕하세요",
      session_history: [{ role: "user", content: "안녕하세요" }],
      freshness_window_ms: 300_000,
    });
    const result = await executor.execute(input);
    expect(result.output).toBe("new_search");
  });
});

// ── budget ──

describe("guardrail executor — budget", () => {
  it("사용량 > 한도 → budget_exceeded", async () => {
    const input = JSON.stringify({ type: "budget", max_tool_calls: 5, used_tool_calls: 6 });
    const result = await executor.execute(input);
    expect(result.output).toBe("budget_exceeded");
  });

  it("사용량 == 한도 → budget_exceeded", async () => {
    const input = JSON.stringify({ type: "budget", max_tool_calls: 5, used_tool_calls: 5 });
    const result = await executor.execute(input);
    expect(result.output).toBe("budget_exceeded");
  });

  it("사용량 < 한도 → within_budget", async () => {
    const input = JSON.stringify({ type: "budget", max_tool_calls: 10, used_tool_calls: 3 });
    const result = await executor.execute(input);
    expect(result.output).toBe("within_budget");
  });

  it("한도 0 → within_budget (비활성)", async () => {
    const input = JSON.stringify({ type: "budget", max_tool_calls: 0, used_tool_calls: 100 });
    const result = await executor.execute(input);
    expect(result.output).toBe("within_budget");
  });
});

// ── 에러 처리 ──

describe("guardrail executor — error handling", () => {
  it("잘못된 JSON → error", async () => {
    const result = await executor.execute("not json");
    expect(result.error).toBeTruthy();
    expect(result.output).toBe("");
  });

  it("알 수 없는 type → error", async () => {
    const result = await executor.execute(JSON.stringify({ type: "unknown" }));
    expect(result.error).toContain("unknown guardrail type");
  });
});

// ── bundle + eval runner 통합 ──

describe("guardrails bundle", () => {
  beforeEach(() => { clear_registry(); });

  it("guardrails 번들 등록 + 데이터셋 로드", () => {
    register_bundle({
      name: "guardrails",
      description: "실행 가드레일 결정 회귀 평가",
      dataset_files: ["tests/evals/cases/guardrails.json"],
      smoke: true,
      tags: ["smoke"],
    });
    const bundle = get_bundle("guardrails");
    expect(bundle).toBeTruthy();
    const datasets = load_bundle_datasets(bundle!);
    expect(datasets).toHaveLength(1);
    expect(datasets[0].name).toBe("guardrails");
    expect(datasets[0].cases).toHaveLength(8);
  });

  it("eval runner 통합 — 전체 케이스 통과", async () => {
    register_bundle({
      name: "guardrails",
      description: "실행 가드레일 결정 회귀 평가",
      dataset_files: ["tests/evals/cases/guardrails.json"],
      smoke: true,
    });
    const datasets = load_bundle_datasets(get_bundle("guardrails")!);
    const runner = new EvalRunner(executor, EXACT_MATCH_SCORER);
    const summary = await runner.run_dataset(datasets[0]);
    expect(summary.total).toBe(8);
    expect(summary.passed).toBe(8);
    expect(summary.failed).toBe(0);
    expect(summary.error_count).toBe(0);
  });
});
