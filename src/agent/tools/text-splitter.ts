/** Text Splitter 도구 — 텍스트를 청크로 분할 (RAG 파이프라인용). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class TextSplitterTool extends Tool {
  readonly name = "text_splitter";
  readonly category = "data" as const;
  readonly description = "Split text into chunks for RAG pipelines. Actions: fixed, separator, sentence, paragraph, regex.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["fixed", "separator", "sentence", "paragraph", "regex"], description: "Split strategy" },
      text: { type: "string", description: "Text to split" },
      chunk_size: { type: "integer", description: "Max characters per chunk (default: 1000)" },
      chunk_overlap: { type: "integer", description: "Overlap between chunks (default: 200)" },
      separator: { type: "string", description: "Custom separator (for separator/regex action)" },
    },
    required: ["action", "text"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "fixed");
    const text = String(params.text || "");
    const chunk_size = Math.max(50, Number(params.chunk_size) || 1000);
    const overlap = Math.min(Math.max(0, Number(params.chunk_overlap) || 200), chunk_size - 1);

    let chunks: string[];
    switch (action) {
      case "separator": {
        const sep = String(params.separator || "\n\n");
        chunks = this.split_by_separator(text, sep, chunk_size, overlap);
        break;
      }
      case "sentence":
        chunks = this.split_by_separator(text, /(?<=[.!?])\s+/g.source, chunk_size, overlap);
        break;
      case "paragraph":
        chunks = this.split_by_separator(text, "\n\n", chunk_size, overlap);
        break;
      case "regex": {
        const pattern = String(params.separator || "\\n\\n");
        chunks = this.split_by_regex(text, pattern, chunk_size, overlap);
        break;
      }
      case "fixed":
      default:
        chunks = this.split_fixed(text, chunk_size, overlap);
        break;
    }

    return JSON.stringify({ chunks, chunk_count: chunks.length, total_chars: text.length });
  }

  private split_fixed(text: string, size: number, overlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + size));
      start += size - overlap;
    }
    return chunks;
  }

  private split_by_separator(text: string, sep: string, size: number, overlap: number): string[] {
    const parts = text.split(sep);
    return this.merge_parts(parts, sep, size, overlap);
  }

  private split_by_regex(text: string, pattern: string, size: number, overlap: number): string[] {
    try {
      const re = new RegExp(pattern, "g");
      const parts = text.split(re);
      return this.merge_parts(parts, "", size, overlap);
    } catch {
      return this.split_fixed(text, size, overlap);
    }
  }

  private merge_parts(parts: string[], sep: string, size: number, overlap: number): string[] {
    const chunks: string[] = [];
    let current = "";
    for (const part of parts) {
      const candidate = current ? current + sep + part : part;
      if (candidate.length > size && current.length > 0) {
        chunks.push(current);
        const tail = current.slice(-overlap);
        current = tail ? tail + sep + part : part;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }
}
