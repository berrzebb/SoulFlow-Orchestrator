import { describe, it, expect } from "vitest";
import { RouteMatchJudge, SchemaMatchJudge, KeywordRuleJudge, CompositeJudge } from "../../src/evals/judges.js";
import type { EvalCase } from "../../src/evals/contracts.js";

describe("RouteMatchJudge", () => {
  const judge = new RouteMatchJudge();

  it("expected_route 미정의 시 통과", () => {
    const sc = judge.judge({ id: "c1", input: "test" }, "output");
    expect(sc.overall_passed).toBe(true);
    expect(sc.entries[0].dimension).toBe("route");
  });

  it("route 일치 시 통과", () => {
    const c: EvalCase = { id: "c1", input: "test", metadata: { expected_route: "agent", actual_route: "agent" } };
    const sc = judge.judge(c, "output");
    expect(sc.overall_passed).toBe(true);
    expect(sc.overall_score).toBe(1);
  });

  it("route 불일치 시 실패", () => {
    const c: EvalCase = { id: "c1", input: "test", metadata: { expected_route: "agent", actual_route: "direct" } };
    const sc = judge.judge(c, "output");
    expect(sc.overall_passed).toBe(false);
    expect(sc.entries[0].detail).toContain("expected agent");
  });

  it("actual_route 미설정 시 실패", () => {
    const c: EvalCase = { id: "c1", input: "test", metadata: { expected_route: "agent" } };
    const sc = judge.judge(c, "output");
    expect(sc.overall_passed).toBe(false);
    expect(sc.entries[0].detail).toContain("got none");
  });
});

describe("SchemaMatchJudge", () => {
  const judge = new SchemaMatchJudge();

  it("expected_keys 미정의 시 통과", () => {
    const sc = judge.judge({ id: "c1", input: "test" }, "anything");
    expect(sc.overall_passed).toBe(true);
  });

  it("모든 키 존재 시 통과", () => {
    const c: EvalCase = { id: "c1", input: "test", metadata: { expected_keys: ["name", "age"] } };
    const sc = judge.judge(c, JSON.stringify({ name: "John", age: 30 }));
    expect(sc.overall_passed).toBe(true);
    expect(sc.overall_score).toBe(1);
  });

  it("일부 키 누락 시 부분 점수", () => {
    const c: EvalCase = { id: "c1", input: "test", metadata: { expected_keys: ["name", "age", "email"] } };
    const sc = judge.judge(c, JSON.stringify({ name: "John" }));
    expect(sc.overall_passed).toBe(false);
    expect(sc.overall_score).toBeCloseTo(1 / 3);
    expect(sc.entries[0].detail).toContain("age");
    expect(sc.entries[0].detail).toContain("email");
  });

  it("유효하지 않은 JSON 시 실패", () => {
    const c: EvalCase = { id: "c1", input: "test", metadata: { expected_keys: ["name"] } };
    const sc = judge.judge(c, "not json");
    expect(sc.overall_passed).toBe(false);
    expect(sc.entries[0].detail).toContain("not valid JSON");
  });
});

describe("KeywordRuleJudge", () => {
  it("required 키워드 전부 존재 시 통과", () => {
    const judge = new KeywordRuleJudge({ required: ["hello", "world"] });
    const sc = judge.judge({ id: "c1", input: "test" }, "Hello World!");
    expect(sc.overall_passed).toBe(true);
  });

  it("required 키워드 누락 시 부분 점수", () => {
    const judge = new KeywordRuleJudge({ required: ["hello", "world", "foo"] });
    const sc = judge.judge({ id: "c1", input: "test" }, "Hello there");
    const entry = sc.entries.find((e) => e.dimension === "keyword_required")!;
    expect(entry.passed).toBe(false);
    expect(entry.score).toBeCloseTo(1 / 3);
  });

  it("forbidden 키워드 존재 시 실패", () => {
    const judge = new KeywordRuleJudge({ forbidden: ["error", "fail"] });
    const sc = judge.judge({ id: "c1", input: "test" }, "This has an error");
    const entry = sc.entries.find((e) => e.dimension === "keyword_forbidden")!;
    expect(entry.passed).toBe(false);
  });

  it("forbidden 키워드 미존재 시 통과", () => {
    const judge = new KeywordRuleJudge({ forbidden: ["error"] });
    const sc = judge.judge({ id: "c1", input: "test" }, "All good");
    const entry = sc.entries.find((e) => e.dimension === "keyword_forbidden")!;
    expect(entry.passed).toBe(true);
  });

  it("규칙 미정의 시 기본 통과", () => {
    const judge = new KeywordRuleJudge({});
    const sc = judge.judge({ id: "c1", input: "test" }, "anything");
    expect(sc.overall_passed).toBe(true);
  });
});

describe("CompositeJudge", () => {
  it("여러 judge 결합 → 단일 scorecard", () => {
    const judge = new CompositeJudge([
      new RouteMatchJudge(),
      new KeywordRuleJudge({ required: ["ok"] }),
    ]);
    const c: EvalCase = { id: "c1", input: "test", metadata: { expected_route: "direct", actual_route: "direct" } };
    const sc = judge.judge(c, "ok result");
    expect(sc.entries.length).toBeGreaterThanOrEqual(2);
    expect(sc.overall_passed).toBe(true);
  });

  it("하나라도 실패 시 overall_passed = false", () => {
    const judge = new CompositeJudge([
      new RouteMatchJudge(),
      new KeywordRuleJudge({ required: ["missing_keyword"] }),
    ]);
    const c: EvalCase = { id: "c1", input: "test", metadata: { expected_route: "agent", actual_route: "agent" } };
    const sc = judge.judge(c, "some output");
    expect(sc.overall_passed).toBe(false);
    expect(sc.overall_score).toBeGreaterThan(0); // route passed but keyword failed
    expect(sc.overall_score).toBeLessThan(1);
  });
});
