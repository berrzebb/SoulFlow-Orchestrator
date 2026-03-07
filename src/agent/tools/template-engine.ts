/** Template 도구 — Mustache 스타일 문자열 템플릿 렌더링. 조건부, 반복, 파셜 지원. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const MAX_TEMPLATE_SIZE = 1024 * 128;
const MAX_ITERATIONS = 1000;

export class TemplateTool extends Tool {
  readonly name = "template_engine";
  readonly category = "memory" as const;
  readonly description =
    "Render Mustache-style templates with variables, conditionals ({{#if}}), loops ({{#each}}), and helpers (upper, lower, json, default).";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      template: { type: "string", description: "Template string with {{variable}}, {{#if cond}}...{{/if}}, {{#each items}}...{{/each}}" },
      data: { type: "string", description: "JSON string of template variables" },
      partials: { type: "string", description: "JSON object of named partial templates" },
    },
    required: ["template"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const template = String(params.template || "");
    if (!template) return "Error: template is required";
    if (template.length > MAX_TEMPLATE_SIZE) return `Error: template exceeds ${MAX_TEMPLATE_SIZE} bytes`;

    let data: Record<string, unknown> = {};
    if (params.data) {
      try { data = JSON.parse(String(params.data)); }
      catch { return "Error: data must be valid JSON"; }
    }

    let partials: Record<string, string> = {};
    if (params.partials) {
      try { partials = JSON.parse(String(params.partials)); }
      catch { return "Error: partials must be valid JSON"; }
    }

    try {
      return this.render(template, data, partials);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  private render(template: string, data: Record<string, unknown>, partials: Record<string, string>, depth = 0): string {
    if (depth > 10) throw new Error("template recursion limit exceeded");

    let result = template;

    result = this.process_partials(result, partials, data, depth);
    result = this.process_each(result, data);
    result = this.process_if(result, data);
    result = this.process_unless(result, data);
    result = this.process_helpers(result, data);
    result = this.interpolate(result, data);

    return result;
  }

  private process_partials(tpl: string, partials: Record<string, string>, data: Record<string, unknown>, depth: number): string {
    return tpl.replace(/\{\{>\s*(\w+)\s*\}\}/g, (_m, name: string) => {
      const partial = partials[name];
      if (!partial) return `{{> ${name}}}`;
      return this.render(partial, data, partials, depth + 1);
    });
  }

  private process_each(tpl: string, data: Record<string, unknown>): string {
    const re = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    return tpl.replace(re, (_m, key: string, body: string) => {
      const items = this.resolve(data, key);
      if (!Array.isArray(items)) return "";
      const limited = items.slice(0, MAX_ITERATIONS);
      return limited.map((item, idx) => {
        const scope = typeof item === "object" && item !== null
          ? { ...data, ...item as Record<string, unknown>, "@index": idx, "@first": idx === 0, "@last": idx === limited.length - 1 }
          : { ...data, ".": item, "@index": idx, "@first": idx === 0, "@last": idx === limited.length - 1 };
        return this.interpolate(this.process_if(body, scope), scope);
      }).join("");
    });
  }

  private process_if(tpl: string, data: Record<string, unknown>): string {
    const re = /\{\{#if\s+(\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
    return tpl.replace(re, (_m, key: string, truthy: string, falsy: string | undefined) => {
      return this.is_truthy(this.resolve(data, key)) ? truthy : (falsy || "");
    });
  }

  private process_unless(tpl: string, data: Record<string, unknown>): string {
    const re = /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g;
    return tpl.replace(re, (_m, key: string, body: string) => {
      return this.is_truthy(this.resolve(data, key)) ? "" : body;
    });
  }

  private process_helpers(tpl: string, data: Record<string, unknown>): string {
    return tpl.replace(/\{\{(\w+)\s+(\w[\w.]*)\}\}/g, (_m, helper: string, key: string) => {
      const val = this.resolve(data, key);
      switch (helper) {
        case "upper": return String(val ?? "").toUpperCase();
        case "lower": return String(val ?? "").toLowerCase();
        case "json": return JSON.stringify(val ?? null);
        case "length": return String(Array.isArray(val) ? val.length : String(val ?? "").length);
        case "trim": return String(val ?? "").trim();
        default: return _m;
      }
    });
  }

  private interpolate(tpl: string, data: Record<string, unknown>): string {
    return tpl.replace(/\{\{(\w[\w.]*)\}\}/g, (_m, key: string) => {
      const val = this.resolve(data, key);
      if (val === undefined || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });
  }

  private resolve(data: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = data;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private is_truthy(val: unknown): boolean {
    if (val === null || val === undefined || val === false || val === 0 || val === "") return false;
    if (Array.isArray(val) && val.length === 0) return false;
    return true;
  }
}
