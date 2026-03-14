/**
 * SO-7: parser-repair regression artifact.
 *
 * OutputParserRegistry(SO-3) + SchemaValidator(SO-4) + SchemaRepairLoop(SO-5)의
 * 통합 파이프라인이 end-to-end로 올바르게 동작함을 검증하는 regression suite.
 * output-contracts.ts 단일 진입점을 통해 접근하는 SO-6 binding도 포함.
 */

import { describe, it, expect, vi } from "vitest";
import {
  parse_output,
  register_output_parser,
  get_output_parser,
} from "../../src/orchestration/output-parser-registry.js";
import {
  normalize_json_text,
  validate_schema,
  validate_json_output,
} from "../../src/orchestration/schema-validator.js";
import {
  run_schema_repair,
  DEFAULT_MAX_REPAIR_ATTEMPTS,
} from "../../src/orchestration/schema-repair-loop.js";
// SO-6: output-contracts.ts 단일 진입점을 통한 re-export 접근 검증
import {
  normalize_json_text as oc_normalize,
  validate_json_output as oc_validate,
  run_schema_repair as oc_repair,
  DEFAULT_MAX_REPAIR_ATTEMPTS as OC_MAX,
} from "../../src/orchestration/output-contracts.js";

// ── SO-6 binding: output-contracts re-export 동일성 ──────────────

describe("SO-6 — output-contracts re-export binding", () => {
  it("normalize_json_text는 output-contracts에서도 동일 함수", () => {
    expect(oc_normalize).toBe(normalize_json_text);
  });

  it("validate_json_output는 output-contracts에서도 동일 함수", () => {
    expect(oc_validate).toBe(validate_json_output);
  });

  it("run_schema_repair는 output-contracts에서도 동일 함수", () => {
    expect(oc_repair).toBe(run_schema_repair);
  });

  it("DEFAULT_MAX_REPAIR_ATTEMPTS는 output-contracts에서도 동일 값", () => {
    expect(OC_MAX).toBe(DEFAULT_MAX_REPAIR_ATTEMPTS);
    expect(OC_MAX).toBe(2);
  });
});

// ── Stage 1: normalize_json_text → parse_output 파이프라인 ────────

describe("SO-7 regression — Stage 1: normalize → parse pipeline", () => {
  it("순수 JSON → parse_output json → 파싱 성공", () => {
    const raw = '{"score": 0.9, "label": "positive"}';
    const result = parse_output("json", raw);
    expect(result).toEqual({ score: 0.9, label: "positive" });
  });

  it("코드 펜스 JSON → normalize → parse_output json → 파싱 성공", () => {
    const fenced = "```json\n{\"score\": 0.9, \"label\": \"positive\"}\n```";
    const normalized = normalize_json_text(fenced);
    const result = parse_output("json", normalized);
    expect(result).toEqual({ score: 0.9, label: "positive" });
  });

  it("비JSON → parse_output json → null", () => {
    expect(parse_output("json", "This is not JSON")).toBeNull();
  });

  it("빈 문자열 → normalize → 빈 문자열 반환", () => {
    expect(normalize_json_text("")).toBe("");
  });
});

// ── Stage 2: validate_json_output 통합 ───────────────────────────

describe("SO-7 regression — Stage 2: validate_json_output", () => {
  const SCHEMA = {
    type: "object",
    properties: {
      name: { type: "string" },
      score: { type: "number" },
    },
    required: ["name", "score"],
  };

  it("유효 JSON + 유효 schema → errors 없음", () => {
    const r = validate_json_output('{"name": "Alice", "score": 0.95}', SCHEMA);
    expect(r).not.toBeNull();
    expect(r!.errors).toHaveLength(0);
    expect(r!.parsed).toEqual({ name: "Alice", score: 0.95 });
  });

  it("유효 JSON + required 필드 누락 → errors 있음", () => {
    const r = validate_json_output('{"name": "Alice"}', SCHEMA);
    expect(r).not.toBeNull();
    expect(r!.errors.length).toBeGreaterThan(0);
    expect(r!.errors[0].path).toBe("$.score");
  });

  it("코드 펜스 JSON → 자동 fence 제거 후 검증", () => {
    const fenced = "```json\n{\"name\": \"Bob\", \"score\": 1.0}\n```";
    const r = validate_json_output(fenced, SCHEMA);
    expect(r).not.toBeNull();
    expect(r!.errors).toHaveLength(0);
  });

  it("비JSON → null 반환", () => {
    expect(validate_json_output("not json", SCHEMA)).toBeNull();
  });
});

