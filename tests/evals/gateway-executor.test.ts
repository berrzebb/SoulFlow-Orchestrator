/**
 * GW-2: Gateway Eval Executor 테스트.
 *
 * 대상:
 * - create_gateway_executor(): classify/cost_tier/normalize 입력 타입
 * - gateway 번들 로드 + EvalRunner 통합
 */

import { describe, it, expect, beforeEach } from "vitest";
import { create_gateway_executor } from "@src/evals/gateway-executor.js";
import { EvalRunner } from "@src/evals/runner.js";
import { EXACT_MATCH_SCORER } from "@src/evals/scorers.js";
import { get_bundle, load_bundle_datasets, clear_registry } from "@src/evals/bundles.js";
import type { EvalExecutorLike } from "@src/evals/contracts.js";

let executor: EvalExecutorLike;

beforeEach(() => {
  executor = create_gateway_executor();
});

describe("gateway executor — classify", () => {
  it("identity 분류", async () => {
    const result = await executor.execute(JSON.stringify({ type: "classify", text: "너 누구야" }));
    expect(result.output).toBe("identity");
  });

  it("builtin 분류", async () => {
    const result = await executor.execute(JSON.stringify({ type: "classify", text: "/help" }));
    expect(result.output).toBe("builtin");
  });

  it("once 분류", async () => {
    const result = await executor.execute(JSON.stringify({ type: "classify", text: "오늘 날씨 알려줘" }));
    expect(result.output).toBe("once");
  });

  it("agent 분류", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "classify", text: "이 파일을 분석하고 보고서를 작성해줘",
    }));
    expect(result.output).toBe("agent");
  });
});

describe("gateway executor — cost_tier", () => {
  it("identity → no_token", async () => {
    const result = await executor.execute(JSON.stringify({ type: "cost_tier", text: "너 누구야" }));
    expect(result.output).toBe("no_token");
  });

  it("builtin → no_token", async () => {
    const result = await executor.execute(JSON.stringify({ type: "cost_tier", text: "/help" }));
    expect(result.output).toBe("no_token");
  });

  it("once → model_direct", async () => {
    const result = await executor.execute(JSON.stringify({ type: "cost_tier", text: "오늘 날씨 알려줘" }));
    expect(result.output).toBe("model_direct");
  });

  it("agent → agent_required", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "cost_tier", text: "이 파일을 분석하고 보고서를 작성해줘",
    }));
    expect(result.output).toBe("agent_required");
  });
});

describe("gateway executor — normalize", () => {
  it("Slack 멘션 제거", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "normalize", text: "<@U12345> 안녕하세요", provider: "slack",
    }));
    expect(result.output).toBe("안녕하세요");
  });

  it("Telegram 봇명 제거", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "normalize", text: "/start@mybot", provider: "telegram",
    }));
    expect(result.output).toBe("/start");
  });

  it("Web 그대로 통과", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "normalize", text: "hello world", provider: "web",
    }));
    expect(result.output).toBe("hello world");
  });
});

describe("gateway executor — 에러 처리", () => {
  it("잘못된 JSON → 에러", async () => {
    const result = await executor.execute("not json");
    expect(result.error).toBeTruthy();
    expect(result.output).toBe("");
  });

  it("unknown type → 에러", async () => {
    const result = await executor.execute(JSON.stringify({ type: "unknown" }));
    expect(result.error).toContain("unknown gateway eval type");
  });
});

describe("gateway executor — 번들 통합", () => {
  it("gateway 번들이 등록됨", () => {
    const bundle = get_bundle("gateway");
    expect(bundle).toBeDefined();
    expect(bundle!.smoke).toBe(true);
  });

  it("gateway 번들 전체 fixture 통과 (exact match)", async () => {
    // clear + re-import로 번들 레지스트리 초기화 방지
    const bundle = get_bundle("gateway");
    expect(bundle).toBeDefined();

    const datasets = load_bundle_datasets(bundle!);
    expect(datasets).toHaveLength(1);

    const dataset = datasets[0];
    const runner = new EvalRunner(executor, EXACT_MATCH_SCORER);
    const summary = await runner.run_dataset(dataset);

    expect(summary.passed).toBe(dataset.cases.length);
    expect(summary.failed).toBe(0);
  });
});
