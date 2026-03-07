/** Web Table 도구 — 웹 페이지에서 테이블 데이터를 구조화 추출. agentBrowser 기반. */

import { Tool } from "./base.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { run_agent_browser } from "./agent-browser-client.js";

async function run_ab(args: string[], signal?: AbortSignal, timeout_ms = 30_000) {
  return run_agent_browser(args, { signal, timeout_ms });
}

export class WebTableTool extends Tool {
  readonly name = "web_table";
  readonly category = "web" as const;
  readonly policy_flags = { network: true } as const;
  readonly description = "Extract structured table data from a web page. Returns array of row objects.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      url: { type: "string", description: "Target URL" },
      selector: { type: "string", description: "CSS selector for the table (default: 'table')" },
      max_rows: { type: "integer", minimum: 1, maximum: 1000, description: "Max rows to extract" },
      session: { type: "string", description: "Browser session name" },
    },
    required: ["url"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const url = String(params.url || "").trim();
    if (!url) return "Error: url is required";
    const selector = String(params.selector || "table").trim();
    const max_rows = Math.min(1000, Math.max(1, Number(params.max_rows || 100)));
    const session = String(params.session || "table-extract").trim();
    const base = ["--session", session];

    if (context?.signal?.aborted) return "Error: cancelled";

    const open_r = await run_ab([...base, "open", url, "--json"], context?.signal);
    if (!open_r.ok) return "Error: agent_browser_not_installed or open failed";
    await run_ab([...base, "wait", "--load", "domcontentloaded", "--json"], context?.signal, 15_000);

    const js_code = `
      (function() {
        const tbl = document.querySelector(${JSON.stringify(selector)});
        if (!tbl) return JSON.stringify({ error: "table not found" });
        const headers = [];
        const ths = tbl.querySelectorAll("thead th, thead td, tr:first-child th, tr:first-child td");
        ths.forEach(function(th) { headers.push(th.textContent.trim()); });
        const rows = [];
        const trs = tbl.querySelectorAll("tbody tr, tr");
        const start = headers.length > 0 && trs.length > 0 && trs[0].querySelector("th") ? 1 : 0;
        for (var i = start; i < trs.length && rows.length < ${max_rows}; i++) {
          var cells = trs[i].querySelectorAll("td, th");
          if (cells.length === 0) continue;
          var row = {};
          cells.forEach(function(c, j) {
            var key = headers[j] || ("col_" + j);
            row[key] = c.textContent.trim();
          });
          rows.push(row);
        }
        return JSON.stringify({ headers: headers, rows: rows, total: rows.length });
      })()
    `.trim();

    const eval_r = await run_ab([...base, "evaluate", js_code, "--json"], context?.signal, 15_000);
    await run_ab([...base, "close", "--json"], context?.signal, 5_000).catch(() => {});

    if (!eval_r.ok) return "Error: failed to evaluate table extraction script";

    try {
      const data = eval_r.parsed?.data as Record<string, unknown> | undefined;
      const result_str = String(data?.result || data?.value || eval_r.stdout || "");
      const cleaned = result_str.replace(/^["']|["']$/g, "");
      const table_data = JSON.parse(cleaned);
      return JSON.stringify({ url, selector, ...table_data }, null, 2);
    } catch (err) {
      return `Error: failed to parse table data — ${error_message(err)}`;
    }
  }
}
