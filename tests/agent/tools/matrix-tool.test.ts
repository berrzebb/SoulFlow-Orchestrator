/**
 * MatrixTool — 행렬 연산 (곱셈/전치/역행렬/행렬식/덧셈/스칼라/연립방정식) 테스트.
 */
import { describe, it, expect } from "vitest";
import { MatrixTool } from "../../../src/agent/tools/matrix.js";

const tool = new MatrixTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const A2x2 = JSON.stringify([[1, 2], [3, 4]]);
const B2x2 = JSON.stringify([[5, 6], [7, 8]]);
const A2x3 = JSON.stringify([[1, 2, 3], [4, 5, 6]]);
const B3x2 = JSON.stringify([[7, 8], [9, 10], [11, 12]]);

describe("MatrixTool — multiply", () => {
  it("2x2 행렬 곱셈", async () => {
    const r = await exec({ action: "multiply", a: A2x2, b: B2x2 }) as Record<string, unknown>;
    const m = r.matrix as number[][];
    // [1*5+2*7, 1*6+2*8] = [19, 22]
    expect(m[0][0]).toBe(19);
    expect(m[0][1]).toBe(22);
    expect(m[1][0]).toBe(43);
    expect(m[1][1]).toBe(50);
  });

  it("2x3 * 3x2 → 2x2", async () => {
    const r = await exec({ action: "multiply", a: A2x3, b: B3x2 }) as Record<string, unknown>;
    expect(r.rows).toBe(2);
    expect(r.cols).toBe(2);
  });

  it("차원 불일치 → error", async () => {
    // A2x3 (cols=3) * A2x2 (rows=2) → 3 != 2, 불일치
    const r = await exec({ action: "multiply", a: A2x3, b: A2x2 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("잘못된 행렬 JSON → error", async () => {
    const r = await exec({ action: "multiply", a: "bad", b: A2x2 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("MatrixTool — transpose", () => {
  it("2x2 전치", async () => {
    const r = await exec({ action: "transpose", a: A2x2 }) as Record<string, unknown>;
    const m = r.matrix as number[][];
    expect(m[0][1]).toBe(3); // [0][1] = original [1][0]
    expect(m[1][0]).toBe(2); // [1][0] = original [0][1]
  });

  it("2x3 전치 → 3x2", async () => {
    const r = await exec({ action: "transpose", a: A2x3 }) as Record<string, unknown>;
    expect(r.rows).toBe(3);
    expect(r.cols).toBe(2);
  });
});

describe("MatrixTool — determinant", () => {
  it("2x2 행렬식 (ad-bc = 1*4-2*3 = -2)", async () => {
    const r = await exec({ action: "determinant", a: A2x2 }) as Record<string, unknown>;
    expect(r.determinant).toBe(-2);
  });

  it("단위 행렬 det = 1", async () => {
    const identity = JSON.stringify([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const r = await exec({ action: "determinant", a: identity }) as Record<string, unknown>;
    expect(r.determinant).toBe(1);
  });

  it("비정방 행렬 → error", async () => {
    const r = await exec({ action: "determinant", a: A2x3 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("MatrixTool — inverse", () => {
  it("2x2 역행렬", async () => {
    const r = await exec({ action: "inverse", a: A2x2 }) as Record<string, unknown>;
    const m = r.matrix as number[][];
    // A = [[1,2],[3,4]], A^-1 = [[-2, 1],[1.5, -0.5]]
    expect(Math.round(m[0][0])).toBe(-2);
    expect(m[1][0]).toBeCloseTo(1.5);
  });

  it("특이 행렬 (det=0) → error", async () => {
    const singular = JSON.stringify([[1, 2], [2, 4]]); // rows are proportional
    const r = await exec({ action: "inverse", a: singular }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("비정방 행렬 → error", async () => {
    const r = await exec({ action: "inverse", a: A2x3 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("MatrixTool — add / subtract", () => {
  it("행렬 덧셈", async () => {
    const r = await exec({ action: "add", a: A2x2, b: B2x2 }) as Record<string, unknown>;
    const m = r.matrix as number[][];
    expect(m[0][0]).toBe(6); // 1+5
    expect(m[1][1]).toBe(12); // 4+8
  });

  it("행렬 뺄셈", async () => {
    const r = await exec({ action: "subtract", a: B2x2, b: A2x2 }) as Record<string, unknown>;
    const m = r.matrix as number[][];
    expect(m[0][0]).toBe(4); // 5-1
  });

  it("차원 불일치 → error", async () => {
    const r = await exec({ action: "add", a: A2x2, b: A2x3 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("MatrixTool — scalar", () => {
  it("스칼라 곱", async () => {
    const r = await exec({ action: "scalar", a: A2x2, scalar: 3 }) as Record<string, unknown>;
    const m = r.matrix as number[][];
    expect(m[0][0]).toBe(3); // 1*3
    expect(m[1][1]).toBe(12); // 4*3
  });
});

describe("MatrixTool — solve", () => {
  it("연립방정식 풀기 (x+y=3, 2x+y=5 → x=2, y=1)", async () => {
    const a = JSON.stringify([[1, 1], [2, 1]]);
    const b = JSON.stringify([[3], [5]]);
    const r = await exec({ action: "solve", a, b }) as Record<string, unknown>;
    const solution = r.solution as number[];
    expect(solution[0]).toBeCloseTo(2);
    expect(solution[1]).toBeCloseTo(1);
  });

  it("특이 행렬 → no unique solution", async () => {
    const a = JSON.stringify([[1, 1], [1, 1]]);
    const b = JSON.stringify([[2], [2]]);
    const r = await exec({ action: "solve", a, b }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("MatrixTool — identity", () => {
  it("3x3 단위 행렬 생성", async () => {
    const r = await exec({ action: "identity", size: 3 }) as Record<string, unknown>;
    expect(r.size).toBe(3);
    const m = r.matrix as number[][];
    expect(m[0][0]).toBe(1);
    expect(m[0][1]).toBe(0);
    expect(m[1][1]).toBe(1);
  });
});

describe("MatrixTool — trace", () => {
  it("2x2 대각합 (1+4=5)", async () => {
    const r = await exec({ action: "trace", a: A2x2 }) as Record<string, unknown>;
    expect(r.trace).toBe(5);
  });

  it("비정방 행렬 → error", async () => {
    const r = await exec({ action: "trace", a: A2x3 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("MatrixTool — 에러 처리", () => {
  it("미지원 action → error", async () => {
    const r = await exec({ action: "unknown", a: A2x2 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});
