/** Prometheus 노드 핸들러 — Prometheus 메트릭 포맷/파싱/Pushgateway 전송. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type PrometheusNodeDefinition = OrcheNodeDefinition & {
  action?: string;
  metrics?: string;
  input?: string;
  pushgateway_url?: string;
  job?: string;
  query?: string;
  start?: string;
  end?: string;
  step?: string;
};

export const prometheus_handler: NodeHandler = {
  node_type: "prometheus",
  icon: "\u{1F4CA}",
  color: "#e65100",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "unknown", description: "Formatted metrics, parsed array, push result, or query URL" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action",  type: "string", description: "format/parse/push/query_format" },
    { name: "metrics", type: "string", description: "JSON array of metrics for format/push" },
  ],
  create_default: () => ({
    action: "format",
    metrics: '[{"name":"requests_total","type":"counter","help":"Total requests","value":0,"labels":{"env":"prod"}}]',
    input: "", pushgateway_url: "", job: "soulflow",
    query: "up", start: "", end: "", step: "15s",
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as PrometheusNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { PrometheusTool } = await import("../tools/prometheus.js");
      const tool = new PrometheusTool();
      const raw = await tool.execute({
        action: n.action || "format",
        metrics: n.metrics ? resolve_templates(n.metrics, tpl) : undefined,
        input: n.input ? resolve_templates(n.input, tpl) : undefined,
        pushgateway_url: n.pushgateway_url ? resolve_templates(n.pushgateway_url, tpl) : undefined,
        job: n.job || undefined,
        query: n.query ? resolve_templates(n.query, tpl) : undefined,
        start: n.start ? resolve_templates(n.start, tpl) : undefined,
        end: n.end ? resolve_templates(n.end, tpl) : undefined,
        step: n.step || undefined,
      });
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const success = !("error" in parsed);
        return { output: { result: parsed, success } };
      } catch {
        return { output: { result: raw, success: !raw.startsWith("Error:") } };
      }
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as PrometheusNodeDefinition;
    const warnings: string[] = [];
    if ((n.action === "format" || n.action === "push") && !n.metrics?.trim()) warnings.push("metrics is required");
    if (n.action === "push" && !n.pushgateway_url?.trim()) warnings.push("pushgateway_url is required");
    if (n.action === "query_format" && !n.query?.trim()) warnings.push("query is required");
    if (n.action === "parse" && !n.input?.trim()) warnings.push("input is required");
    return { preview: { action: n.action }, warnings };
  },
};
