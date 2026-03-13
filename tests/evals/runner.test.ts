import { describe, it, expect, vi } from "vitest";
import { EvalRunner } from "../../src/evals/runner.js";
import { EXACT_MATCH_SCORER, CONTAINS_SCORER, REGEX_SCORER } from "../../src/evals/scorers.js";
import type { EvalDataset, EvalExecutorLike, EvalScorerLike } from "../../src/evals/contracts.js";

/* ── mock executor ─────────────────────────── */

function make_executor(responses: Record<string, string>): EvalExecutorLike {
  return {
    async execute(input) {
      const output = responses[input];
      if (output === undefined) return { output: "", error: `unknown input: ${input}` };
      return { output };
    },
  };
}

const SAMPLE_DATASET: EvalDataset = {
  name: "sample",
  cases: [
    { id: "c1", input: "hello", expected: "hello world" },
    { id: "c2", input: "bye", expected: "goodbye" },
    { id: "c3", input: "math", expected: "42" },
  ],
};

/* ── EvalRunner ─────────────────────────────── */

describe("EvalRunner", () => {
  it("전체 데이터셋 실행 + 요약 통계", async () => {
    const executor = make_executor({ hello: "hello world!", bye: "see you", math: "42" });
    const runner = new EvalRunner(executor, CONTAINS_SCORER);
    const summary = await runner.run_dataset(SAMPLE_DATASET);

    expect(summary.dataset).toBe("sample");
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(2); // "hello world!" contains "hello world", "42" contains "42"
    expect(summary.failed).toBe(1); // "see you" does not contain "goodbye"
    expect(summary.error_count).toBe(0);
    expect(summary.duration_ms).toBeGreaterThanOrEqual(0);
    expect(summary.results).toHaveLength(3);
  });

  it("EXACT_MATCH_SCORER 사용", async () => {
    const executor = make_executor({ hello: "Hello World" });
    const runner = new EvalRunner(executor, EXACT_MATCH_SCORER);
    const result = await runner.run_case(
      { id: "e1", input: "hello", expected: "hello world" },
      "test",
    );
    expect(result.passed).toBe(true); // case-insensitive, trimmed
    expect(result.score).toBe(1);
  });

  it("EXACT_MATCH_SCORER 실패 케이스", async () => {
    const executor = make_executor({ hello: "hi there" });
    const runner = new EvalRunner(executor, EXACT_MATCH_SCORER);
    const result = await runner.run_case(
      { id: "e2", input: "hello", expected: "hello world" },
      "test",
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it("REGEX_SCORER 정규식 매치", async () => {
    const executor = make_executor({ hello: "The answer is 42." });
    const runner = new EvalRunner(executor, REGEX_SCORER);
    const result = await runner.run_case(
      { id: "r1", input: "hello", expected: "answer.*\\d+" },
      "test",
    );
    expect(result.passed).toBe(true);
  });

  it("REGEX_SCORER 잘못된 정규식 → 실패 (에러 아님)", async () => {
    const executor = make_executor({ hello: "anything" });
    const runner = new EvalRunner(executor, REGEX_SCORER);
    const result = await runner.run_case(
      { id: "r2", input: "hello", expected: "[invalid(" },
      "test",
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it("expected 미지정 시 항상 통과", async () => {
    const executor = make_executor({ hello: "anything" });
    const runner = new EvalRunner(executor, EXACT_MATCH_SCORER);
    const result = await runner.run_case(
      { id: "n1", input: "hello" },
      "test",
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("executor 에러 → error 필드 설정 + passed=false", async () => {
    const executor = make_executor({});
    const runner = new EvalRunner(executor);
    const result = await runner.run_case(
      { id: "err1", input: "unknown", expected: "something" },
      "test",
    );
    expect(result.passed).toBe(false);
    expect(result.error).toContain("unknown input");
  });

  it("executor 예외 → error 필드에 메시지 캡처", async () => {
    const executor: EvalExecutorLike = {
      async execute() { throw new Error("boom"); },
    };
    const runner = new EvalRunner(executor);
    const result = await runner.run_case(
      { id: "ex1", input: "test" },
      "test",
    );
    expect(result.passed).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("태그 필터 적용", async () => {
    const dataset: EvalDataset = {
      name: "tagged",
      cases: [
        { id: "t1", input: "a", expected: "a", tags: ["fast"] },
        { id: "t2", input: "b", expected: "b", tags: ["slow"] },
        { id: "t3", input: "c", expected: "c", tags: ["fast", "important"] },
      ],
    };
    const executor = make_executor({ a: "a", b: "b", c: "c" });
    const runner = new EvalRunner(executor, CONTAINS_SCORER, { filter_tags: ["fast"] });
    const summary = await runner.run_dataset(dataset);
    expect(summary.total).toBe(2);
    expect(summary.results.map((r) => r.case_id).sort()).toEqual(["t1", "t3"]);
  });

  it("타임아웃 초과 시 에러", async () => {
    const executor: EvalExecutorLike = {
      execute: () => new Promise((resolve) => setTimeout(() => resolve({ output: "late" }), 500)),
    };
    const runner = new EvalRunner(executor, CONTAINS_SCORER, { timeout_ms: 50 });
    const result = await runner.run_case(
      { id: "to1", input: "slow", expected: "late" },
      "test",
    );
    expect(result.passed).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("기본 scorer는 CONTAINS_SCORER", async () => {
    const executor = make_executor({ hello: "say hello world!" });
    const runner = new EvalRunner(executor);
    const result = await runner.run_case(
      { id: "d1", input: "hello", expected: "hello world" },
      "test",
    );
    expect(result.passed).toBe(true);
  });

  it("빈 데이터셋 실행", async () => {
    const executor = make_executor({});
    const runner = new EvalRunner(executor);
    const summary = await runner.run_dataset({ name: "empty", cases: [] });
    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it("커스텀 scorer DI", async () => {
    const custom_scorer: EvalScorerLike = {
      score(_input, _expected, actual) {
        const score = actual.length > 5 ? 1 : 0;
        return { passed: score === 1, score };
      },
    };
    const executor = make_executor({ short: "hi", long: "hello world" });
    const runner = new EvalRunner(executor, custom_scorer);
    const r1 = await runner.run_case({ id: "s1", input: "short" }, "test");
    const r2 = await runner.run_case({ id: "s2", input: "long" }, "test");
    expect(r1.passed).toBe(false);
    expect(r2.passed).toBe(true);
  });

  it("duration_ms 측정", async () => {
    const executor: EvalExecutorLike = {
      execute: () => new Promise((resolve) => setTimeout(() => resolve({ output: "ok" }), 20)),
    };
    const runner = new EvalRunner(executor);
    const result = await runner.run_case({ id: "d1", input: "test" }, "test");
    expect(result.duration_ms).toBeGreaterThanOrEqual(15);
  });
});
