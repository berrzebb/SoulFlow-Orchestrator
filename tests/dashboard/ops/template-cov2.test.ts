/**
 * dashboard/ops/template.ts — 미커버 분기 (cov2):
 * - L15: resolve_path → sanitize_filename이 빈 문자열 반환 → null
 * - L34: write() → sanitize_filename이 빈 문자열 → { ok: false }
 * - L37: write() → is_inside 실패 → { ok: false }
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create_template_ops } from "@src/dashboard/ops-factory.ts";

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "tpl-cov2-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true }).catch(() => {});
});

describe("create_template_ops — write() 미커버 분기", () => {
  it("unsafe name (빈 문자열) → write() { ok: false }", () => {
    const ops = create_template_ops(workspace);
    // sanitize_filename("") → 빈 문자열 → L34 early return
    const result = ops.write("", "content");
    expect(result.ok).toBe(false);
  });

  it("sanitize 후 안전한 이름으로 write() 성공 (경로 구분자는 제거됨)", () => {
    const ops = create_template_ops(workspace);
    // sanitize_filename("../../../etc") → "../" 및 ".." 제거 → "etc" → 정상 write
    const result = ops.write("../../../etc", "sanitized content");
    expect(result.ok).toBe(true);
  });

  it("read() — 존재하지 않는 템플릿 이름 → null", () => {
    const ops = create_template_ops(workspace);
    const result = ops.read("NONEXISTENT_TEMPLATE_XYZ");
    expect(result).toBeNull();
  });

  it("read() — unsafe name → null", () => {
    const ops = create_template_ops(workspace);
    const result = ops.read("");
    expect(result).toBeNull();
  });
});
