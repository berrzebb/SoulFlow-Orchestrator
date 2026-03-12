/**
 * stats_handler — 미커버 분기 (cov2):
 * - L47: TimeseriesTool.execute throws → catch → { result: error_message, success: false }
 */
import { describe, it, expect, vi } from "vitest";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

function make_ctx(): OrcheNodeExecutorContext {
  return { memory: {} };
}

// ── L47: TimeseriesTool catch ─────────────────────────────────────────────────

describe("stats_handler — L47: TimeseriesTool throw → catch 분기", () => {
  it("TimeseriesTool.execute throws → catch → success=false (L47)", async () => {
    // TimeseriesTool을 throw하도록 모킹
    vi.mock("@src/agent/tools/timeseries.js", () => ({
      TimeseriesTool: class {
        async execute() { throw new Error("forced timeseries error"); }
      },
    }));

    // 모킹 후 stats_handler를 동적으로 import (캐시 무효화 위해)
    const { stats_handler } = await import("@src/agent/nodes/stats.js");

    const node = {
      node_id: "n1",
      node_type: "stats",
      operation: "moving_average",  // TIMESERIES_OPS 목록에 포함
      data: "1,2,3",
    } as any;
    const result = await stats_handler.execute(node, make_ctx());
    expect(result.output.success).toBe(false);
    expect(typeof result.output.result).toBe("string");
  });
});
