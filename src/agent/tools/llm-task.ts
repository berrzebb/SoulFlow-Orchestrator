/** LLM Task 도구 — 파라미터화된 LLM 작업 (draft, summarize, classify, extract, rewrite). */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { error_message } from "../../utils/common.js";

/** LLM 호출 추상화. ProviderRegistry.run_headless 등에서 래핑. */
export type LlmTaskCallback = (request: LlmTaskRequest) => Promise<LlmTaskResult>;

export type LlmTaskRequest = {
  system: string;
  prompt: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  /** JSON 출력 강제 시 스키마. system prompt에 포함. */
  output_schema?: Record<string, unknown>;
};

export type LlmTaskResult = {
  content: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const MAX_INPUT_LENGTH = 100_000;
const OPERATIONS = ["draft", "summarize", "classify", "extract", "rewrite"] as const;
type Operation = typeof OPERATIONS[number];

export class LlmTaskTool extends Tool {
  readonly name = "llm_task";
  readonly category = "ai" as const;
  readonly description =
    "Run a parameterized LLM task: draft text, summarize, classify into labels, extract structured data, or rewrite in a target style.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: [...OPERATIONS],
        description: "Task type: draft, summarize, classify, extract, rewrite",
      },
      input: {
        type: "string",
        description: "Input text to process",
      },
      instruction: {
        type: "string",
        description: "Task-specific instruction (e.g., style for rewrite, topic for draft)",
      },
      labels: {
        type: "string",
        description: "Comma-separated classification labels (for classify)",
      },
      output_schema: {
        type: "string",
        description: "JSON Schema string for structured output (for extract)",
      },
      model: {
        type: "string",
        description: "Model override (optional)",
      },
      max_tokens: {
        type: "integer",
        minimum: 100,
        maximum: 16384,
        description: "Max output tokens (default 2048)",
      },
      temperature: {
        type: "number",
        minimum: 0,
        maximum: 2,
        description: "Sampling temperature (default varies by operation)",
      },
    },
    required: ["operation", "input"],
    additionalProperties: false,
  };

  private readonly llm: LlmTaskCallback;

  constructor(llm: LlmTaskCallback) {
    super();
    this.llm = llm;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const op = String(params.operation || "") as Operation;
    if (!OPERATIONS.includes(op)) return `Error: unsupported operation "${op}"`;

    const input = String(params.input || "").trim();
    if (!input) return "Error: input is required";
    if (input.length > MAX_INPUT_LENGTH) return `Error: input too large (${input.length} > ${MAX_INPUT_LENGTH})`;

    const instruction = String(params.instruction || "").trim();
    const model = params.model ? String(params.model) : undefined;
    const max_tokens = typeof params.max_tokens === "number" ? params.max_tokens : undefined;
    const temperature = typeof params.temperature === "number" ? params.temperature : undefined;

    try {
      switch (op) {
        case "draft": return await this.do_draft(input, instruction, { model, max_tokens, temperature });
        case "summarize": return await this.do_summarize(input, instruction, { model, max_tokens, temperature });
        case "classify": return await this.do_classify(input, String(params.labels || ""), instruction, { model, temperature });
        case "extract": return await this.do_extract(input, String(params.output_schema || ""), instruction, { model, max_tokens, temperature });
        case "rewrite": return await this.do_rewrite(input, instruction, { model, max_tokens, temperature });
        default: return `Error: unknown operation "${op}"`;
      }
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private async do_draft(
    topic: string,
    instruction: string,
    opts: { model?: string; max_tokens?: number; temperature?: number },
  ): Promise<string> {
    const system = [
      "You are a skilled writer. Draft content based on the given topic/context.",
      instruction ? `Style/instructions: ${instruction}` : "",
      "Output the drafted text directly, without meta-commentary.",
    ].filter(Boolean).join("\n");
    const result = await this.llm({
      system,
      prompt: topic,
      model: opts.model,
      max_tokens: opts.max_tokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
    });
    return result.content;
  }

  private async do_summarize(
    input: string,
    instruction: string,
    opts: { model?: string; max_tokens?: number; temperature?: number },
  ): Promise<string> {
    const system = [
      "Summarize the following text concisely.",
      instruction ? `Focus: ${instruction}` : "",
      "Output only the summary.",
    ].filter(Boolean).join("\n");
    const result = await this.llm({
      system,
      prompt: input,
      model: opts.model,
      max_tokens: opts.max_tokens ?? 1024,
      temperature: opts.temperature ?? 0.3,
    });
    return result.content;
  }

  private async do_classify(
    input: string,
    labels_raw: string,
    instruction: string,
    opts: { model?: string; temperature?: number },
  ): Promise<string> {
    const labels = labels_raw
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);
    if (labels.length < 2) return "Error: classify requires at least 2 comma-separated labels";

    const system = [
      "Classify the input text into exactly one of the provided labels.",
      `Labels: ${labels.join(", ")}`,
      instruction ? `Criteria: ${instruction}` : "",
      'Respond with JSON: {"label": "<chosen_label>", "confidence": <0.0-1.0>, "reason": "<brief reason>"}',
    ].filter(Boolean).join("\n");
    const result = await this.llm({
      system,
      prompt: input,
      model: opts.model,
      max_tokens: 256,
      temperature: opts.temperature ?? 0.1,
    });
    return this.validate_json_response(result.content, { required_keys: ["label"] });
  }

  private async do_extract(
    input: string,
    schema_raw: string,
    instruction: string,
    opts: { model?: string; max_tokens?: number; temperature?: number },
  ): Promise<string> {
    let output_schema: Record<string, unknown> | null = null;
    if (schema_raw.trim()) {
      try {
        output_schema = JSON.parse(schema_raw) as Record<string, unknown>;
      } catch {
        return "Error: output_schema must be valid JSON";
      }
    }
    const system = [
      "Extract structured data from the input text.",
      instruction ? `Instructions: ${instruction}` : "",
      output_schema
        ? `Output must conform to this JSON Schema:\n${JSON.stringify(output_schema, null, 2)}`
        : "Output valid JSON with the extracted data.",
    ].filter(Boolean).join("\n");
    const result = await this.llm({
      system,
      prompt: input,
      model: opts.model,
      max_tokens: opts.max_tokens ?? 2048,
      temperature: opts.temperature ?? 0.1,
      output_schema: output_schema ?? undefined,
    });
    return this.validate_json_response(result.content);
  }

  private async do_rewrite(
    input: string,
    instruction: string,
    opts: { model?: string; max_tokens?: number; temperature?: number },
  ): Promise<string> {
    if (!instruction) return "Error: rewrite requires instruction (target style/format)";
    const system = [
      "Rewrite the input text according to the instructions. Preserve the meaning.",
      `Instructions: ${instruction}`,
      "Output only the rewritten text.",
    ].join("\n");
    const result = await this.llm({
      system,
      prompt: input,
      model: opts.model,
      max_tokens: opts.max_tokens ?? 2048,
      temperature: opts.temperature ?? 0.5,
    });
    return result.content;
  }

  /** JSON 응답 검증. 파싱 실패 시 raw 텍스트에서 JSON 블록 추출 시도. */
  private validate_json_response(raw: string, opts?: { required_keys?: string[] }): string {
    const text = raw.trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // ```json ... ``` 블록 추출 시도
      const fence_match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence_match) {
        try {
          parsed = JSON.parse(fence_match[1].trim()) as Record<string, unknown>;
        } catch {
          return text;
        }
      } else {
        return text;
      }
    }
    if (opts?.required_keys) {
      for (const key of opts.required_keys) {
        if (!(key in parsed)) return `Error: missing required key "${key}" in response`;
      }
    }
    return JSON.stringify(parsed, null, 2);
  }
}
