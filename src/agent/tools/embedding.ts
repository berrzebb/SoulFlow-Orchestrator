/** Embedding 도구 — 텍스트 임베딩 생성 (OpenAI 호환 API). */

import { Tool } from "./base.js";
import { error_message, make_abort_signal } from "../../utils/common.js";
import { HTTP_FETCH_LONG_TIMEOUT_MS } from "../../utils/timeouts.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export class EmbeddingTool extends Tool {
  readonly name = "embedding";
  readonly category = "ai" as const;
  readonly policy_flags = { network: true } as const;
  readonly description = "Generate text embeddings via OpenAI-compatible API. Actions: embed, batch_embed, similarity.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["embed", "batch_embed", "similarity"], description: "Operation" },
      text: { type: "string", description: "Input text (embed) or JSON array of texts (batch_embed)" },
      text_a: { type: "string", description: "First text for similarity comparison" },
      text_b: { type: "string", description: "Second text for similarity comparison" },
      model: { type: "string", description: "Model name (default: text-embedding-3-small)" },
      dimensions: { type: "integer", description: "Output dimensions (optional)" },
      api_url: { type: "string", description: "API base URL (default: $OPENAI_API_BASE_URL or https://api.openai.com/v1)" },
      api_key: { type: "string", description: "API key (default: $OPENAI_API_KEY)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "embed");
    switch (action) {
      case "embed": return this.embed(params, context);
      case "batch_embed": return this.batch_embed(params, context);
      case "similarity": return this.similarity(params, context);
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private async embed(p: Record<string, unknown>, ctx?: ToolExecutionContext): Promise<string> {
    const text = String(p.text || "").trim();
    if (!text) return "Error: text is required";
    const result = await this.call_api([text], p, ctx);
    if (typeof result === "string") return result;
    return JSON.stringify({ model: result.model, dimensions: result.data[0]?.embedding?.length ?? 0, embedding: result.data[0]?.embedding });
  }

  private async batch_embed(p: Record<string, unknown>, ctx?: ToolExecutionContext): Promise<string> {
    let texts: string[];
    try { texts = JSON.parse(String(p.text || "[]")); } catch { return "Error: text must be a JSON array of strings"; }
    if (!Array.isArray(texts) || texts.length === 0) return "Error: text must be a non-empty array";
    if (texts.length > 100) return "Error: max 100 texts per batch";
    const result = await this.call_api(texts, p, ctx);
    if (typeof result === "string") return result;
    return JSON.stringify({
      model: result.model,
      count: result.data.length,
      dimensions: result.data[0]?.embedding?.length ?? 0,
      embeddings: result.data.map((d: { embedding: number[] }) => d.embedding),
    });
  }

  private async similarity(p: Record<string, unknown>, ctx?: ToolExecutionContext): Promise<string> {
    const a = String(p.text_a || "").trim();
    const b = String(p.text_b || "").trim();
    if (!a || !b) return "Error: text_a and text_b are required";
    const result = await this.call_api([a, b], p, ctx);
    if (typeof result === "string") return result;
    const emb_a = result.data[0]?.embedding as number[];
    const emb_b = result.data[1]?.embedding as number[];
    if (!emb_a || !emb_b) return "Error: failed to get embeddings";
    const cosine = this.cosine_similarity(emb_a, emb_b);
    return JSON.stringify({ similarity: cosine, model: result.model });
  }

  private async call_api(
    inputs: string[], p: Record<string, unknown>, ctx?: ToolExecutionContext,
  ): Promise<{ model: string; data: Array<{ embedding: number[] }> } | string> {
    const base_url = String(p.api_url || process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const api_key = String(p.api_key || process.env.OPENAI_API_KEY || "");
    if (!api_key) return "Error: api_key or OPENAI_API_KEY env required";
    const model = String(p.model || "text-embedding-3-small");

    const body: Record<string, unknown> = { model, input: inputs };
    if (p.dimensions) body.dimensions = Number(p.dimensions);

    try {
      const res = await fetch(`${base_url}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${api_key}` },
        body: JSON.stringify(body),
        signal: make_abort_signal(HTTP_FETCH_LONG_TIMEOUT_MS, ctx?.signal),
      });
      if (!res.ok) return `Error: API ${res.status} — ${(await res.text()).slice(0, 500)}`;
      return await res.json() as { model: string; data: Array<{ embedding: number[] }> };
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private cosine_similarity(a: number[], b: number[]): number {
    let dot = 0, mag_a = 0, mag_b = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      mag_a += a[i]! * a[i]!;
      mag_b += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(mag_a) * Math.sqrt(mag_b);
    return denom === 0 ? 0 : dot / denom;
  }
}