// ── Stage 3: parse_output → validate_schema 체이닝 ──────────────

describe("SO-7 regression — Stage 3: parse → validate chain", () => {
  const SCHEMA = {
    type: "object",
    properties: { category: { type: "string" }, confidence: { type: "number" } },
    required: ["category", "confidence"],
  };

  it("parse_output → validate_schema 순서로 유효 응답 처리", () => {
    const raw = '{"category": "tech", "confidence": 0.87}';
    const parsed = parse_output("json", raw);
    const errors = validate_schema(parsed, SCHEMA);
    expect(errors).toHaveLength(0);
  });

  it("parse_output → validate_schema 순서로 타입 오류 감지", () => {
    const raw = '{"category": "tech", "confidence": "high"}'; // confidence가 string
    const parsed = parse_output("json", raw);
    const errors = validate_schema(parsed, SCHEMA);
    expect(errors.some((e) => e.path === "$.confidence")).toBe(true);
  });
});

// ── Stage 4: run_schema_repair end-to-end ────────────────────────

describe("SO-7 regression — Stage 4: run_schema_repair end-to-end", () => {
  const SCHEMA = {
    type: "object",
    properties: { title: { type: "string" }, count: { type: "number" } },
    required: ["title", "count"],
  };

  it("첫 응답이 유효 → repair 없이 attempts=0 반환", async () => {
    const retry = vi.fn();
    const r = await run_schema_repair(retry, SCHEMA, '{"title": "Test", "count": 5}');
    expect(r.errors).toHaveLength(0);
    expect(r.attempts).toBe(0);
    expect(r.parsed).toEqual({ title: "Test", count: 5 });
    expect(retry).not.toHaveBeenCalled();
  });

  it("첫 응답 invalid → retry 1회로 수정 성공 → attempts=1", async () => {
    const retry = vi.fn().mockResolvedValueOnce('{"title": "Fixed", "count": 3}');
    const r = await run_schema_repair(retry, SCHEMA, '{"title": "Broken"}'); // count 누락
    expect(r.errors).toHaveLength(0);
    expect(r.attempts).toBe(1);
    expect(r.parsed).toEqual({ title: "Fixed", count: 3 });
  });

  it("모든 retry 소진 → DEFAULT_MAX_REPAIR_ATTEMPTS 이후 중단", async () => {
    const retry = vi.fn().mockResolvedValue('{"still": "broken"}');
    const r = await run_schema_repair(retry, SCHEMA, '{"still": "broken"}');
    expect(r.attempts).toBe(DEFAULT_MAX_REPAIR_ATTEMPTS);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(retry).toHaveBeenCalledTimes(DEFAULT_MAX_REPAIR_ATTEMPTS);
  });

  it("코드 펜스 응답도 초기 검증에서 normalize → 성공 처리", async () => {
    const retry = vi.fn();
    const fenced = "```json\n{\"title\": \"OK\", \"count\": 10}\n```";
    const r = await run_schema_repair(retry, SCHEMA, fenced);
    expect(r.errors).toHaveLength(0);
    expect(r.attempts).toBe(0);
    expect(retry).not.toHaveBeenCalled();
  });
});

// ── Stage 5: custom parser + schema validation 통합 ──────────────

describe("SO-7 regression — Stage 5: custom parser + schema", () => {
  it("custom parser 등록 → parse_output으로 호출 → validate_schema로 검증", () => {
    register_output_parser({
      format: "regression_test_csv",
      parse(raw: string) {
        const parts = raw.split(",").map((s) => s.trim());
        if (parts.length < 2) return null;
        return { first: parts[0], second: parts[1] };
      },
    });

    const parsed = parse_output("regression_test_csv", "Alice, 42");
    const schema = {
      type: "object",
      properties: { first: { type: "string" }, second: { type: "string" } },
    };
    const errors = validate_schema(parsed, schema);
    expect(errors).toHaveLength(0);
    expect(parsed).toEqual({ first: "Alice", second: "42" });
  });

  it("custom parser → null 반환 시 validate_json_output와 동일 처리", () => {
    const parsed = get_output_parser("regression_test_csv")?.parse("x");
    expect(parsed).toBeNull();
  });
});
