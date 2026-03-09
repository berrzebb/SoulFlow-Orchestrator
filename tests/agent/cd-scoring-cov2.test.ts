/**
 * cd-scoring.ts — 미커버 분기 보충 (cov2).
 * L80: error event + "rollback" 포함 → redo cd_event 발생
 */
import { describe, it, expect } from "vitest";
import { create_cd_observer } from "@src/agent/cd-scoring.js";

const source = { backend: "claude_sdk" as const };
const at = new Date().toISOString();

describe("create_cd_observer — redo (L80)", () => {
  it("error 이벤트 + 'rollback' 포함 → redo cd_event 반환 (L80)", () => {
    const cd = create_cd_observer();
    const result = cd.observe({
      type: "error",
      source,
      at,
      error: "rollback: transaction failed, retrying...",
    });
    expect(result).not.toBeNull();
    expect(result!.indicator).toBe("redo");
    expect(cd.get_score().total).toBeGreaterThan(0);
  });

  it("error 이벤트에 'rollback' 없으면 null 반환", () => {
    const cd = create_cd_observer();
    const result = cd.observe({
      type: "error",
      source,
      at,
      error: "timeout occurred",
    });
    expect(result).toBeNull();
  });
});
