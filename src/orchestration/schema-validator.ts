/**
 * SO-4: SchemaChain validator/normalizer.
 *
 * JSON Schema 검증 + JSON 텍스트 정규화를 출력 파이프라인용으로 제공.
 * 도구 클래스(JsonSchemaTool, ValidatorTool)의 private 메서드와 동일 로직이지만
 * 독립 함수로 추출하여 파이프라인 어디서든 사용 가능.
 */

// ── Types ───────────────────────────────────────────────────────

export type SchemaValidationError = {
  path: string;
  message: string;
};

// ── normalize_json_text ─────────────────────────────────────────

/** 코드 펜스 제거 + trim. LLM이 ```json ... ``` 으로 감싸는 경우 처리. */
export function normalize_json_text(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const fence = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fence) return fence[1].trim();
  return trimmed;
}

// ── validate_schema ─────────────────────────────────────────────

/** JSON Schema 검증. 빈 에러 배열 = 유효. */
export function validate_schema(
  data: unknown,
  schema: Record<string, unknown>,
  path = "$",
): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];
  const expected = schema.type as string | undefined;

  if (expected) {
    const actual = json_type(data);
    if (expected === "integer") {
      if (!Number.isInteger(data)) {
        errors.push({ path, message: `expected integer, got ${actual}` });
      }
    } else if (expected === "null") {
      if (data !== null) {
        errors.push({ path, message: `expected null, got ${actual}` });
        return errors;
      }
    } else if (actual !== expected) {
      errors.push({ path, message: `expected ${expected}, got ${actual}` });
      return errors;
    }
  }

  // object
  if (expected === "object" && typeof data === "object" && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const required = (schema.required ?? []) as string[];
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;

    for (const key of required) {
      if (!(key in obj)) errors.push({ path: `${path}.${key}`, message: "required field missing" });
    }
    for (const [key, prop_schema] of Object.entries(props)) {
      if (key in obj) errors.push(...validate_schema(obj[key], prop_schema, `${path}.${key}`));
    }
  }

  // array
  if (expected === "array" && Array.isArray(data)) {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      for (let i = 0; i < data.length; i++) {
        errors.push(...validate_schema(data[i], items, `${path}[${i}]`));
      }
    }
    if (schema.minItems && data.length < (schema.minItems as number)) {
      errors.push({ path, message: `array too short (min ${schema.minItems as number})` });
    }
    if (schema.maxItems && data.length > (schema.maxItems as number)) {
      errors.push({ path, message: `array too long (max ${schema.maxItems as number})` });
    }
  }

  // string constraints
  if (typeof data === "string") {
    if (schema.minLength && data.length < (schema.minLength as number)) {
      errors.push({ path, message: `string too short (min ${schema.minLength as number})` });
    }
    if (schema.maxLength && data.length > (schema.maxLength as number)) {
      errors.push({ path, message: `string too long (max ${schema.maxLength as number})` });
    }
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern as string).test(data)) {
          errors.push({ path, message: `pattern mismatch: ${schema.pattern as string}` });
        }
      } catch { /* invalid regex — skip */ }
    }
    if (schema.enum && !(schema.enum as unknown[]).includes(data)) {
      errors.push({ path, message: `value not in enum` });
    }
  }

  // number constraints
  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < (schema.minimum as number)) {
      errors.push({ path, message: `below minimum ${schema.minimum as number}` });
    }
    if (schema.maximum !== undefined && data > (schema.maximum as number)) {
      errors.push({ path, message: `above maximum ${schema.maximum as number}` });
    }
  }

  // enum on non-string (number, boolean, etc.)
  if (typeof data !== "string" && schema.enum && Array.isArray(schema.enum)) {
    if (!(schema.enum as unknown[]).includes(data)) {
      errors.push({ path, message: `value not in enum` });
    }
  }

  return errors;
}

// ── validate_json_output ────────────────────────────────────────

/**
 * JSON 텍스트 파싱 + 스키마 검증을 한 번에 수행.
 * 코드 펜스 자동 제거. JSON이 아니면 null 반환.
 */
export function validate_json_output(
  raw: string,
  schema: Record<string, unknown>,
): { parsed: unknown; errors: SchemaValidationError[] } | null {
  const normalized = normalize_json_text(raw);
  if (!normalized) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return null;
  }

  const errors = validate_schema(parsed, schema);
  return { parsed, errors };
}

// ── Helpers ─────────────────────────────────────────────────────

function json_type(val: unknown): string {
  if (val === null) return "null";
  if (Array.isArray(val)) return "array";
  return typeof val;
}
