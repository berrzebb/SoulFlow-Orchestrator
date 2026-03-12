/**
 * 다양한 도구 미커버 분기 (misc-cov).
 * - tree.ts:106,126 — unknown action default, parse_tree catch
 * - validator.ts:45 — default unsupported op
 * - validator.ts:148 — validate_rules 미구현 분기 (위쪽 커버)
 * - base.ts:26,27 — Tool.execute approval trigger 분기
 */
import { describe, it, expect, vi } from "vitest";
import { TreeTool } from "@src/agent/tools/tree.js";
import { ValidatorTool } from "@src/agent/tools/validator.js";

// ── 헬퍼 ────────────────────────────────────────────────────────────────

async function exec(tool: { execute: (p: any) => Promise<unknown> }, params: Record<string, unknown>): Promise<any> {
  const r = await tool.execute(params);
  try { return JSON.parse(String(r)); } catch { return r; }
}

// ── tree.ts:106 — unknown action default ──────────────────────────────

describe("TreeTool — unknown action → error (L106)", () => {
  const SIMPLE_TREE = JSON.stringify({
    id: "root",
    value: 1,
    children: [
      { id: "a", value: 2, children: [] },
      { id: "b", value: 3, children: [] },
    ],
  });

  it("unknown action → error 반환", async () => {
    const tool = new TreeTool();
    const r = await exec(tool, { action: "nonexistent", tree: SIMPLE_TREE });
    expect(r.error).toContain("unknown action");
  });
});

// ── tree.ts:126 — parse_tree catch ────────────────────────────────────

describe("TreeTool — parse_tree: 잘못된 JSON → catch → null → 에러", () => {
  it("잘못된 JSON 트리 → invalid tree JSON 에러", async () => {
    const tool = new TreeTool();
    const r = await exec(tool, { action: "traverse", tree: "{{invalid json{{" });
    expect(r.error).toContain("invalid tree JSON");
  });
});

// ── validator.ts:45 — default unsupported op ──────────────────────────

describe("ValidatorTool — unsupported operation → error (L45)", () => {
  it("op='unknown' → Error 반환", async () => {
    const tool = new ValidatorTool();
    const r = String(await tool.execute({ operation: "unknown_op", input: "{}" }));
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});

// ── validator.ts:148,150 — validate_rules min/max 경계 ───────────────

describe("ValidatorTool — validate_rules min/max 경계 (L148, L150)", () => {
  it("rule.min 위반 → errors 반환", async () => {
    const tool = new ValidatorTool();
    // field 기반 방식 ($.path 아님)
    const rules = JSON.stringify([{ field: "age", type: "number", min: 18 }]);
    const r = await exec(tool, { operation: "rules", input: JSON.stringify({ age: 10 }), rules });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].message).toContain("minimum");
  });

  it("rule.max 위반 → errors 반환", async () => {
    const tool = new ValidatorTool();
    const rules = JSON.stringify([{ field: "score", type: "number", max: 100 }]);
    const r = await exec(tool, { operation: "rules", input: JSON.stringify({ score: 150 }), rules });
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toContain("maximum");
  });
});
