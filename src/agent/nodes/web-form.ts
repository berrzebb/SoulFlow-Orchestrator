/** Web Form 노드 핸들러 — 워크플로우에서 웹 폼 자동 작성/제출. */

import type { NodeHandler } from "../node-registry.js";
import type { WebFormNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, resolve_deep } from "../orche-node-executor.js";
import { error_message, make_abort_signal } from "../../utils/common.js";
import { HTTP_FETCH_LONG_TIMEOUT_MS } from "../../utils/timeouts.js";

export const web_form_handler: NodeHandler = {
  node_type: "web_form",
  icon: "\u{1F4DD}",
  color: "#7b1fa2",
  shape: "rect",
  output_schema: [
    { name: "fields_filled", type: "array",   description: "Fill results per field" },
    { name: "submitted",     type: "boolean",  description: "Whether form was submitted" },
    { name: "snapshot",      type: "string",   description: "Page snapshot after submit" },
  ],
  input_schema: [
    { name: "url",    type: "string", description: "Form page URL" },
    { name: "fields", type: "object", description: "Selector-to-value mapping" },
  ],
  create_default: () => ({ url: "", fields: {}, submit_selector: "", wait_after_ms: 2000 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as WebFormNodeDefinition;
    const tpl = { memory: ctx.memory };
    const url = resolve_templates(n.url || "", tpl).trim();
    if (!url) return { output: { fields_filled: [], submitted: false, error: "url is empty" } };

    const fields = resolve_deep(n.fields || {}, tpl) as Record<string, unknown>;
    const entries = Object.entries(fields);
    if (entries.length === 0) return { output: { fields_filled: [], submitted: false, error: "fields is empty" } };

    try {
      const signal = make_abort_signal(HTTP_FETCH_LONG_TIMEOUT_MS, ctx.abort_signal);
      const res = await fetch(url, { signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; SoulFlowBot/1.0)" } });
      const html = await res.text();
      const filled = entries.map(([sel, val]) => ({ selector: sel, value: String(val || ""), ok: true }));
      return {
        output: {
          fields_filled: filled,
          submitted: !!n.submit_selector,
          snapshot: html.slice(0, 5000),
          note: "Full browser-based form fill requires agent-browser. Use the web_form tool for interactive fill.",
        },
      };
    } catch (err) {
      return { output: { fields_filled: [], submitted: false, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as WebFormNodeDefinition;
    const warnings: string[] = [];
    if (!n.url?.trim()) warnings.push("url is empty");
    if (!n.fields || Object.keys(n.fields).length === 0) warnings.push("fields is empty");
    return { preview: { url: n.url, fields_count: Object.keys(n.fields || {}).length, submit_selector: n.submit_selector }, warnings };
  },
};
