/** Pagination 노드 핸들러 — offset/cursor/keyset 페이지네이션 메타데이터 계산. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type PaginationNodeDef = OrcheNodeDefinition & {
  action?: string;
  page?: number;
  per_page?: number;
  total?: number;
  cursor?: string;
  next_cursor?: string;
  prev_cursor?: string;
  has_more?: boolean;
  sort_key?: string;
  last_value?: string;
  base_url?: string;
  header?: string;
};

export const pagination_handler: NodeHandler = {
  node_type: "pagination",
  icon: "\u{1F4C4}",
  color: "#0277bd",
  shape: "rect",
  output_schema: [
    { name: "page",        type: "number",  description: "node.pagination.output.page" },
    { name: "per_page",    type: "number",  description: "node.pagination.output.per_page" },
    { name: "total_pages", type: "number",  description: "node.pagination.output.total_pages" },
    { name: "offset",      type: "number",  description: "node.pagination.output.offset" },
    { name: "has_next",    type: "boolean", description: "node.pagination.output.has_next" },
    { name: "has_prev",    type: "boolean", description: "node.pagination.output.has_prev" },
  ],
  input_schema: [
    { name: "action",   type: "string",  description: "node.pagination.input.action" },
    { name: "page",     type: "number",  description: "node.pagination.input.page" },
    { name: "per_page", type: "number",  description: "node.pagination.input.per_page" },
    { name: "total",    type: "number",  description: "node.pagination.input.total" },
  ],
  create_default: () => ({
    action: "offset", page: 1, per_page: 20, total: 0,
    cursor: "", next_cursor: "", prev_cursor: "", has_more: false,
    sort_key: "id", last_value: "", base_url: "", header: "",
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as PaginationNodeDef;
    const tpl = { memory: ctx.memory };
    try {
      const { PaginationTool } = await import("../tools/pagination.js");
      const tool = new PaginationTool();
      const raw = await tool.execute({
        action:      n.action || "offset",
        page:        n.page,
        per_page:    n.per_page,
        total:       n.total,
        cursor:      resolve_templates(n.cursor      || "", tpl) || undefined,
        next_cursor: resolve_templates(n.next_cursor || "", tpl) || undefined,
        prev_cursor: resolve_templates(n.prev_cursor || "", tpl) || undefined,
        has_more:    n.has_more,
        sort_key:    n.sort_key || undefined,
        last_value:  resolve_templates(n.last_value  || "", tpl) || undefined,
        base_url:    resolve_templates(n.base_url    || "", tpl) || undefined,
        header:      resolve_templates(n.header      || "", tpl) || undefined,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as PaginationNodeDef;
    const warnings: string[] = [];
    if (n.action === "cursor" && !n.cursor && !n.next_cursor) warnings.push("cursor or next_cursor recommended");
    if (n.action === "keyset" && !n.sort_key) warnings.push("sort_key is required for keyset mode");
    if (n.action === "generate_links" && !n.base_url) warnings.push("base_url is required for link generation");
    if (n.action === "parse_link_header" && !n.header) warnings.push("header value is required");
    return { preview: { action: n.action, page: n.page, per_page: n.per_page }, warnings };
  },
};
