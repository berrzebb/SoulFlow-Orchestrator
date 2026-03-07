/** XML 도구 — XML 파싱 (XPath 쿼리) + XML 생성. 순수 Node.js 구현. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class XmlTool extends Tool {
  readonly name = "xml";
  readonly category = "data" as const;
  readonly description = "XML operations: parse (XML to JSON), generate (JSON to XML), query (simple path query), validate, pretty.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "generate", "query", "validate", "pretty"], description: "XML operation" },
      data: { type: "string", description: "XML string (parse/query/validate/pretty) or JSON string (generate)" },
      path: { type: "string", description: "Simple path query like 'root.items.item' (query action)" },
    },
    required: ["action", "data"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");
    const data = String(params.data || "");

    switch (action) {
      case "parse": return this.parse_xml(data);
      case "generate": return this.generate_xml(data);
      case "query": return this.query_xml(data, String(params.path || ""));
      case "validate": return this.validate_xml(data);
      case "pretty": return this.pretty_xml(data);
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private parse_xml(xml: string): string {
    try {
      const result = this.xml_to_json(xml.trim());
      return JSON.stringify(result);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  private generate_xml(json_str: string): string {
    try {
      const obj = JSON.parse(json_str);
      return this.json_to_xml(obj, 0);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  private query_xml(xml: string, path: string): string {
    if (!path) return "Error: path is required for query";
    try {
      const parsed = this.xml_to_json(xml.trim());
      const parts = path.split(".");
      let current: unknown = parsed;
      for (const part of parts) {
        if (current && typeof current === "object" && !Array.isArray(current)) {
          current = (current as Record<string, unknown>)[part];
        } else if (Array.isArray(current)) {
          const idx = Number(part);
          current = Number.isInteger(idx) ? current[idx] : current.map((i) => (i as Record<string, unknown>)?.[part]);
        } else {
          return JSON.stringify({ result: null, path });
        }
      }
      return JSON.stringify({ result: current, path });
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  private validate_xml(xml: string): string {
    try {
      this.xml_to_json(xml.trim());
      return JSON.stringify({ valid: true });
    } catch (err) {
      return JSON.stringify({ valid: false, error: (err as Error).message });
    }
  }

  private pretty_xml(xml: string): string {
    try {
      const parsed = this.xml_to_json(xml.trim());
      return this.json_to_xml(parsed, 0);
    } catch {
      return xml;
    }
  }

  private xml_to_json(xml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const tag_re = /<([a-zA-Z_][\w.-]*)([^>]*)>([\s\S]*?)<\/\1>/g;
    const self_closing_re = /<([a-zA-Z_][\w.-]*)([^/>]*)\s*\/>/g;
    let match: RegExpExecArray | null;

    while ((match = tag_re.exec(xml)) !== null) {
      const [, name, attrs, content] = match;
      const value = this.parse_content(content!, attrs!);
      this.add_to_result(result, name!, value);
    }

    while ((match = self_closing_re.exec(xml)) !== null) {
      const [, name, attrs] = match;
      const value = this.parse_attrs(attrs!);
      this.add_to_result(result, name!, Object.keys(value).length > 0 ? value : null);
    }

    if (Object.keys(result).length === 0 && xml.trim() && !xml.trim().startsWith("<")) {
      return { "#text": xml.trim() } as Record<string, unknown>;
    }

    return result;
  }

  private parse_content(content: string, attrs: string): unknown {
    const trimmed = content.trim();
    if (/<[a-zA-Z_]/.test(trimmed)) {
      const inner = this.xml_to_json(trimmed);
      const attr_obj = this.parse_attrs(attrs);
      return Object.keys(attr_obj).length > 0 ? { ...attr_obj, ...inner } : inner;
    }
    const attr_obj = this.parse_attrs(attrs);
    if (Object.keys(attr_obj).length > 0) {
      return { ...attr_obj, "#text": trimmed };
    }
    return trimmed;
  }

  private parse_attrs(attrs: string): Record<string, string> {
    const result: Record<string, string> = {};
    const re = /(\w+)\s*=\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrs)) !== null) {
      result[`@${m[1]}`] = m[2]!;
    }
    return result;
  }

  private add_to_result(obj: Record<string, unknown>, key: string, value: unknown): void {
    if (key in obj) {
      const existing = obj[key];
      obj[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      obj[key] = value;
    }
  }

  private json_to_xml(obj: unknown, indent: number): string {
    const pad = "  ".repeat(indent);
    if (obj === null || obj === undefined) return "";
    if (typeof obj !== "object") return String(obj);
    if (Array.isArray(obj)) return obj.map((item) => this.json_to_xml(item, indent)).join("\n");

    const entries = Object.entries(obj as Record<string, unknown>);
    const lines: string[] = [];
    for (const [key, val] of entries) {
      if (key.startsWith("@") || key === "#text") continue;
      const attrs = this.collect_attrs(val);
      const attr_str = attrs ? ` ${attrs}` : "";

      if (val === null || val === undefined) {
        lines.push(`${pad}<${key}${attr_str} />`);
      } else if (typeof val === "object" && !Array.isArray(val)) {
        const text = (val as Record<string, unknown>)["#text"];
        const inner = this.json_to_xml(val, indent + 1);
        if (text !== undefined && Object.keys(val as object).filter((k) => !k.startsWith("@") && k !== "#text").length === 0) {
          lines.push(`${pad}<${key}${attr_str}>${text}</${key}>`);
        } else {
          lines.push(`${pad}<${key}${attr_str}>\n${inner}\n${pad}</${key}>`);
        }
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === "object" && item !== null) {
            lines.push(`${pad}<${key}>\n${this.json_to_xml(item, indent + 1)}\n${pad}</${key}>`);
          } else {
            lines.push(`${pad}<${key}>${item}</${key}>`);
          }
        }
      } else {
        lines.push(`${pad}<${key}${attr_str}>${val}</${key}>`);
      }
    }
    return lines.join("\n");
  }

  private collect_attrs(val: unknown): string {
    if (!val || typeof val !== "object" || Array.isArray(val)) return "";
    return Object.entries(val as Record<string, unknown>)
      .filter(([k]) => k.startsWith("@"))
      .map(([k, v]) => `${k.slice(1)}="${v}"`)
      .join(" ");
  }
}
