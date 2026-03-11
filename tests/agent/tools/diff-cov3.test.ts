/**
 * DiffTool — 미커버 분기 (cov3):
 * - L164: lcs_indices_greedy — else b_map.set(line, [idx]) (첫 번째 고유 라인)
 *   → max_len > 5000 일 때 greedy 경로로 진입
 */

import { describe, it, expect } from "vitest";
import { DiffTool } from "@src/agent/tools/diff.js";

const tool = new DiffTool();

// ── L164: lcs_indices_greedy — max_len > 5000 → greedy 경로 ──────────────────

describe("DiffTool — L164: lcs_indices_greedy else 분기 (5001+ 라인)", () => {
  it("5001개 라인 텍스트 비교 → greedy 경로 → L164 else b_map.set 실행", async () => {
    // 5001 라인 생성 (greedy threshold = 5000)
    const lines_a = Array.from({ length: 5001 }, (_, i) => `line_${i}`);
    const lines_b = Array.from({ length: 5001 }, (_, i) =>
      i === 2500 ? `line_modified_${i}` : `line_${i}`,
    );

    const old_text = lines_a.join("\n");
    const new_text = lines_b.join("\n");

    // old_text !== new_text → compute_diff_hunks → lcs_indices(5001, 5001)
    // max_len = min(5001, 5001) = 5001 > 5000 → lcs_indices_greedy 호출
    // b_map 구성 시: for 첫 번째 unique line → b_map.get(line) = undefined → L164 else fires
    const r = await tool.execute({ operation: "compare", old_text, new_text });

    expect(r).toContain("---");
    expect(r).toContain("+++");
    // 수정된 라인이 diff에 포함됨
    expect(r).toContain("line_modified_2500");
  }, 30000); // 5001라인 처리 시간을 위해 30초 타임아웃
});
