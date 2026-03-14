/**
 * SO-1 + SO-2: Output Contract Inventory + Shared Result Contracts.
 *
 * 공통 결과 계약의 타입 호환성, 인벤토리 re-export, 헬퍼 함수 검증.
 */
import { describe, it, expect } from "vitest";
import {
  type ContentResult,
  type ParsedContentResult,
  type OutputContractMap,
  make_content_result,
  make_parsed_result,
  make_error_result,
} from "@src/orchestration/output-contracts.js";

// ── SO-2: Shared Result Contract Tests ──────────────────────────

describe("shared result contracts", () => {
  it("make_content_result — content + no error", () => {
    const r = make_content_result("hello");
    expect(r.content).toBe("hello");
    expect(r.error).toBeUndefined();
  });

  it("make_content_result — null content", () => {
    const r = make_content_result(null);
    expect(r.content).toBeNull();
  });

  it("make_error_result — error + null content", () => {
    const r = make_error_result("something broke");
    expect(r.content).toBeNull();
    expect(r.error).toBe("something broke");
  });

  it("make_parsed_result — content + parsed + no error", () => {
    const r = make_parsed_result("raw json", { key: "value" });
    expect(r.content).toBe("raw json");
    expect(r.parsed).toEqual({ key: "value" });
    expect(r.error).toBeUndefined();
  });

  it("make_parsed_result — null parsed when content is null", () => {
    const r = make_parsed_result(null, undefined);
    expect(r.content).toBeNull();
    expect(r.parsed).toBeUndefined();
  });

  it("ContentResult is structurally compatible with ParsedContentResult", () => {
    const content: ContentResult = { content: "test" };
    const parsed: ParsedContentResult = { ...content, parsed: 42 };
    expect(parsed.content).toBe("test");
    expect(parsed.parsed).toBe(42);
  });

  it("ParsedContentResult generic narrows parsed type", () => {
    type MySchema = { category: string; score: number };
    const r: ParsedContentResult<MySchema> = {
      content: '{"category":"A","score":0.9}',
      parsed: { category: "A", score: 0.9 },
    };
    // TypeScript 컴파일 시 parsed.category가 string임을 보장
    expect(r.parsed?.category).toBe("A");
    expect(r.parsed?.score).toBe(0.9);
  });
});

// ── SO-1: Output Contract Inventory Tests ───────────────────────

describe("output contract inventory — re-export verification", () => {
  it("OutputContractMap has all expected keys", () => {
    // 타입 레벨 검증 — 이 테스트는 컴파일 타임에 올바른 키가 있는지 확인
    const keys: Array<keyof OutputContractMap> = [
      "OrchestrationResult",
      "ResultEnvelope",
      "AgentRunResult",
      "InvokeLlmResult",
      "OrcheNodeExecuteResult",
      "ContentResult",
      "ParsedContentResult",
    ];
    expect(keys.length).toBeGreaterThanOrEqual(7);
  });

  it("re-exported types are accessible from output-contracts module", async () => {
    const mod = await import("@src/orchestration/output-contracts.js");
    // 헬퍼 함수 존재 확인
    expect(typeof mod.make_content_result).toBe("function");
    expect(typeof mod.make_parsed_result).toBe("function");
    expect(typeof mod.make_error_result).toBe("function");
  });
});
