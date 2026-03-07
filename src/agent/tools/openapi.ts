/** OpenAPI 도구 — OpenAPI 3.x 스펙 파싱/검증/엔드포인트 추출. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class OpenApiTool extends Tool {
  readonly name = "openapi";
  readonly category = "data" as const;
  readonly description = "OpenAPI spec utilities: parse, list_endpoints, get_operation, validate, generate_client, to_markdown.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "list_endpoints", "get_operation", "validate", "generate_client", "to_markdown"], description: "Operation" },
      spec: { type: "string", description: "OpenAPI spec JSON/YAML string" },
      path: { type: "string", description: "API path (get_operation)" },
      method: { type: "string", description: "HTTP method (get_operation)" },
      language: { type: "string", description: "Target language for generate_client (curl/fetch/python)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");
    const spec_str = String(params.spec || "{}");
    let spec: Record<string, unknown>;
    try { spec = JSON.parse(spec_str); } catch { return JSON.stringify({ error: "invalid spec JSON" }); }

    switch (action) {
      case "parse": {
        return JSON.stringify({
          openapi: spec.openapi || spec.swagger,
          info: spec.info,
          servers: spec.servers,
          paths_count: spec.paths ? Object.keys(spec.paths as object).length : 0,
          tags: this.extract_tags(spec),
        });
      }
      case "list_endpoints": {
        const endpoints: { method: string; path: string; summary?: string; tags?: string[] }[] = [];
        const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
        for (const [p, methods] of Object.entries(paths)) {
          for (const [m, op] of Object.entries(methods)) {
            if (["get", "post", "put", "patch", "delete", "head", "options"].includes(m)) {
              const operation = op as Record<string, unknown>;
              endpoints.push({ method: m.toUpperCase(), path: p, summary: operation.summary as string, tags: operation.tags as string[] });
            }
          }
        }
        return JSON.stringify({ count: endpoints.length, endpoints });
      }
      case "get_operation": {
        const path = String(params.path || "");
        const method = String(params.method || "get").toLowerCase();
        const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
        const pathObj = paths[path];
        if (!pathObj) return JSON.stringify({ error: `path not found: ${path}` });
        const op = pathObj[method] as Record<string, unknown> | undefined;
        if (!op) return JSON.stringify({ error: `method not found: ${method}` });
        return JSON.stringify(op, null, 2);
      }
      case "validate": {
        const errors: string[] = [];
        if (!spec.openapi && !spec.swagger) errors.push("missing openapi/swagger version");
        if (!spec.info) errors.push("missing info object");
        if (!spec.paths) errors.push("missing paths object");
        const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
        for (const [p, methods] of Object.entries(paths)) {
          if (!p.startsWith("/")) errors.push(`path must start with /: ${p}`);
          for (const [m, op] of Object.entries(methods)) {
            if (["get", "post", "put", "patch", "delete"].includes(m)) {
              const operation = op as Record<string, unknown>;
              if (!operation.responses) errors.push(`${m.toUpperCase()} ${p}: missing responses`);
            }
          }
        }
        return JSON.stringify({ valid: errors.length === 0, errors });
      }
      case "generate_client": {
        const path = String(params.path || "");
        const method = String(params.method || "get").toLowerCase();
        const lang = String(params.language || "curl");
        const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
        const pathObj = paths[path];
        if (!pathObj) return JSON.stringify({ error: `path not found: ${path}` });
        const op = pathObj[method] as Record<string, unknown> | undefined;
        if (!op) return JSON.stringify({ error: `method not found: ${method}` });
        const servers = (spec.servers || [{ url: "https://api.example.com" }]) as { url: string }[];
        const base_url = servers[0]?.url || "https://api.example.com";
        const full_url = `${base_url}${path}`;
        return this.generate_snippet(method, full_url, op, lang);
      }
      case "to_markdown": {
        return this.spec_to_markdown(spec);
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private extract_tags(spec: Record<string, unknown>): string[] {
    const tags = new Set<string>();
    const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
    for (const methods of Object.values(paths)) {
      for (const [m, op] of Object.entries(methods)) {
        if (["get", "post", "put", "patch", "delete"].includes(m)) {
          const operation = op as Record<string, unknown>;
          for (const t of (operation.tags || []) as string[]) tags.add(t);
        }
      }
    }
    return [...tags];
  }

  private generate_snippet(method: string, url: string, op: Record<string, unknown>, lang: string): string {
    const has_body = ["post", "put", "patch"].includes(method);
    switch (lang) {
      case "curl": {
        let cmd = `curl -X ${method.toUpperCase()} '${url}'`;
        if (has_body) cmd += ` \\\n  -H 'Content-Type: application/json' \\\n  -d '{}'`;
        return cmd;
      }
      case "fetch": {
        let code = `const res = await fetch('${url}', {\n  method: '${method.toUpperCase()}',`;
        if (has_body) code += `\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({}),`;
        code += `\n});\nconst data = await res.json();`;
        return code;
      }
      case "python": {
        let code = `import requests\n\nres = requests.${method}('${url}'`;
        if (has_body) code += `, json={}`;
        code += `)\ndata = res.json()`;
        return code;
      }
      default:
        return JSON.stringify({ error: `unsupported language: ${lang}, use curl/fetch/python`, operation: op.operationId });
    }
  }

  private spec_to_markdown(spec: Record<string, unknown>): string {
    const info = (spec.info || {}) as Record<string, unknown>;
    const lines: string[] = [];
    lines.push(`# ${info.title || "API"}\n`);
    if (info.description) lines.push(`${info.description}\n`);
    if (info.version) lines.push(`**Version:** ${info.version}\n`);
    const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
    for (const [p, methods] of Object.entries(paths)) {
      for (const [m, op] of Object.entries(methods)) {
        if (["get", "post", "put", "patch", "delete"].includes(m)) {
          const operation = op as Record<string, unknown>;
          lines.push(`## ${m.toUpperCase()} ${p}\n`);
          if (operation.summary) lines.push(`${operation.summary}\n`);
          if (operation.description) lines.push(`${operation.description}\n`);
          const parameters = (operation.parameters || []) as Record<string, unknown>[];
          if (parameters.length > 0) {
            lines.push("**Parameters:**\n");
            for (const param of parameters) {
              lines.push(`- \`${param.name}\` (${param.in}${param.required ? ", required" : ""}): ${param.description || ""}`);
            }
            lines.push("");
          }
        }
      }
    }
    return lines.join("\n");
  }
}
