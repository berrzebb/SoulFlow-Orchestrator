/** Text Splitter (텍스트 청크 분할) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { TextSplitterNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

/** 텍스트를 지정된 크기/오버랩으로 분할. */
function split_text(text: string, chunk_size: number, overlap: number, separator?: string): string[] {
  if (separator) {
    const parts = text.split(separator);
    const chunks: string[] = [];
    let current = "";
    for (const part of parts) {
      if (current.length + part.length + 1 > chunk_size && current.length > 0) {
        chunks.push(current);
        // 오버랩: 마지막 overlap 글자를 다음 청크 시작에 포함
        const tail = current.slice(-overlap);
        current = tail + separator + part;
      } else {
        current = current ? current + separator + part : part;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  // 구분자 없으면 고정 크기 분할
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunk_size));
    start += chunk_size - overlap;
  }
  return chunks;
}

export const text_splitter_handler: NodeHandler = {
  node_type: "text_splitter",
  icon: "✂",
  color: "#ff5722",
  shape: "rect",
  output_schema: [
    { name: "chunks",      type: "array",  description: "Text chunks" },
    { name: "chunk_count", type: "number", description: "Number of chunks" },
  ],
  input_schema: [
    { name: "text",       type: "string", description: "Text to split" },
    { name: "chunk_size", type: "number", description: "Characters per chunk" },
    { name: "overlap",    type: "number", description: "Overlap between chunks" },
  ],
  create_default: () => ({ input_field: "text", chunk_size: 1000, chunk_overlap: 200, separator: "\n\n" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TextSplitterNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const field = resolve_templates(n.input_field, tpl_ctx);

    // memory에서 텍스트 조회
    const parts = field.split(".");
    let text: unknown = ctx.memory;
    for (const p of parts) {
      if (text && typeof text === "object") text = (text as Record<string, unknown>)[p];
      else { text = undefined; break; }
    }
    if (typeof text !== "string") {
      return { output: { chunks: [], chunk_count: 0 } };
    }

    const chunks = split_text(text, n.chunk_size, n.chunk_overlap, n.separator);
    return { output: { chunks, chunk_count: chunks.length } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as TextSplitterNodeDefinition;
    const warnings: string[] = [];
    if (!n.input_field) warnings.push("input_field is empty");
    if (n.chunk_size < 100) warnings.push("chunk_size < 100 may produce too many chunks");
    if (n.chunk_overlap >= n.chunk_size) warnings.push("chunk_overlap must be less than chunk_size");
    return {
      preview: {
        input_field: n.input_field,
        chunk_size: n.chunk_size,
        chunk_overlap: n.chunk_overlap,
        separator: n.separator || "(none)",
      },
      warnings,
    };
  },
};
