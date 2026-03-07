/** CSV 도구 — CSV 파싱/생성/변환. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class CsvTool extends Tool {
  readonly name = "csv";
  readonly category = "data" as const;
  readonly description = "CSV operations: parse (CSV to JSON), generate (JSON to CSV), count, headers, filter.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "generate", "count", "headers", "filter"], description: "CSV operation" },
      data: { type: "string", description: "CSV string (parse/count/headers/filter) or JSON array string (generate)" },
      delimiter: { type: "string", description: "Column delimiter (default: ',')" },
      has_header: { type: "boolean", description: "First row is header (default: true)" },
      columns: { type: "string", description: "Comma-separated column names to include (filter)" },
      quote: { type: "string", description: "Quote character (default: '\"')" },
    },
    required: ["action", "data"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");
    const data = String(params.data || "");
    const delim = String(params.delimiter || ",");
    const quote = String(params.quote || '"');
    const has_header = params.has_header !== false;

    switch (action) {
      case "parse": return this.parse_csv(data, delim, quote, has_header);
      case "generate": return this.generate_csv(data, delim, quote);
      case "count": return this.count_csv(data, delim, quote, has_header);
      case "headers": return this.get_headers(data, delim, quote);
      case "filter": return this.filter_csv(data, delim, quote, has_header, String(params.columns || ""));
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private parse_csv(csv: string, delim: string, quote: string, has_header: boolean): string {
    const rows = this.split_rows(csv, delim, quote);
    if (rows.length === 0) return JSON.stringify({ rows: [], count: 0 });

    if (has_header && rows.length > 1) {
      const headers = rows[0]!;
      const objects = rows.slice(1).map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
        return obj;
      });
      return JSON.stringify({ rows: objects, count: objects.length, headers });
    }

    return JSON.stringify({ rows, count: rows.length });
  }

  private generate_csv(json_str: string, delim: string, quote: string): string {
    let data: unknown[];
    try { data = JSON.parse(json_str); } catch { return "Error: data must be valid JSON array"; }
    if (!Array.isArray(data) || data.length === 0) return "";

    if (typeof data[0] === "object" && data[0] !== null && !Array.isArray(data[0])) {
      const headers = Object.keys(data[0] as Record<string, unknown>);
      const lines = [headers.map((h) => this.escape_field(h, delim, quote)).join(delim)];
      for (const row of data) {
        const obj = row as Record<string, unknown>;
        lines.push(headers.map((h) => this.escape_field(String(obj[h] ?? ""), delim, quote)).join(delim));
      }
      return lines.join("\n");
    }

    return (data as unknown[][]).map((row) =>
      (Array.isArray(row) ? row : [row]).map((cell) => this.escape_field(String(cell), delim, quote)).join(delim),
    ).join("\n");
  }

  private count_csv(csv: string, delim: string, quote: string, has_header: boolean): string {
    const rows = this.split_rows(csv, delim, quote);
    const data_rows = has_header ? rows.length - 1 : rows.length;
    return JSON.stringify({ total_rows: rows.length, data_rows: Math.max(0, data_rows), columns: rows[0]?.length ?? 0 });
  }

  private get_headers(csv: string, delim: string, quote: string): string {
    const rows = this.split_rows(csv, delim, quote);
    return JSON.stringify({ headers: rows[0] ?? [], count: rows[0]?.length ?? 0 });
  }

  private filter_csv(csv: string, delim: string, quote: string, has_header: boolean, columns: string): string {
    const rows = this.split_rows(csv, delim, quote);
    if (!has_header || rows.length < 2) return "Error: headers required for filter";
    const headers = rows[0]!;
    const selected = columns.split(",").map((c) => c.trim());
    const indices = selected.map((c) => headers.indexOf(c)).filter((i) => i >= 0);

    const filtered_headers = indices.map((i) => headers[i]!);
    const filtered_rows = rows.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      indices.forEach((i, j) => { obj[filtered_headers[j]!] = row[i] ?? ""; });
      return obj;
    });
    return JSON.stringify({ rows: filtered_rows, count: filtered_rows.length, headers: filtered_headers });
  }

  private split_rows(csv: string, delim: string, quote: string): string[][] {
    const lines = csv.trim().split("\n");
    return lines.map((line) => this.parse_line(line.trimEnd(), delim, quote));
  }

  private parse_line(line: string, delim: string, quote: string): string[] {
    const fields: string[] = [];
    let current = "";
    let in_quotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (in_quotes) {
        if (ch === quote) {
          if (i + 1 < line.length && line[i + 1] === quote) {
            current += quote;
            i++;
          } else {
            in_quotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === quote) {
        in_quotes = true;
      } else if (ch === delim) {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  }

  private escape_field(field: string, delim: string, quote: string): string {
    if (field.includes(delim) || field.includes(quote) || field.includes("\n")) {
      return quote + field.replace(new RegExp(this.escape_regex(quote), "g"), quote + quote) + quote;
    }
    return field;
  }

  private escape_regex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
