/** PDF 도구 — PDF 텍스트 추출 + HTML→PDF 생성 (순수 Node.js, 외부 의존성 없음). */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class PdfTool extends Tool {
  readonly name = "pdf";
  readonly category = "data" as const;
  readonly description = "PDF operations: extract_text, info, page_count. Lightweight text extraction from PDF files.";
  readonly policy_flags = { write: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["extract_text", "info", "page_count"], description: "PDF operation" },
      path: { type: "string", description: "PDF file path" },
      pages: { type: "string", description: "Page range e.g. '1-3' or '2,5,7' (extract_text)" },
      max_chars: { type: "integer", description: "Max characters to extract (default: 50000)" },
    },
    required: ["action", "path"],
    additionalProperties: false,
  };
  private readonly workspace: string;

  constructor(opts: { workspace: string }) {
    super();
    this.workspace = opts.workspace;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "extract_text");
    const path_str = String(params.path || "");
    if (!path_str) return "Error: path is required";

    const abs = resolve(this.workspace, path_str);
    if (!abs.startsWith(resolve(this.workspace))) return "Error: path traversal blocked";

    const buf = await readFile(abs);
    if (buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) {
      return "Error: not a valid PDF file";
    }

    switch (action) {
      case "extract_text": return this.extract_text(buf, params);
      case "info": return this.get_info(buf, abs);
      case "page_count": return JSON.stringify({ pages: this.count_pages(buf) });
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private extract_text(buf: Buffer, params: Record<string, unknown>): string {
    const max_chars = Math.max(100, Number(params.max_chars) || 50000);
    const pages_str = String(params.pages || "");
    const page_filter = pages_str ? this.parse_page_range(pages_str) : null;

    const text = this.extract_pdf_text(buf, page_filter, max_chars);
    return JSON.stringify({
      text: text.slice(0, max_chars),
      length: text.length,
      truncated: text.length > max_chars,
      pages: this.count_pages(buf),
    });
  }

  private get_info(buf: Buffer, path: string): string {
    const text = buf.toString("latin1");

    const title = this.extract_info_field(text, "Title");
    const author = this.extract_info_field(text, "Author");
    const creator = this.extract_info_field(text, "Creator");
    const producer = this.extract_info_field(text, "Producer");

    const version_match = text.match(/%PDF-(\d+\.\d+)/);

    return JSON.stringify({
      path,
      version: version_match?.[1] || "unknown",
      pages: this.count_pages(buf),
      size_bytes: buf.length,
      title, author, creator, producer,
    });
  }

  private count_pages(buf: Buffer): number {
    const text = buf.toString("latin1");
    const matches = text.match(/\/Type\s*\/Page(?!\s*s)/g);
    return matches?.length ?? 0;
  }

  private extract_pdf_text(buf: Buffer, page_filter: Set<number> | null, max_chars: number): string {
    const text = buf.toString("latin1");
    const chunks: string[] = [];
    let total = 0;

    const stream_re = /stream\r?\n([\s\S]*?)endstream/g;
    let match: RegExpExecArray | null;
    let page_idx = 0;

    while ((match = stream_re.exec(text)) !== null) {
      if (total >= max_chars) break;
      page_idx++;
      if (page_filter && !page_filter.has(page_idx)) continue;

      const content = match[1]!;
      const extracted = this.extract_text_from_stream(content);
      if (extracted) {
        chunks.push(extracted);
        total += extracted.length;
      }
    }

    return chunks.join("\n").trim();
  }

  private extract_text_from_stream(content: string): string {
    const parts: string[] = [];

    const tj_re = /\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = tj_re.exec(content)) !== null) {
      const decoded = m[1]!.replace(/\\(\d{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\").replace(/\\([()])/g, "$1");
      if (decoded.trim()) parts.push(decoded);
    }

    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  private extract_info_field(text: string, field: string): string | null {
    const re = new RegExp(`/${field}\\s*\\(([^)]*)\\)`);
    const m = text.match(re);
    return m?.[1] || null;
  }

  private parse_page_range(range: string): Set<number> {
    const pages = new Set<number>();
    for (const part of range.split(",")) {
      const trimmed = part.trim();
      if (trimmed.includes("-")) {
        const [start, end] = trimmed.split("-").map(Number);
        if (start && end) for (let i = start; i <= end; i++) pages.add(i);
      } else {
        const n = Number(trimmed);
        if (n) pages.add(n);
      }
    }
    return pages;
  }
}
