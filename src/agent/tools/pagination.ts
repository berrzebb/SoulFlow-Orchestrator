/** Pagination 도구 — offset/cursor/keyset 3모드 페이지네이션 메타데이터 계산. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class PaginationTool extends Tool {
  readonly name = "pagination";
  readonly category = "data" as const;
  readonly description = "Pagination: offset, cursor, keyset, calculate, generate_links, parse_link_header.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["offset", "cursor", "keyset", "calculate", "generate_links", "parse_link_header"], description: "Operation" },
      page: { type: "integer", description: "Current page (1-based)" },
      per_page: { type: "integer", description: "Items per page" },
      total: { type: "integer", description: "Total item count" },
      cursor: { type: "string", description: "Current cursor value" },
      next_cursor: { type: "string", description: "Next cursor value" },
      prev_cursor: { type: "string", description: "Previous cursor value" },
      has_more: { type: "boolean", description: "Whether more items exist" },
      sort_key: { type: "string", description: "Sort key for keyset pagination" },
      last_value: { type: "string", description: "Last value of sort key" },
      base_url: { type: "string", description: "Base URL for link generation" },
      header: { type: "string", description: "Link header value to parse" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "calculate");

    switch (action) {
      case "offset": {
        const page = Math.max(1, Number(params.page || 1));
        const per_page = Math.max(1, Number(params.per_page || 20));
        const total = Math.max(0, Number(params.total || 0));
        const total_pages = Math.ceil(total / per_page) || 1;
        const offset = (page - 1) * per_page;
        return JSON.stringify({
          mode: "offset", page, per_page, total, total_pages,
          offset, limit: per_page,
          has_prev: page > 1, has_next: page < total_pages,
          first_page: 1, last_page: total_pages,
        });
      }
      case "cursor": {
        const cursor = params.cursor ? String(params.cursor) : null;
        const next_cursor = params.next_cursor ? String(params.next_cursor) : null;
        const prev_cursor = params.prev_cursor ? String(params.prev_cursor) : null;
        const per_page = Math.max(1, Number(params.per_page || 20));
        const has_more = params.has_more === true;
        return JSON.stringify({
          mode: "cursor", per_page, current_cursor: cursor,
          next_cursor: has_more ? next_cursor : null,
          prev_cursor, has_more,
        });
      }
      case "keyset": {
        const sort_key = String(params.sort_key || "id");
        const last_value = params.last_value ? String(params.last_value) : null;
        const per_page = Math.max(1, Number(params.per_page || 20));
        const has_more = params.has_more === true;
        return JSON.stringify({
          mode: "keyset", sort_key, last_value, per_page, has_more,
          filter: last_value ? `WHERE ${sort_key} > '${last_value}' ORDER BY ${sort_key} LIMIT ${per_page}` : `ORDER BY ${sort_key} LIMIT ${per_page}`,
        });
      }
      case "calculate": {
        const page = Math.max(1, Number(params.page || 1));
        const per_page = Math.max(1, Number(params.per_page || 20));
        const total = Math.max(0, Number(params.total || 0));
        const total_pages = Math.ceil(total / per_page) || 1;
        const from = Math.min((page - 1) * per_page + 1, total);
        const to = Math.min(page * per_page, total);
        return JSON.stringify({
          page, per_page, total, total_pages,
          from, to, showing: to - from + 1,
          has_prev: page > 1, has_next: page < total_pages,
        });
      }
      case "generate_links": {
        const base_url = String(params.base_url || "/api/items");
        const page = Math.max(1, Number(params.page || 1));
        const per_page = Math.max(1, Number(params.per_page || 20));
        const total = Math.max(0, Number(params.total || 0));
        const total_pages = Math.ceil(total / per_page) || 1;
        const link = (p: number, rel: string) => `<${base_url}?page=${p}&per_page=${per_page}>; rel="${rel}"`;
        const links: string[] = [link(1, "first"), link(total_pages, "last")];
        if (page > 1) links.push(link(page - 1, "prev"));
        if (page < total_pages) links.push(link(page + 1, "next"));
        return JSON.stringify({ header: links.join(", "), links: Object.fromEntries(links.map((l) => {
          const rel = l.match(/rel="(\w+)"/)?.[1] || "";
          const url = l.match(/<([^>]+)>/)?.[1] || "";
          return [rel, url];
        })) });
      }
      case "parse_link_header": {
        const header = String(params.header || "");
        const result: Record<string, string> = {};
        for (const part of header.split(",")) {
          const url_match = part.match(/<([^>]+)>/);
          const rel_match = part.match(/rel="(\w+)"/);
          if (url_match && rel_match) result[rel_match[1]] = url_match[1];
        }
        return JSON.stringify({ links: result, count: Object.keys(result).length });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }
}
