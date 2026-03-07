/** Timeseries 도구 — 시계열 분석 (이동평균/EMA/예측/이상 감지). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class TimeseriesTool extends Tool {
  readonly name = "timeseries";
  readonly category = "data" as const;
  readonly description = "Time series analysis: moving_average, ema, linear_forecast, anomaly, diff, resample, autocorrelation.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["moving_average", "ema", "linear_forecast", "anomaly", "diff", "cumsum", "normalize", "autocorrelation"], description: "Operation" },
      data: { type: "string", description: "JSON array of numbers" },
      window: { type: "number", description: "Window size (default: 3)" },
      alpha: { type: "number", description: "EMA smoothing factor (0-1, default: 0.3)" },
      periods: { type: "number", description: "Forecast periods (default: 5)" },
      threshold: { type: "number", description: "Anomaly threshold in std devs (default: 2)" },
      lag: { type: "number", description: "Autocorrelation lag (default: 1)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "moving_average");
    let data: number[];
    try { data = JSON.parse(String(params.data || "[]")); } catch { return JSON.stringify({ error: "invalid data JSON" }); }
    if (!Array.isArray(data) || data.length === 0) return JSON.stringify({ error: "empty data array" });

    switch (action) {
      case "moving_average": {
        const w = Number(params.window) || 3;
        const result: (number | null)[] = [];
        for (let i = 0; i < data.length; i++) {
          if (i < w - 1) { result.push(null); continue; }
          let sum = 0;
          for (let j = 0; j < w; j++) sum += data[i - j];
          result.push(Math.round((sum / w) * 1e6) / 1e6);
        }
        return JSON.stringify({ window: w, result });
      }
      case "ema": {
        const alpha = Number(params.alpha) || 0.3;
        const result: number[] = [data[0]];
        for (let i = 1; i < data.length; i++) {
          result.push(Math.round((alpha * data[i] + (1 - alpha) * result[i - 1]) * 1e6) / 1e6);
        }
        return JSON.stringify({ alpha, result });
      }
      case "linear_forecast": {
        const periods = Number(params.periods) || 5;
        const n = data.length;
        let sum_x = 0, sum_y = 0, sum_xy = 0, sum_xx = 0;
        for (let i = 0; i < n; i++) {
          sum_x += i; sum_y += data[i]; sum_xy += i * data[i]; sum_xx += i * i;
        }
        const slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x);
        const intercept = (sum_y - slope * sum_x) / n;
        const forecast: number[] = [];
        for (let i = 0; i < periods; i++) {
          forecast.push(Math.round((slope * (n + i) + intercept) * 1e6) / 1e6);
        }
        return JSON.stringify({ slope: Math.round(slope * 1e6) / 1e6, intercept: Math.round(intercept * 1e6) / 1e6, forecast });
      }
      case "anomaly": {
        const threshold = Number(params.threshold) || 2;
        const mean = data.reduce((s, v) => s + v, 0) / data.length;
        const std = Math.sqrt(data.reduce((s, v) => s + (v - mean) ** 2, 0) / data.length);
        const anomalies = data.map((v, i) => ({
          index: i, value: v, z_score: std > 0 ? Math.round(((v - mean) / std) * 1e4) / 1e4 : 0,
          is_anomaly: std > 0 && Math.abs((v - mean) / std) > threshold,
        })).filter((a) => a.is_anomaly);
        return JSON.stringify({ mean: Math.round(mean * 1e6) / 1e6, std: Math.round(std * 1e6) / 1e6, threshold, anomaly_count: anomalies.length, anomalies });
      }
      case "diff": {
        const result = data.slice(1).map((v, i) => Math.round((v - data[i]) * 1e6) / 1e6);
        return JSON.stringify({ result });
      }
      case "cumsum": {
        let sum = 0;
        const result = data.map((v) => { sum += v; return Math.round(sum * 1e6) / 1e6; });
        return JSON.stringify({ result });
      }
      case "normalize": {
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min;
        const result = range === 0 ? data.map(() => 0) : data.map((v) => Math.round(((v - min) / range) * 1e6) / 1e6);
        return JSON.stringify({ min, max, result });
      }
      case "autocorrelation": {
        const lag = Number(params.lag) || 1;
        const mean = data.reduce((s, v) => s + v, 0) / data.length;
        let num = 0, den = 0;
        for (let i = 0; i < data.length; i++) {
          den += (data[i] - mean) ** 2;
          if (i >= lag) num += (data[i] - mean) * (data[i - lag] - mean);
        }
        const acf = den > 0 ? Math.round((num / den) * 1e6) / 1e6 : 0;
        return JSON.stringify({ lag, autocorrelation: acf });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }
}
