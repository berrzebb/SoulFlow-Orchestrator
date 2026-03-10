/** Web Table 노드 핸들러 — 웹 테이블 데이터 추출. */

import type { NodeHandler } from "../node-registry.js";
import type { WebTableNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message, make_abort_signal } from "../../utils/common.js";

export const web_table_handler: NodeHandler = {
  node_type: "web_table",
  icon: "\u{1F4CA}",
  color: "#0d47a1",
  shape: "rect",
  output_schema: [
    { name: "headers", type: "array",  description: "Column headers" },
    { name: "rows",    type: "array",  description: "Row objects" },
    { name: "total",   type: "number", description: "Total row count" },
  ],
  input_schema: [
    { name: "url",      type: "string", description: "Target URL" },
    { name: "selector", type: "string", description: "CSS selector for table" },
  ],
  create_default: () => ({ url: "", selector: "table", max_rows: 100 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as WebTableNodeDefinition;
    const tpl = { memory: ctx.memory };
    const url = resolve_templates(n.url || "", tpl).trim();
    const selector = resolve_templates(n.selector || "table", tpl);
    const max_rows = Math.min(1000, Math.max(1, n.max_rows || 100));

    if (!url) return { output: { headers: [], rows: [], total: 0, error: "url is empty" } };

    try {
      const signal = make_abort_signal(30_000, ctx.abort_signal);
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SoulFlowBot/1.0)" },
        signal,
      });
      const html = await res.text();
      const table = parse_html_table(html, selector, max_rows);
      return { output: table };
    } catch (err) {
      return { output: { headers: [], rows: [], total: 0, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as WebTableNodeDefinition;
    const warnings: string[] = [];
    if (!n.url?.trim()) warnings.push("url is empty");
    return { preview: { url: n.url, selector: n.selector, max_rows: n.max_rows }, warnings };
  },
};

function parse_html_table(html: string, _selector: string, max_rows: number): { headers: string[]; rows: Record<string, string>[]; total: number } {
  const table_match = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!table_match) return { headers: [], rows: [], total: 0 };
  const table_html = table_match[1];

  const headers: string[] = [];
  const th_re = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let th_m: RegExpExecArray | null;
  while ((th_m = th_re.exec(table_html)) !== null) {
    headers.push(th_m[1].replace(/<[^>]+>/g, "").trim());
  }

  const rows: Record<string, string>[] = [];
  const tr_re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr_m: RegExpExecArray | null;
  while ((tr_m = tr_re.exec(table_html)) !== null && rows.length < max_rows) {
    const cells: string[] = [];
    const td_re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td_m: RegExpExecArray | null;
    while ((td_m = td_re.exec(tr_m[1])) !== null) {
      cells.push(td_m[1].replace(/<[^>]+>/g, "").trim());
    }
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    cells.forEach((c, j) => { row[headers[j] || `col_${j}`] = c; });
    rows.push(row);
  }

  return { headers, rows, total: rows.length };
}
