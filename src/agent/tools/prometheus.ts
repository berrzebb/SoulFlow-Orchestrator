/** Prometheus 도구 — Prometheus 메트릭 포맷/파싱/push. */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { error_message, make_abort_signal } from "../../utils/common.js";
import { HTTP_FETCH_SHORT_TIMEOUT_MS } from "../../utils/timeouts.js";

type Metric = { name: string; type?: string; help?: string; value: number; labels?: Record<string, string>; timestamp?: number };

export class PrometheusTool extends Tool {
  readonly name = "prometheus";
  readonly category = "external" as const;
  readonly description = "Prometheus metrics: format, parse, push, query_format.";
  readonly policy_flags = { network: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["format", "parse", "push", "query_format"], description: "Prometheus operation" },
      metrics: { type: "string", description: "JSON array of metrics [{name, type, help, value, labels}]" },
      input: { type: "string", description: "Prometheus exposition format text" },
      pushgateway_url: { type: "string", description: "Pushgateway URL for push" },
      job: { type: "string", description: "Job name for push (default: soulflow)" },
      query: { type: "string", description: "PromQL expression for query_format" },
      start: { type: "string", description: "Range query start (ISO 8601)" },
      end: { type: "string", description: "Range query end (ISO 8601)" },
      step: { type: "string", description: "Range query step (e.g. 15s, 1m)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "format");

    switch (action) {
      case "format": {
        let metrics: Metric[];
        try { metrics = JSON.parse(String(params.metrics || "[]")); } catch { return "Error: metrics must be valid JSON array"; }
        return this.format_exposition(metrics);
      }
      case "parse": {
        const input = String(params.input || "");
        const metrics = this.parse_exposition(input);
        return JSON.stringify({ metrics, count: metrics.length });
      }
      case "push": {
        const gateway = String(params.pushgateway_url || "");
        if (!gateway) return "Error: pushgateway_url is required";
        const job = String(params.job || "soulflow");
        let metrics: Metric[];
        try { metrics = JSON.parse(String(params.metrics || "[]")); } catch { return "Error: metrics must be valid JSON array"; }
        const body = this.format_exposition(metrics);
        try {
          const url = `${gateway.replace(/\/+$/, "")}/metrics/job/${encodeURIComponent(job)}`;
          const resp = await fetch(url, { method: "POST", body, headers: { "Content-Type": "text/plain" }, signal: make_abort_signal(HTTP_FETCH_SHORT_TIMEOUT_MS, context?.signal) });
          return JSON.stringify({ success: resp.ok, status: resp.status, url });
        } catch (e) {
          return JSON.stringify({ success: false, error: error_message(e) });
        }
      }
      case "query_format": {
        const query = String(params.query || "");
        if (!query) return "Error: query is required";
        const result: Record<string, string> = { query };
        if (params.start) result.start = String(params.start);
        if (params.end) result.end = String(params.end);
        if (params.step) result.step = String(params.step);
        const qs = new URLSearchParams(result).toString();
        const endpoint = params.start ? "/api/v1/query_range" : "/api/v1/query";
        return JSON.stringify({ endpoint, query_string: qs, url: `${endpoint}?${qs}` });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private format_exposition(metrics: Metric[]): string {
    const lines: string[] = [];
    const seen = new Set<string>();

    for (const m of metrics) {
      if (!seen.has(m.name)) {
        seen.add(m.name);
        if (m.help) lines.push(`# HELP ${m.name} ${m.help}`);
        if (m.type) lines.push(`# TYPE ${m.name} ${m.type}`);
      }
      let label_str = "";
      if (m.labels && Object.keys(m.labels).length > 0) {
        const pairs = Object.entries(m.labels).map(([k, v]) => `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
        label_str = `{${pairs.join(",")}}`;
      }
      const ts = m.timestamp ? ` ${m.timestamp}` : "";
      lines.push(`${m.name}${label_str} ${m.value}${ts}`);
    }
    return lines.join("\n") + "\n";
  }

  private parse_exposition(input: string): Metric[] {
    const metrics: Metric[] = [];
    const type_map: Record<string, string> = {};
    const help_map: Record<string, string> = {};

    for (const line of input.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const type_match = trimmed.match(/^# TYPE (\S+) (\S+)$/);
      if (type_match) { type_map[type_match[1]!] = type_match[2]!; continue; }
      const help_match = trimmed.match(/^# HELP (\S+) (.+)$/);
      if (help_match) { help_map[help_match[1]!] = help_match[2]!; continue; }
      if (trimmed.startsWith("#")) continue;

      const metric_match = trimmed.match(/^(\S+?)(?:\{([^}]*)\})?\s+([\d.eE+-]+(?:NaN|Inf)?)(?:\s+(\d+))?$/);
      if (metric_match) {
        const name = metric_match[1]!;
        const labels: Record<string, string> = {};
        if (metric_match[2]) {
          for (const pair of metric_match[2].split(",")) {
            const [k, v] = pair.split("=");
            if (k && v) labels[k.trim()] = v.replace(/^"|"$/g, "");
          }
        }
        metrics.push({
          name,
          type: type_map[name],
          help: help_map[name],
          value: Number(metric_match[3]),
          labels: Object.keys(labels).length > 0 ? labels : undefined,
          timestamp: metric_match[4] ? Number(metric_match[4]) : undefined,
        });
      }
    }
    return metrics;
  }
}
