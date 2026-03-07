/** CircuitBreaker 도구 — 서킷 브레이커 패턴 (closed/open/half-open). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface BreakerState {
  name: string;
  state: "closed" | "open" | "half_open";
  failure_count: number;
  success_count: number;
  last_failure_at?: number;
  last_success_at?: number;
  threshold: number;
  reset_timeout_ms: number;
  half_open_max: number;
}

const breakers = new Map<string, BreakerState>();

export class CircuitBreakerTool extends Tool {
  readonly name = "circuit_breaker";
  readonly category = "data" as const;
  readonly description = "Circuit breaker pattern: create, record_success, record_failure, get_state, reset, stats, config.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "record_success", "record_failure", "get_state", "reset", "stats", "config"], description: "Operation" },
      name: { type: "string", description: "Breaker name" },
      threshold: { type: "number", description: "Failure threshold (default: 5)" },
      reset_timeout_ms: { type: "number", description: "Reset timeout in ms (default: 30000)" },
      half_open_max: { type: "number", description: "Max requests in half-open (default: 1)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "get_state");
    const name = String(params.name || "default");

    switch (action) {
      case "create": {
        const state: BreakerState = {
          name,
          state: "closed",
          failure_count: 0,
          success_count: 0,
          threshold: Number(params.threshold) || 5,
          reset_timeout_ms: Number(params.reset_timeout_ms) || 30000,
          half_open_max: Number(params.half_open_max) || 1,
        };
        breakers.set(name, state);
        return JSON.stringify({ created: true, ...state });
      }
      case "record_success": {
        const b = this.get_or_create(name);
        b.success_count++;
        b.last_success_at = Date.now();
        if (b.state === "half_open") {
          b.state = "closed";
          b.failure_count = 0;
        }
        return JSON.stringify({ name, state: b.state, success_count: b.success_count });
      }
      case "record_failure": {
        const b = this.get_or_create(name);
        b.failure_count++;
        b.last_failure_at = Date.now();
        if (b.state === "half_open") {
          b.state = "open";
        } else if (b.state === "closed" && b.failure_count >= b.threshold) {
          b.state = "open";
        }
        return JSON.stringify({ name, state: b.state, failure_count: b.failure_count, tripped: b.state === "open" });
      }
      case "get_state": {
        const b = breakers.get(name);
        if (!b) return JSON.stringify({ name, state: "not_found" });
        // 자동 half-open 전이 체크
        if (b.state === "open" && b.last_failure_at) {
          const elapsed = Date.now() - b.last_failure_at;
          if (elapsed >= b.reset_timeout_ms) b.state = "half_open";
        }
        const can_request = b.state === "closed" || b.state === "half_open";
        return JSON.stringify({ name, state: b.state, can_request, failure_count: b.failure_count, success_count: b.success_count });
      }
      case "reset": {
        const b = breakers.get(name);
        if (!b) return JSON.stringify({ name, error: "not found" });
        b.state = "closed";
        b.failure_count = 0;
        b.success_count = 0;
        b.last_failure_at = undefined;
        b.last_success_at = undefined;
        return JSON.stringify({ name, state: "closed", reset: true });
      }
      case "stats": {
        if (name === "all" || name === "default") {
          const all = [...breakers.values()].map((b) => ({
            name: b.name, state: b.state, failures: b.failure_count, successes: b.success_count,
          }));
          return JSON.stringify({ count: all.length, breakers: all });
        }
        const b = breakers.get(name);
        if (!b) return JSON.stringify({ name, error: "not found" });
        const uptime_ratio = (b.success_count + b.failure_count) > 0
          ? Math.round((b.success_count / (b.success_count + b.failure_count)) * 10000) / 100
          : 100;
        return JSON.stringify({ name, state: b.state, failure_count: b.failure_count, success_count: b.success_count, uptime_percent: uptime_ratio, threshold: b.threshold, reset_timeout_ms: b.reset_timeout_ms });
      }
      case "config": {
        const b = this.get_or_create(name);
        if (params.threshold) b.threshold = Number(params.threshold);
        if (params.reset_timeout_ms) b.reset_timeout_ms = Number(params.reset_timeout_ms);
        if (params.half_open_max) b.half_open_max = Number(params.half_open_max);
        return JSON.stringify({ name, threshold: b.threshold, reset_timeout_ms: b.reset_timeout_ms, half_open_max: b.half_open_max });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private get_or_create(name: string): BreakerState {
    let b = breakers.get(name);
    if (!b) {
      b = { name, state: "closed", failure_count: 0, success_count: 0, threshold: 5, reset_timeout_ms: 30000, half_open_max: 1 };
      breakers.set(name, b);
    }
    return b;
  }
}
