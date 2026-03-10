/**
 * MatrixTool — 미커버 분기 보충.
 * transpose/inverse/det/add/subtract/scalar/solve/trace invalid 입력,
 * subtract dimension mismatch, solve non-square, det 1x1 재귀.
 */
import { describe, it, expect } from "vitest";
import { MatrixTool } from "../../../src/agent/tools/matrix.js";

const tool = new MatrixTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const raw = await tool.execute(params);
  try { return JSON.parse(String(raw)); } catch { return raw; }
}

const INVALID = '"not-a-matrix"';  // 비배열 JSON → parse_matrix null

describe("MatrixTool — invalid matrix 입력 분기", () => {
  it("transpose: invalid a → error (L39)", async () => {
    const r = await exec({ action: "transpose", a: INVALID }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("inverse: invalid a → error (L45)", async () => {
    const r = await exec({ action: "inverse", a: INVALID }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("determinant: invalid a → error (L54)", async () => {
    const r = await exec({ action: "determinant", a: INVALID }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("add: invalid a → error (L61)", async () => {
    const r = await exec({ action: "add", a: INVALID, b: "[[1,0],[0,1]]" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("subtract: invalid a → error (L69)", async () => {
    const r = await exec({ action: "subtract", a: INVALID, b: "[[1,0],[0,1]]" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("subtract: dimension mismatch → error (L70)", async () => {
    const r = await exec({ action: "subtract", a: "[[1,2],[3,4]]", b: "[[1,2,3]]" }) as Record<string, unknown>;
    expect(r.error).toContain("dimension mismatch");
  });

  it("scalar: invalid a → error (L76)", async () => {
    const r = await exec({ action: "scalar", a: INVALID, scalar: 2 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("solve: invalid a → error (L84)", async () => {
    const r = await exec({ action: "solve", a: INVALID, b: "[[1],[2]]" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("solve: non-square coefficient matrix → error (L86)", async () => {
    // 2x3 행렬 → a[0].length(3) !== n(2) → error
    const r = await exec({ action: "solve", a: "[[1,2,3],[4,5,6]]", b: "[[1],[2]]" }) as Record<string, unknown>;
    expect(r.error).toContain("square");
  });

  it("trace: invalid a → error (L113)", async () => {
    const r = await exec({ action: "trace", a: INVALID }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("MatrixTool — parse_matrix 분기 (L126)", () => {
  it("빈 배열 [] → parse_matrix null → error", async () => {
    // m.length === 0 → L126 null 반환
    const r = await exec({ action: "transpose", a: "[]" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("MatrixTool — det 1x1 재귀 (L147)", () => {
  it("3x3 determinant → 재귀적으로 1x1 sub-matrix det 호출", async () => {
    // 3x3 det → L152 재귀 → 2x2 → L148, 그 후 1x1 경우도 호출될 수 있음
    // 확실히 1x1 경로 커버: 1x1 행렬 직접 사용
    const r = await exec({ action: "determinant", a: "[[42]]" }) as Record<string, unknown>;
    expect(r.determinant).toBe(42);
  });

  it("3x3 determinant → 내부 1x1 sub-det 호출 (L147 재귀 경유)", async () => {
    const r = await exec({ action: "determinant", a: "[[1,2,3],[4,5,6],[7,8,10]]" }) as Record<string, unknown>;
    expect(typeof r.determinant).toBe("number");
  });
});
