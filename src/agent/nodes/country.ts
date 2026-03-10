/** Country 노드 핸들러 — 국가 정보 조회/검색. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type CountryNodeDefinition = OrcheNodeDefinition & {
  action?: string;
  code?: string;
  query?: string;
  dial_code?: string;
  currency?: string;
  continent?: string;
}

export const country_handler: NodeHandler = {
  node_type: "country",
  icon: "\u{1F30D}",
  color: "#1565c0",
  shape: "rect",
  output_schema: [
    { name: "name",      type: "string", description: "Country name" },
    { name: "code",      type: "string", description: "ISO 2-letter country code" },
    { name: "dial",      type: "string", description: "Dial code (e.g. +82)" },
    { name: "currency",  type: "string", description: "Currency code" },
    { name: "results",   type: "array",  description: "Search results" },
    { name: "count",     type: "number", description: "Result count" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "lookup/search/by_dial_code/by_currency/by_continent/list" },
    { name: "code",   type: "string", description: "Country code (ISO 3166-1)" },
  ],
  create_default: () => ({ action: "lookup", code: "", query: "", dial_code: "", currency: "", continent: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CountryNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { CountryTool } = await import("../tools/country.js");
      const tool = new CountryTool();
      const raw = await tool.execute({
        action:    n.action || "lookup",
        code:      resolve_templates(n.code || "", tpl) || undefined,
        query:     resolve_templates(n.query || "", tpl) || undefined,
        dial_code: resolve_templates(n.dial_code || "", tpl) || undefined,
        currency:  resolve_templates(n.currency || "", tpl) || undefined,
        continent: resolve_templates(n.continent || "", tpl) || undefined,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as CountryNodeDefinition;
    const warnings: string[] = [];
    if (n.action === "lookup" && !n.code?.trim()) warnings.push("code is required for lookup");
    if (n.action === "search" && !n.query?.trim()) warnings.push("query is required for search");
    return { preview: { action: n.action, code: n.code }, warnings };
  },
};
