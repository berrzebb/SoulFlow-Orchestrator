import type { JsonSchema, ToolExecutionContext, ToolLike, ToolSchema } from "./types.js";

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

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    return this.run(params, context);
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
