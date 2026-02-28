/**
 * Tool Chain — 도구 파이프라인 실행기.
 * LLM 왕복 없이 순차적으로 도구를 실행하고, 이전 출력을 다음 입력에 주입.
 *
 * 템플릿 변수:
 *   $prev           — 직전 단계의 출력 전체
 *   $prev.json.key  — 직전 출력을 JSON 파싱 후 key 접근
 *   $steps[N]       — N번째 단계의 출력 전체
 */

import type { ToolLike, ToolSchema, JsonSchema, ToolExecutionContext } from "./types.js";
import type { ToolRegistry } from "./registry.js";

export type ChainStep = {
  tool: string;
  params: Record<string, unknown>;
  /** 실패 시 체인 중단 여부 (기본 true) */
  abort_on_error?: boolean;
};

export type ChainResult = {
  ok: boolean;
  steps: Array<{
    tool: string;
    output: string;
    error: boolean;
  }>;
  final_output: string;
};

/** 도구 체인을 실행한다. */
export async function execute_chain(
  registry: ToolRegistry,
  steps: ChainStep[],
  context?: ToolExecutionContext,
): Promise<ChainResult> {
  const step_outputs: string[] = [];
  const results: ChainResult["steps"] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const resolved_params = resolve_params(step.params, step_outputs);
    const output = await registry.execute(step.tool, resolved_params, context);
    const is_error = output.startsWith("Error:");

    step_outputs.push(output);
    results.push({ tool: step.tool, output, error: is_error });

    if (is_error && (step.abort_on_error !== false)) {
      return { ok: false, steps: results, final_output: output };
    }
  }

  const final = step_outputs.length > 0 ? step_outputs[step_outputs.length - 1] : "";
  return { ok: true, steps: results, final_output: final };
}

/** 파라미터 값에서 $prev, $steps[N] 템플릿을 치환한다. */
function resolve_params(
  params: Record<string, unknown>,
  step_outputs: string[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = resolve_value(value, step_outputs);
  }
  return resolved;
}

function resolve_value(value: unknown, step_outputs: string[]): unknown {
  if (typeof value === "string") return resolve_template(value, step_outputs);
  if (Array.isArray(value)) return value.map((v) => resolve_value(v, step_outputs));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolve_value(v, step_outputs);
    }
    return out;
  }
  return value;
}

const PREV_RE = /\$prev(?:\.json\.([A-Za-z0-9_.]+))?/g;
const STEP_RE = /\$steps\[(\d+)\](?:\.json\.([A-Za-z0-9_.]+))?/g;

function resolve_template(template: string, step_outputs: string[]): string {
  const prev = step_outputs.length > 0 ? step_outputs[step_outputs.length - 1] : "";

  let result = template.replace(PREV_RE, (_match, json_path: string | undefined) => {
    if (!json_path) return prev;
    return extract_json_path(prev, json_path);
  });

  result = result.replace(STEP_RE, (_match, idx_str: string, json_path: string | undefined) => {
    const idx = Number(idx_str);
    const output = idx >= 0 && idx < step_outputs.length ? step_outputs[idx] : "";
    if (!json_path) return output;
    return extract_json_path(output, json_path);
  });

  return result;
}

function extract_json_path(raw: string, path: string): string {
  try {
    let obj: unknown = JSON.parse(raw);
    for (const key of path.split(".")) {
      if (obj === null || obj === undefined || typeof obj !== "object") return "";
      obj = (obj as Record<string, unknown>)[key];
    }
    if (obj === null || obj === undefined) return "";
    return typeof obj === "string" ? obj : JSON.stringify(obj);
  } catch {
    return "";
  }
}

/** 에이전트가 사용할 chain 메타 도구. */
export class ChainTool implements ToolLike {
  readonly name = "chain";
  readonly description = "Execute a pipeline of tools sequentially. Each step can reference previous outputs via $prev or $steps[N] templates.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      steps: {
        type: "array",
        description: "Tool pipeline steps. Each step has: tool (name), params (arguments), abort_on_error (optional, default true).",
        items: {
          type: "object",
          properties: {
            tool: { type: "string", description: "Tool name to execute" },
            params: { type: "object", description: "Tool parameters. Use $prev for previous output, $steps[N] for N-th step output, $prev.json.key for JSON path access." },
            abort_on_error: { type: "boolean", description: "Stop chain on error (default true)" },
          },
          required: ["tool", "params"],
        },
      },
    },
    required: ["steps"],
  };

  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const raw_steps = params.steps;
    if (!Array.isArray(raw_steps) || raw_steps.length === 0) {
      return "Error: chain requires at least one step";
    }

    if (raw_steps.length > 20) {
      return "Error: chain supports maximum 20 steps";
    }

    const steps: ChainStep[] = raw_steps.map((s) => {
      const step = s as Record<string, unknown>;
      return {
        tool: String(step.tool || ""),
        params: (step.params && typeof step.params === "object" ? step.params : {}) as Record<string, unknown>,
        abort_on_error: step.abort_on_error !== false,
      };
    });

    for (const step of steps) {
      if (step.tool === "chain") {
        return "Error: recursive chain calls are not allowed";
      }
    }

    const result = await execute_chain(this.registry, steps, context);

    const lines: string[] = [];
    for (let i = 0; i < result.steps.length; i++) {
      const s = result.steps[i];
      const status = s.error ? "ERROR" : "OK";
      lines.push(`--- step ${i}: ${s.tool} [${status}] ---`);
      lines.push(s.output.slice(0, 2000));
    }
    if (!result.ok) {
      lines.push(`\nChain aborted at step ${result.steps.length - 1}.`);
    }
    return lines.join("\n");
  }

  validate_params(params: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!Array.isArray(params.steps)) {
      errors.push("'steps' must be an array");
    }
    return errors;
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
}
