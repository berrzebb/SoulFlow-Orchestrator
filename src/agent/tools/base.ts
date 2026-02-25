import type { JsonSchema, ToolExecutionContext, ToolLike, ToolSchema } from "./types.js";
import { SecretVaultService } from "../../security/secret-vault.js";

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
  protected abstract run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
  private readonly _param_secret_vault = new SecretVaultService(process.cwd());

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
    return this.run(normalized, context);
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
      const report = await this._param_secret_vault.resolve_inline_secrets_with_report(value);
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
