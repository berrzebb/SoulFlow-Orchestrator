/** Matrix 도구 — 행렬 연산 (곱셈/전치/역행렬/행렬식/연립방정식). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

type Matrix = number[][];

export class MatrixTool extends Tool {
  readonly name = "matrix";
  readonly category = "data" as const;
  readonly description = "Matrix operations: multiply, transpose, inverse, determinant, add, scalar, solve, identity, trace.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["multiply", "transpose", "inverse", "determinant", "add", "subtract", "scalar", "solve", "identity", "trace"], description: "Operation" },
      a: { type: "string", description: "Matrix A as JSON 2D array" },
      b: { type: "string", description: "Matrix B (multiply/add/subtract)" },
      scalar: { type: "number", description: "Scalar value" },
      size: { type: "number", description: "Size for identity matrix" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "multiply");

    switch (action) {
      case "multiply": {
        const a = this.parse_matrix(params.a);
        const b = this.parse_matrix(params.b);
        if (!a || !b) return JSON.stringify({ error: "invalid matrix JSON" });
        if (a[0].length !== b.length) return JSON.stringify({ error: `incompatible dimensions: ${a.length}x${a[0].length} * ${b.length}x${b[0].length}` });
        const result = this.mul(a, b);
        return JSON.stringify({ rows: result.length, cols: result[0].length, matrix: result });
      }
      case "transpose": {
        const a = this.parse_matrix(params.a);
        if (!a) return JSON.stringify({ error: "invalid matrix JSON" });
        const result = this.trans(a);
        return JSON.stringify({ rows: result.length, cols: result[0].length, matrix: result });
      }
      case "inverse": {
        const a = this.parse_matrix(params.a);
        if (!a) return JSON.stringify({ error: "invalid matrix JSON" });
        if (a.length !== a[0].length) return JSON.stringify({ error: "matrix must be square" });
        const det = this.det(a);
        if (Math.abs(det) < 1e-10) return JSON.stringify({ error: "singular matrix (determinant ≈ 0)" });
        const result = this.inv(a);
        return JSON.stringify({ determinant: det, matrix: result });
      }
      case "determinant": {
        const a = this.parse_matrix(params.a);
        if (!a) return JSON.stringify({ error: "invalid matrix JSON" });
        if (a.length !== a[0].length) return JSON.stringify({ error: "matrix must be square" });
        return JSON.stringify({ size: a.length, determinant: this.det(a) });
      }
      case "add": {
        const a = this.parse_matrix(params.a);
        const b = this.parse_matrix(params.b);
        if (!a || !b) return JSON.stringify({ error: "invalid matrix JSON" });
        if (a.length !== b.length || a[0].length !== b[0].length) return JSON.stringify({ error: "dimension mismatch" });
        const result = a.map((row, i) => row.map((v, j) => v + b[i][j]));
        return JSON.stringify({ matrix: result });
      }
      case "subtract": {
        const a = this.parse_matrix(params.a);
        const b = this.parse_matrix(params.b);
        if (!a || !b) return JSON.stringify({ error: "invalid matrix JSON" });
        if (a.length !== b.length || a[0].length !== b[0].length) return JSON.stringify({ error: "dimension mismatch" });
        const result = a.map((row, i) => row.map((v, j) => v - b[i][j]));
        return JSON.stringify({ matrix: result });
      }
      case "scalar": {
        const a = this.parse_matrix(params.a);
        if (!a) return JSON.stringify({ error: "invalid matrix JSON" });
        const s = Number(params.scalar ?? 1);
        const result = a.map((row) => row.map((v) => v * s));
        return JSON.stringify({ scalar: s, matrix: result });
      }
      case "solve": {
        const a = this.parse_matrix(params.a);
        const b_vec = this.parse_matrix(params.b);
        if (!a || !b_vec) return JSON.stringify({ error: "invalid matrix JSON" });
        const n = a.length;
        if (a[0].length !== n) return JSON.stringify({ error: "coefficient matrix must be square" });
        const aug: Matrix = a.map((row, i) => [...row, b_vec[i][0]]);
        for (let col = 0; col < n; col++) {
          let max_row = col;
          for (let r = col + 1; r < n; r++) {
            if (Math.abs(aug[r][col]) > Math.abs(aug[max_row][col])) max_row = r;
          }
          [aug[col], aug[max_row]] = [aug[max_row], aug[col]];
          if (Math.abs(aug[col][col]) < 1e-10) return JSON.stringify({ error: "no unique solution" });
          const pivot = aug[col][col];
          for (let j = col; j <= n; j++) aug[col][j] /= pivot;
          for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const factor = aug[r][col];
            for (let j = col; j <= n; j++) aug[r][j] -= factor * aug[col][j];
          }
        }
        const solution = aug.map((row) => Math.round(row[n] * 1e10) / 1e10);
        return JSON.stringify({ solution });
      }
      case "identity": {
        const n = Number(params.size) || 3;
        const result = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
        return JSON.stringify({ size: n, matrix: result });
      }
      case "trace": {
        const a = this.parse_matrix(params.a);
        if (!a) return JSON.stringify({ error: "invalid matrix JSON" });
        if (a.length !== a[0].length) return JSON.stringify({ error: "matrix must be square" });
        const trace = a.reduce((sum, row, i) => sum + row[i], 0);
        return JSON.stringify({ trace });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_matrix(val: unknown): Matrix | null {
    try {
      const m = JSON.parse(String(val || "[]"));
      if (!Array.isArray(m) || m.length === 0) return null;
      return m as Matrix;
    } catch { return null; }
  }

  private mul(a: Matrix, b: Matrix): Matrix {
    const rows = a.length, cols = b[0].length, n = b.length;
    const result: Matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++)
        for (let k = 0; k < n; k++)
          result[i][j] += a[i][k] * b[k][j];
    return result;
  }

  private trans(a: Matrix): Matrix {
    return a[0].map((_, j) => a.map((row) => row[j]));
  }

  private det(m: Matrix): number {
    const n = m.length;
    if (n === 1) return m[0][0];
    if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
    let d = 0;
    for (let j = 0; j < n; j++) {
      const sub = m.slice(1).map((row) => [...row.slice(0, j), ...row.slice(j + 1)]);
      d += (j % 2 === 0 ? 1 : -1) * m[0][j] * this.det(sub);
    }
    return d;
  }

  private inv(m: Matrix): Matrix {
    const n = m.length;
    const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
    for (let col = 0; col < n; col++) {
      let max_row = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(aug[r][col]) > Math.abs(aug[max_row][col])) max_row = r;
      }
      [aug[col], aug[max_row]] = [aug[max_row], aug[col]];
      const pivot = aug[col][col];
      for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = aug[r][col];
        for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
      }
    }
    return aug.map((row) => row.slice(n).map((v) => Math.round(v * 1e10) / 1e10));
  }
}
