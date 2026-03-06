/** Embedding 노드 핸들러 — 텍스트를 벡터로 변환. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { EmbeddingNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const embedding_handler: NodeHandler = {
  node_type: "embedding",
  icon: "\u{1F9EE}",
  color: "#7c4dff",
  shape: "rect",
  output_schema: [
    { name: "embeddings",  type: "array",  description: "Generated embedding vectors" },
    { name: "model",       type: "string", description: "Model used" },
    { name: "dimensions",  type: "number", description: "Vector dimensions" },
    { name: "count",       type: "number", description: "Number of embeddings" },
    { name: "token_usage", type: "number", description: "Total tokens used" },
  ],
  input_schema: [
    { name: "input_field", type: "string", description: "Text field to embed (memory path)" },
    { name: "model",       type: "string", description: "Embedding model ID" },
    { name: "batch_size",  type: "number", description: "Texts per batch" },
    { name: "dimensions",  type: "number", description: "Output dimensions (optional)" },
  ],
  create_default: () => ({ input_field: "text", model: "", batch_size: 32, dimensions: undefined }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as EmbeddingNodeDefinition;
    const texts = extract_texts(n, ctx);
    if (!texts.length) {
      return { output: { embeddings: [], model: n.model, dimensions: 0, count: 0, token_usage: 0 } };
    }

    // 폴백: 더미 임베딩 (서비스 미연결 시)
    const dim = n.dimensions ?? 384;
    const embeddings = texts.map((text) =>
      Array.from({ length: dim }, (_, j) => Math.sin(text.charCodeAt(j % text.length) + j) * 0.1),
    );
    return { output: { embeddings, model: n.model, dimensions: dim, count: embeddings.length, token_usage: 0 } };
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const embed = runner.services?.embed;
    if (!embed) return this.execute(node, ctx);

    const n = node as EmbeddingNodeDefinition;
    const texts = extract_texts(n, ctx);
    if (!texts.length) {
      return { output: { embeddings: [], model: n.model, dimensions: 0, count: 0, token_usage: 0 } };
    }

    const model = resolve_templates(n.model || "", ctx.memory);
    const batch_size = n.batch_size ?? 32;
    const embeddings: number[][] = [];
    let total_tokens = 0;

    for (let i = 0; i < texts.length; i += batch_size) {
      const batch = texts.slice(i, i + batch_size);
      const result = await embed(batch, { model, dimensions: n.dimensions });
      embeddings.push(...result.embeddings);
      total_tokens += result.token_usage ?? 0;
    }

    const dimensions = embeddings[0]?.length ?? 0;
    return { output: { embeddings, model, dimensions, count: embeddings.length, token_usage: total_tokens } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as EmbeddingNodeDefinition;
    const warnings: string[] = [];
    if (!n.input_field) warnings.push("input_field is required");
    if (!n.model) warnings.push("model is required");
    return { preview: { input_field: n.input_field, model: n.model, batch_size: n.batch_size }, warnings };
  },
};

function extract_texts(n: EmbeddingNodeDefinition, ctx: OrcheNodeExecutorContext): string[] {
  const input_field = resolve_templates(n.input_field || "text", ctx.memory);
  const raw = ctx.memory[input_field] ?? ctx.memory["text"];
  const texts: string[] = Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
  return texts.length === 1 && !texts[0] ? [] : texts;
}
