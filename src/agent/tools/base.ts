import type { JsonSchema, ToolCategory, ToolExecutionContext, ToolLike, ToolPolicyFlags, ToolSchema } from "./types.js";
import type { SecretResolveReport } from "../../security/secret-vault.js";

/** Tool 파라미터 시크릿 해석에 필요한 최소 계약. */
export interface ParamSecretResolver {
  resolve_inline_secrets_with_report(text: string): Promise<SecretResolveReport>;
}

const TRUTHY = new Set(["true", "yes", "on", "1", "ok", "y", "예", "네"]);
const FALSY = new Set(["false", "no", "off", "0", "n", "아니오", "아니"]);

function coerce_boolean(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") {
    const norm = val.trim().toLowerCase();
    if (TRUTHY.has(norm)) return true;
    if (FALSY.has(norm)) return false;
  }
  return Boolean(val);
}

const TYPE_MAP: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v),
};

export abstract class Tool implements ToolLike {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JsonSchema;
  abstract readonly category: ToolCategory;
  readonly policy_flags?: ToolPolicyFlags;
  protected abstract run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
  private _secret_resolver: ParamSecretResolver | null = null;

  /** 파라미터 시크릿 해석에 사용할 vault를 주입. */
  set_secret_resolver(resolver: ParamSecretResolver): void {
    this._secret_resolver = resolver;
  }

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const state = {
      missing_keys: new Set<string>(),
      invalid_ciphertexts: new Set<string>(),
    };
    const resolved = await this.resolve_param_secrets(params, state);
    if (state.missing_keys.size > 0 || state.invalid_ciphertexts.size > 0) {
      return this.format_secret_resolution_error(state);
    }
    const normalized = (resolved && typeof resolved === "object" && !Array.isArray(resolved))
      ? (resolved as Record<string, unknown>)
      : params;
    return this.run(this.coerce_params(normalized), context);
  }

  validate_params(params: Record<string, unknown>): string[] {
    const schema = this.parameters || { type: "object" };
    if ((schema.type || "object") !== "object") return ["parameters schema must be object"];
    return this.validate_value(params, { ...schema, type: "object" }, "");
  }

  to_schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }

  private async resolve_param_secrets(
    value: unknown,
    state: { missing_keys: Set<string>; invalid_ciphertexts: Set<string> },
  ): Promise<unknown> {
    if (typeof value === "string") {
      if (!this._secret_resolver) return value;
      const report = await this._secret_resolver.resolve_inline_secrets_with_report(value);
      for (const key of report.missing_keys || []) state.missing_keys.add(String(key || "").trim());
      for (const token of report.invalid_ciphertexts || []) state.invalid_ciphertexts.add(String(token || "").trim());
      return report.text;
    }
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const row of value) out.push(await this.resolve_param_secrets(row, state));
      return out;
    }
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, row] of Object.entries(record)) {
      out[key] = await this.resolve_param_secrets(row, state);
    }
    return out;
  }

  private format_secret_resolution_error(state: { missing_keys: Set<string>; invalid_ciphertexts: Set<string> }): string {
    const missing = [...state.missing_keys.values()].filter(Boolean);
    const invalid = [...state.invalid_ciphertexts.values()].filter(Boolean);
    const lines = [
      "Error: secret_resolution_required",
      "template: secret_resolution_required",
      "notice: 민감정보 키를 확인할 수 없어 복호화를 수행하지 않았습니다.",
      missing.length > 0 ? `missing_keys: ${missing.join(", ")}` : "",
      invalid.length > 0 ? `invalid_ciphertexts: ${invalid.join(", ")}` : "",
      "action_1: /secret list 로 키 이름을 확인하세요.",
      "action_2: /secret set <name> <value> 로 키를 재등록하세요.",
      "action_3: 요청에는 {{secret:<name>}} 형태만 사용하세요.",
    ].filter(Boolean);
    return lines.join("\n");
  }

  /** LLM이 잘못 전달한 파라미터 타입을 스키마 기반으로 보정. */
  private coerce_params(params: Record<string, unknown>): Record<string, unknown> {
    const props = this.parameters?.properties;
    if (!props || typeof props !== "object") return params;
    const out = { ...params };
    for (const [key, schema] of Object.entries(props)) {
      if (!(key in out)) continue;
      const val = out[key];
      const expected = (schema as JsonSchema).type;
      if (expected === "boolean" && typeof val !== "boolean") {
        out[key] = coerce_boolean(val);
      } else if (expected === "integer" && typeof val === "string") {
        const n = Number(val);
        if (Number.isFinite(n)) out[key] = Math.round(n);
      } else if (expected === "number" && typeof val === "string") {
        const n = Number(val);
        if (Number.isFinite(n)) out[key] = n;
      }
    }
    return out;
  }

  private validate_value(value: unknown, schema: JsonSchema, path: string): string[] {
    const label = path || "parameter";
    const expected = schema.type;
    const errors: string[] = [];

    if (expected && TYPE_MAP[expected] && !TYPE_MAP[expected](value)) {
      return [`${label} should be ${expected}`];
    }

    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${label} must be one of [${schema.enum.map(String).join(", ")}]`);
    }

    if ((expected === "integer" || expected === "number") && typeof value === "number") {
      if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${label} must be >= ${schema.minimum}`);
      if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${label} must be <= ${schema.maximum}`);
    }

    if (expected === "string" && typeof value === "string") {
      if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${label} too short`);
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${label} too long`);
    }

    if (expected === "object" && value && typeof value === "object" && !Array.isArray(value)) {
      const object = value as Record<string, unknown>;
      const props = schema.properties || {};
      for (const req of schema.required || []) {
        if (!(req in object)) errors.push(`missing required ${path ? `${path}.${req}` : req}`);
      }
      for (const [k, v] of Object.entries(object)) {
        if (!props[k]) continue;
        errors.push(...this.validate_value(v, props[k], path ? `${path}.${k}` : k));
      }
    }

    if (expected === "array" && Array.isArray(value) && schema.items) {
      value.forEach((item, idx) => {
        errors.push(...this.validate_value(item, schema.items as JsonSchema, `${label}[${idx}]`));
      });
    }

    return errors;
  }
}
