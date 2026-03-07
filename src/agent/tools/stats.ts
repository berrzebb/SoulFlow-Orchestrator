/** Stats 도구 — 수치 데이터 통계 (mean, median, stdev, percentile, histogram). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const MAX_DATA_POINTS = 100_000;

export class StatsTool extends Tool {
  readonly name = "stats";
  readonly category = "memory" as const;
  readonly description =
    "Statistical analysis on numeric data: summary, mean, median, stdev, percentile, histogram, correlation.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["summary", "percentile", "histogram", "correlation", "normalize", "outliers"], description: "Stats operation" },
      data: { type: "string", description: "JSON array of numbers, or comma/newline separated values" },
      data2: { type: "string", description: "Second dataset (for correlation)" },
      percentile: { type: "number", minimum: 0, maximum: 100, description: "Percentile value (for percentile operation)" },
      bins: { type: "integer", minimum: 2, maximum: 100, description: "Number of bins (for histogram, default: 10)" },
      threshold: { type: "number", description: "Z-score threshold for outlier detection (default: 2)" },
    },
    required: ["operation", "data"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "summary");
    const data = this.parse_numbers(String(params.data || ""));
    if (data.length === 0) return "Error: no valid numeric data";
    if (data.length > MAX_DATA_POINTS) return `Error: data exceeds ${MAX_DATA_POINTS} points`;

    switch (op) {
      case "summary": return this.summary(data);
      case "percentile": return this.percentile(data, Number(params.percentile ?? 50));
      case "histogram": return this.histogram(data, Number(params.bins || 10));
      case "correlation": {
        const data2 = this.parse_numbers(String(params.data2 || ""));
        if (data2.length === 0) return "Error: data2 is required for correlation";
        return this.correlation(data, data2);
      }
      case "normalize": return this.normalize(data);
      case "outliers": return this.outliers(data, Number(params.threshold || 2));
      default: return `Error: unsupported operation "${op}"`;
    }
  }

  private parse_numbers(input: string): number[] {
    let items: string[];
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) items = parsed.map(String);
      else items = input.split(/[,\n\r\t]+/);
    } catch {
      items = input.split(/[,\n\r\t]+/);
    }
    return items.map((s) => Number(s.trim())).filter((n) => !isNaN(n) && isFinite(n));
  }

  private summary(data: number[]): string {
    const sorted = [...data].sort((a, b) => a - b);
    const n = data.length;
    const sum = data.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const variance = data.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const stdev = Math.sqrt(variance);
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
    const q1 = this.calc_percentile(sorted, 25);
    const q3 = this.calc_percentile(sorted, 75);

    return JSON.stringify({
      count: n,
      sum: this.round(sum),
      mean: this.round(mean),
      median: this.round(median),
      stdev: this.round(stdev),
      variance: this.round(variance),
      min: sorted[0],
      max: sorted[n - 1],
      range: this.round(sorted[n - 1] - sorted[0]),
      q1: this.round(q1),
      q3: this.round(q3),
      iqr: this.round(q3 - q1),
    }, null, 2);
  }

  private percentile(data: number[], p: number): string {
    const sorted = [...data].sort((a, b) => a - b);
    const value = this.calc_percentile(sorted, p);
    return JSON.stringify({ percentile: p, value: this.round(value), count: data.length });
  }

  private calc_percentile(sorted: number[], p: number): number {
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  }

  private histogram(data: number[], bins: number): string {
    const min = Math.min(...data);
    const max = Math.max(...data);
    if (min === max) return JSON.stringify({ bins: [{ range: `${min}`, count: data.length }] });
    const width = (max - min) / bins;
    const counts = new Array(bins).fill(0);
    for (const v of data) {
      const idx = Math.min(Math.floor((v - min) / width), bins - 1);
      counts[idx]++;
    }
    const result = counts.map((count, i) => ({
      range: `${this.round(min + i * width)} - ${this.round(min + (i + 1) * width)}`,
      count,
      pct: `${this.round((count / data.length) * 100)}%`,
    }));
    return JSON.stringify({ bins: result, total: data.length }, null, 2);
  }

  private correlation(x: number[], y: number[]): string {
    const n = Math.min(x.length, y.length);
    const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const xi = x[i] - mx;
      const yi = y[i] - my;
      num += xi * yi;
      dx += xi * xi;
      dy += yi * yi;
    }
    const denom = Math.sqrt(dx * dy);
    const r = denom === 0 ? 0 : num / denom;
    return JSON.stringify({
      pearson_r: this.round(r),
      r_squared: this.round(r * r),
      n,
      strength: Math.abs(r) > 0.7 ? "strong" : Math.abs(r) > 0.3 ? "moderate" : "weak",
      direction: r > 0 ? "positive" : r < 0 ? "negative" : "none",
    }, null, 2);
  }

  private normalize(data: number[]): string {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;
    if (range === 0) return JSON.stringify(data.map(() => 0));
    return JSON.stringify(data.map((v) => this.round((v - min) / range)));
  }

  private outliers(data: number[], threshold: number): string {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const stdev = Math.sqrt(data.reduce((a, b) => a + (b - mean) ** 2, 0) / data.length);
    if (stdev === 0) return JSON.stringify({ outliers: [], count: 0 });
    const found = data
      .map((v, i) => ({ value: v, index: i, z_score: this.round((v - mean) / stdev) }))
      .filter((e) => Math.abs(e.z_score) > threshold);
    return JSON.stringify({ outliers: found, count: found.length, threshold, mean: this.round(mean), stdev: this.round(stdev) }, null, 2);
  }

  private round(n: number, decimals = 6): number {
    const factor = 10 ** decimals;
    return Math.round(n * factor) / factor;
  }
}
