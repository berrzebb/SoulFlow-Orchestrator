/** HTML 도구 — HTML 파싱/텍스트 추출/테이블 추출/링크 추출/새니타이즈. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class HtmlTool extends Tool {
  readonly name = "html";
  readonly category = "data" as const;
  readonly description = "HTML utilities: extract_text, extract_links, extract_tables, sanitize, to_markdown.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["extract_text", "extract_links", "extract_tables", "sanitize", "to_markdown"], description: "HTML operation" },
      html: { type: "string", description: "HTML content to process" },
      selector: { type: "string", description: "CSS-like tag selector (e.g. 'div', 'p', 'a')" },
      allowed_tags: { type: "string", description: "Comma-separated allowed tags for sanitize (default: safe set)" },
    },
    required: ["action", "html"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "extract_text");
    const html = String(params.html || "");

    switch (action) {
      case "extract_text": {
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, " ")
          .trim();
        return JSON.stringify({ text, length: text.length });
      }
      case "extract_links": {
        const links: { href: string; text: string }[] = [];
        const re = /<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html))) {
          links.push({ href: m[1]!, text: m[2]!.replace(/<[^>]+>/g, "").trim() });
        }
        return JSON.stringify({ links, count: links.length });
      }
      case "extract_tables": {
        const tables: string[][][] = [];
        const table_re = /<table[^>]*>([\s\S]*?)<\/table>/gi;
        let tm: RegExpExecArray | null;
        while ((tm = table_re.exec(html))) {
          const rows: string[][] = [];
          const row_re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let rm: RegExpExecArray | null;
          while ((rm = row_re.exec(tm[1]!))) {
            const cells: string[] = [];
            const cell_re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
            let cm: RegExpExecArray | null;
            while ((cm = cell_re.exec(rm[1]!))) {
              cells.push(cm[1]!.replace(/<[^>]+>/g, "").trim());
            }
            if (cells.length) rows.push(cells);
          }
          if (rows.length) tables.push(rows);
        }
        return JSON.stringify({ tables, count: tables.length });
      }
      case "sanitize": {
        const allowed = params.allowed_tags
          ? String(params.allowed_tags).split(",").map((t) => t.trim().toLowerCase())
          : ["p", "br", "b", "i", "em", "strong", "a", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "code", "pre"];
        const sanitized = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag: string) => {
            return allowed.includes(tag.toLowerCase()) ? match : "";
          });
        return JSON.stringify({ html: sanitized });
      }
      case "to_markdown": {
        let md = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
        md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, level: string, text: string) => {
          return "\n" + "#".repeat(Number(level)) + " " + text.replace(/<[^>]+>/g, "").trim() + "\n";
        });
        md = md.replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
          return `[${text.replace(/<[^>]+>/g, "").trim()}](${href})`;
        });
        md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
        md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
        md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
        md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
        md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
        md = md.replace(/<br\s*\/?>/gi, "\n");
        md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
        md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
        md = md.replace(/<[^>]+>/g, "");
        md = md.replace(/\n{3,}/g, "\n\n").trim();
        return JSON.stringify({ markdown: md });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }
}
