/**
 * CsvTool — 미커버 분기 (cov):
 * - L43: parse_csv → rows.length === 0 → { rows: [], count: 0 } 반환
 *
 * split_rows는 빈 문자열에도 [[""]](길이 1)을 반환하므로 실제로는 dead code.
 * split_rows를 stub하여 [] 반환 → L43 커버.
 */
import { describe, it, expect } from "vitest";
import { CsvTool } from "@src/agent/tools/csv.js";

// ── L43: rows.length === 0 → { rows: [], count: 0 } ──────────────────────────

describe("CsvTool — L43: split_rows=[] → { rows:[], count:0 }", () => {
  it("split_rows stub → [] 반환 → L43: JSON { rows:[], count:0 }", async () => {
    const tool = new CsvTool();
    // split_rows를 빈 배열 반환으로 교체 → parse_csv L43 커버
    (tool as any).split_rows = () => [];

    const result = JSON.parse(await (tool as any).parse_csv("", ",", '"', true));
    expect(result.rows).toEqual([]);
    expect(result.count).toBe(0);
  });
});
