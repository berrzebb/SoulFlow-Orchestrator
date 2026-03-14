/**
 * SO-5: Bounded SchemaRepairLoop.
 *
 * LLM 출력이 스키마에 맞지 않으면 에러 피드백과 함께 재시도.
 * max_attempts로 바운딩하여 무한 루프 방지.
 */

import { validate_json_output, type SchemaValidationError } from "./schema-validator.js";

// ── Constants ───────────────────────────────────────────────────

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;

// ── Types ───────────────────────────────────────────────────────

export interface SchemaRepairResult {
  content: string;
  parsed: unknown;
  errors: SchemaValidationError[];
  /** 실제 수행된 retry 횟수. 0 = 첫 시도에서 성공 또는 retry 없음. */
  attempts: number;
}

// ── format_repair_prompt ────────────────────────────────────────

/** 스키마 검증 에러를 LLM 재시도 프롬프트로 포맷. */
export function format_repair_prompt(
  errors: SchemaValidationError[],
  schema: Record<string, unknown>,
): string {
  const error_lines = errors.map((e) => `- ${e.path}: ${e.message}`).join("\n");
  return [
    "Your previous JSON output had schema validation errors:",
    error_lines,
    "",
    "Please fix and respond with valid JSON matching this schema:",
    JSON.stringify(schema),
  ].join("\n");
}

// ── run_schema_repair ───────────────────────────────────────────

/**
 * 바운딩된 스키마 수리 루프.
 *
 * @param retry — (last_content, repair_prompt) → LLM 재호출하여 새 content 반환
 * @param schema — 검증 대상 JSON Schema
 * @param initial_content — 첫 LLM 응답 (이미 획득된 상태)
 * @param max_attempts — 최대 수리 시도 횟수 (기본 2)
 */
export async function run_schema_repair(
  retry: (last_content: string, repair_prompt: string) => Promise<string>,
  schema: Record<string, unknown>,
  initial_content: string,
  max_attempts?: number,
): Promise<SchemaRepairResult> {
  const limit = max_attempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;

  // 초기 검증
  const initial = validate_json_output(initial_content, schema);

  if (!initial) {
    // JSON 파싱 자체 실패
    if (limit <= 0) {
      return { content: initial_content, parsed: undefined, errors: [{ path: "$", message: "invalid JSON" }], attempts: 0 };
    }
    // repair 시도
    return repair_loop(retry, schema, initial_content, [{ path: "$", message: "invalid JSON" }], limit);
  }

  if (initial.errors.length === 0) {
    return { content: initial_content, parsed: initial.parsed, errors: [], attempts: 0 };
  }

  if (limit <= 0) {
    return { content: initial_content, parsed: initial.parsed, errors: initial.errors, attempts: 0 };
  }

  return repair_loop(retry, schema, initial_content, initial.errors, limit);
}

// ── Internal ────────────────────────────────────────────────────

async function repair_loop(
  retry: (last_content: string, repair_prompt: string) => Promise<string>,
  schema: Record<string, unknown>,
  last_content: string,
  last_errors: SchemaValidationError[],
  limit: number,
): Promise<SchemaRepairResult> {
  let best_content = last_content;
  let best_parsed: unknown = undefined;
  let best_errors = last_errors;

  for (let i = 0; i < limit; i++) {
    const prompt = format_repair_prompt(best_errors, schema);
    const new_content = await retry(best_content, prompt);
    const validation = validate_json_output(new_content, schema);

    if (!validation) {
      // 여전히 JSON 아님 — 다음 시도로
      best_errors = [{ path: "$", message: "invalid JSON" }];
      best_content = new_content;
      best_parsed = undefined;
      continue;
    }

    best_content = new_content;
    best_parsed = validation.parsed;
    best_errors = validation.errors;

    if (validation.errors.length === 0) {
      return { content: best_content, parsed: best_parsed, errors: [], attempts: i + 1 };
    }
  }

  return { content: best_content, parsed: best_parsed, errors: best_errors, attempts: limit };
}
