/** Metric 도구 — 메트릭 수집/집계 (counter/gauge/histogram/summary). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface Counter { type: "counter"; value: number; labels: Record<string, string>; }
interface Gauge { type: "gauge"; value: number; labels: Record<string, string>; }
interface Histogram { type: "histogram"; values: number[]; buckets: number[]; labels: Record<string, string>; }
interface Summary { type: "summary"; values: number[]; labels: Record<string, string>; }
type Metric = Counter | Gauge | Histogram | Summary;

const metrics = new Map<string, Metric>();

export class MetricTool extends Tool {
  readonly name = "metric";
  readonly category = "data" as const;
  readonly description = "Metric collection: counter, gauge, histogram, summary, collect, format_prometheus, format_json.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["counter", "gauge", "histogram", "summary", "collect", "format_prometheus", "format_json"], description: "Operation" },
      name: { type: "string", description: "Metric name" },
      value: { type: "number", description: "Value to record" },
      labels: { type: "string", description: "JSON labels object" },
      buckets: { type: "string", description: "JSON array of histogram bucket boundaries" },
      op: { type: "string", enum: ["inc", "dec", "set", "observe"], description: "Sub-operation" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "collect");
    const name = String(params.name || "");
    const value = Number(params.value ?? 1);
    const labels = this.parse_labels(params.labels);

    switch (action) {
      case "counter": {
        const key = this.metric_key(name, labels);
        let m = metrics.get(key) as Counter | undefined;
        if (!m) { m = { type: "counter", value: 0, labels }; metrics.set(key, m); }
        m.value += Math.max(0, value);
        return JSON.stringify({ name, type: "counter", value: m.value, labels });
      }
      case "gauge": {
        const key = this.metric_key(name, labels);
        let m = metrics.get(key) as Gauge | undefined;
        if (!m) { m = { type: "gauge", value: 0, labels }; metrics.set(key, m); }
        const op = String(params.op || "set");
        if (op === "inc") m.value += value;
        else if (op === "dec") m.value -= value;
        else m.value = value;
        return JSON.stringify({ name, type: "gauge", value: m.value, labels });
      }
      case "histogram": {
        const key = this.metric_key(name, labels);
        let m = metrics.get(key) as Histogram | undefined;
        if (!m) {
          let buckets: number[];
          try { buckets = JSON.parse(String(params.buckets || "[0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10]")); }
          catch { buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]; }
          m = { type: "histogram", values: [], buckets, labels };
          metrics.set(key, m);
        }
        m.values.push(value);
        const bucket_counts = m.buckets.map((b) => ({ le: b, count: m!.values.filter((v) => v <= b).length }));
        bucket_counts.push({ le: Infinity, count: m.values.length });
        const sum = m.values.reduce((s, v) => s + v, 0);
        return JSON.stringify({ name, type: "histogram", count: m.values.length, sum: Math.round(sum * 1e6) / 1e6, buckets: bucket_counts });
      }
      case "summary": {
        const key = this.metric_key(name, labels);
        let m = metrics.get(key) as Summary | undefined;
        if (!m) { m = { type: "summary", values: [], labels }; metrics.set(key, m); }
        m.values.push(value);
        const sorted = [...m.values].sort((a, b) => a - b);
        const len = sorted.length;
        const quantiles = [0.5, 0.9, 0.95, 0.99].map((q) => ({
          quantile: q,
          value: sorted[Math.min(Math.floor(q * len), len - 1)],
        }));
        const sum = m.values.reduce((s, v) => s + v, 0);
        return JSON.stringify({ name, type: "summary", count: len, sum: Math.round(sum * 1e6) / 1e6, quantiles });
      }
      case "collect": {
        const all: { name: string; type: string; value?: number; count?: number }[] = [];
        for (const [key, m] of metrics) {
          const n = key.split("{")[0];
          if (m.type === "counter" || m.type === "gauge") {
            all.push({ name: n, type: m.type, value: m.value });
          } else {
            all.push({ name: n, type: m.type, count: (m as Histogram | Summary).values.length });
          }
        }
        return JSON.stringify({ metric_count: all.length, metrics: all });
      }
      case "format_prometheus": {
        const lines: string[] = [];
        for (const [key, m] of metrics) {
          const n = key.split("{")[0];
          const label_str = this.prom_labels(m.labels);
          if (m.type === "counter") {
            lines.push(`# TYPE ${n} counter`);
            lines.push(`${n}${label_str} ${m.value}`);
          } else if (m.type === "gauge") {
            lines.push(`# TYPE ${n} gauge`);
            lines.push(`${n}${label_str} ${m.value}`);
          } else if (m.type === "histogram") {
            const h = m as Histogram;
            lines.push(`# TYPE ${n} histogram`);
            const sum = h.values.reduce((s, v) => s + v, 0);
            for (const b of h.buckets) {
              lines.push(`${n}_bucket${this.prom_labels({ ...m.labels, le: String(b) })} ${h.values.filter((v) => v <= b).length}`);
            }
            lines.push(`${n}_bucket${this.prom_labels({ ...m.labels, le: "+Inf" })} ${h.values.length}`);
            lines.push(`${n}_sum${label_str} ${sum}`);
            lines.push(`${n}_count${label_str} ${h.values.length}`);
          } else if (m.type === "summary") {
            const s = m as Summary;
            lines.push(`# TYPE ${n} summary`);
            const sum = s.values.reduce((acc, v) => acc + v, 0);
            const sorted = [...s.values].sort((a, b) => a - b);
            for (const q of [0.5, 0.9, 0.99]) {
              lines.push(`${n}${this.prom_labels({ ...m.labels, quantile: String(q) })} ${sorted[Math.min(Math.floor(q * sorted.length), sorted.length - 1)]}`);
            }
            lines.push(`${n}_sum${label_str} ${sum}`);
            lines.push(`${n}_count${label_str} ${s.values.length}`);
          }
        }
        return JSON.stringify({ format: "prometheus", text: lines.join("\n") });
      }
      case "format_json": {
        const result: Record<string, unknown>[] = [];
        for (const [key, m] of metrics) {
          const n = key.split("{")[0];
          if (m.type === "counter" || m.type === "gauge") {
            result.push({ name: n, type: m.type, value: m.value, labels: m.labels });
          } else if (m.type === "histogram") {
            const h = m as Histogram;
            result.push({ name: n, type: "histogram", count: h.values.length, sum: h.values.reduce((s, v) => s + v, 0), labels: m.labels });
          } else {
            const s = m as Summary;
            result.push({ name: n, type: "summary", count: s.values.length, sum: s.values.reduce((acc, v) => acc + v, 0), labels: m.labels });
          }
        }
        return JSON.stringify({ metrics: result });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_labels(val: unknown): Record<string, string> {
    try { return val ? JSON.parse(String(val)) : {}; } catch { return {}; }
  }

  private metric_key(name: string, labels: Record<string, string>): string {
    const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${v}"`).join(",");
    return sorted ? `${name}{${sorted}}` : name;
  }

  private prom_labels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return "";
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
  }
}
