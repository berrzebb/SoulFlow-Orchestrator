/**
 * DiffTool — 미커버 분기 (cov4):
 * - L164: lcs_indices_greedy — if (arr) arr.push(idx) (중복 라인의 두 번째 이상 출현)
 *   → b 배열에 중복 라인이 있어야 발생 (max_len > 5000 시 greedy 경로)
 */

import { describe, it, expect } from "vitest";
import { DiffTool } from "@src/agent/tools/diff.js";

const tool = new DiffTool();

// ── L164: arr.push(idx) — b 배열에 중복 라인 포함 ─────────────────────────────

describe("DiffTool — L164: arr.push(idx) (중복 라인, greedy 경로)", () => {
  it("b 배열에 중복 라인 포함 → greedy에서 arr.push(idx) (L164 if 분기) 실행", async () => {
    // a: 5001개 고유 라인 (greedy threshold = 5000 초과)
    const lines_a = Array.from({ length: 5001 }, (_, i) => `aline_${i}`);
    // b: 5001개 라인 중 첫 두 항목을 같은 값으로 설정 → 두 번째 "dup"에서 arr.push(idx) 발동
    const lines_b: string[] = ["dup", "dup", ...Array.from({ length: 4999 }, (_, i) => `bline_${i}`)];

    // lcs_indices_greedy: b_map 구성 시
    // idx=0: arr=undefined → else b_map.set("dup", [0])
    // idx=1: arr=[0]      → if(arr) arr.push(1) → L164 if 분기 ✓
    const r = await tool.execute({
      operation: "compare",
      old_text: lines_a.join("\n"),
      new_text: lines_b.join("\n"),
    });

    expect(r).toContain("---");
    expect(r).toContain("+++");
  }, 30000);
});
