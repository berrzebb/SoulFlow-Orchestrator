/** Markdown 도구 — JSON→마크다운 변환 (테이블, 리스트, 체크리스트), HTML→마크다운, TOC 생성. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class MarkdownTool extends Tool {
  readonly name = "markdown";
  readonly category = "memory" as const;
  readonly description =
    "Markdown generation: JSON to table/list/checklist, HTML to markdown, table of contents from headings, badge/link/image generation, code block wrapping.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["table", "list", "checklist", "toc", "html_to_md", "badge", "link", "image", "code_block", "details", "task_list"], description: "Markdown operation" },
      data: { type: "string", description: "JSON data (array of objects for table, array of strings for list)" },
      text: { type: "string", description: "Input text (for html_to_md, toc)" },
      columns: { type: "string", description: "Comma-separated column names (for table)" },
      align: { type: "string", description: "Comma-separated alignment (left/center/right) per column" },
      ordered: { type: "boolean", description: "Ordered list (default: false)" },
      label: { type: "string", description: "Badge/link label" },
      url: { type: "string", description: "URL for badge/link/image" },
      color: { type: "string", description: "Badge color" },
      alt: { type: "string", description: "Image alt text" },
      language: { type: "string", description: "Code block language" },
      code: { type: "string", description: "Code content" },
      summary: { type: "string", description: "Summary for details block" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "table");
    switch (op) {
      case "table": return this.to_table(String(params.data || "[]"), String(params.columns || ""), String(params.align || ""));
      case "list": return this.to_list(String(params.data || "[]"), Boolean(params.ordered));
      case "checklist": return this.to_checklist(String(params.data || "[]"));
      case "task_list": return this.to_checklist(String(params.data || "[]"));
      case "toc": return this.generate_toc(String(params.text || ""));
      case "html_to_md": return this.html_to_md(String(params.text || ""));
      case "badge": return this.badge(String(params.label || ""), String(params.text || params.url || ""), String(params.color || "blue"));
      case "link": return `[${String(params.label || params.text || "")}](${String(params.url || "")})`;
      case "image": return `![${String(params.alt || "")}](${String(params.url || "")})`;
      case "code_block": return `\`\`\`${String(params.language || "")}\n${String(params.code || params.text || "")}\n\`\`\``;
      case "details": return `<details>\n<summary>${String(params.summary || "Details")}</summary>\n\n${String(params.text || "")}\n\n</details>`;
      default: return `Error: unsupported operation "${op}"`;
    }
  }

  private to_table(data_str: string, columns_str: string, align_str: string): string {
    let rows: Record<string, unknown>[];
    try {
      const parsed = JSON.parse(data_str);
      if (!Array.isArray(parsed)) return "Error: data must be a JSON array";
      rows = parsed;
    } catch {
      return "Error: invalid JSON data";
    }
    if (rows.length === 0) return "*(empty table)*";

    const cols = columns_str.trim()
      ? columns_str.split(",").map((c) => c.trim())
      : [...new Set(rows.flatMap((r) => Object.keys(r)))];

    const aligns = align_str.trim() ? align_str.split(",").map((a) => a.trim().toLowerCase()) : [];

    const header = `| ${cols.join(" | ")} |`;
    const separator = `| ${cols.map((_, i) => {
      const a = aligns[i] || "left";
      if (a === "center") return ":---:";
      if (a === "right") return "---:";
      return "---";
    }).join(" | ")} |`;

    const body = rows.map((row) => {
      const cells = cols.map((c) => {
        const v = row[c];
        return v == null ? "" : String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
      });
      return `| ${cells.join(" | ")} |`;
    });

    return [header, separator, ...body].join("\n");
  }

  private to_list(data_str: string, ordered: boolean): string {
    let items: unknown[];
    try {
      items = JSON.parse(data_str);
      if (!Array.isArray(items)) return "Error: data must be a JSON array";
    } catch {
      items = data_str.split("\n").filter((l) => l.trim());
    }
    return items.map((item, i) => {
      const prefix = ordered ? `${i + 1}.` : "-";
      return `${prefix} ${String(item)}`;
    }).join("\n");
  }

  private to_checklist(data_str: string): string {
    let items: unknown[];
    try {
      const parsed = JSON.parse(data_str);
      if (!Array.isArray(parsed)) return "Error: data must be a JSON array";
      items = parsed;
    } catch {
      items = data_str.split("\n").filter((l) => l.trim());
    }
    return items.map((item) => {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const checked = Boolean(obj.checked || obj.done || obj.completed);
        const text = String(obj.text || obj.label || obj.title || obj.name || "");
        return `- [${checked ? "x" : " "}] ${text}`;
      }
      return `- [ ] ${String(item)}`;
    }).join("\n");
  }

  private generate_toc(text: string): string {
    const heading_re = /^(#{1,6})\s+(.+)$/gm;
    const entries: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = heading_re.exec(text)) !== null) {
      const level = match[1].length;
      const title = match[2].trim();
      const anchor = title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
      const indent = "  ".repeat(level - 1);
      entries.push(`${indent}- [${title}](#${anchor})`);
    }
    return entries.length > 0 ? entries.join("\n") : "*(no headings found)*";
  }

  private html_to_md(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, level, text) => `${"#".repeat(Number(level))} ${text}\n`)
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
      .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
      .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
      .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
      .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, "![$1]($2)")
      .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)")
      .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1")
      .replace(/<\/?[uo]l[^>]*>/gi, "")
      .replace(/<hr\s*\/?>/gi, "\n---\n")
      .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_, text) => text.split("\n").map((l: string) => `> ${l}`).join("\n"))
      .replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, "\n```\n$1\n```\n")
      .replace(/<del[^>]*>(.*?)<\/del>/gi, "~~$1~~")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private badge(label: string, value: string, color: string): string {
    const l = encodeURIComponent(label);
    const v = encodeURIComponent(value);
    const c = encodeURIComponent(color);
    return `![${label}](https://img.shields.io/badge/${l}-${v}-${c})`;
  }
}
