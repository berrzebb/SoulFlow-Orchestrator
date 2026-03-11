/**
 * ToolIndex — 미커버 분기 (cov5):
 * - L484: vector_search — KNN 쿼리 결과 0건 → if (!rows.length) return []
 * - L544: ensure_embeddings_fresh — stale_rows 없음 → if (!stale_rows.length) return
 *
 * L430 (inner break): _mem_search가 정확히 limit개 반환하므로 추가 항목 없음 → dead code.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { ToolIndex } from "@src/orchestration/tool-index.js";
import type { ToolSchema } from "@src/agent/tools/types.js";

const VEC_DIMENSIONS = 256;

function make_tool(name: string, description: string): ToolSchema {
  return {
    function: { name, description, parameters: { type: "object", properties: {} } },
  };
}

const tmp_dirs: string[] = [];

afterEach(() => {
  for (const d of tmp_dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function make_tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "tool-idx-cov5-"));
  tmp_dirs.push(d);
  return d;
}

function make_zero_vec(): Float32Array {
  const arr = new Float32Array(VEC_DIMENSIONS);
  arr.fill(0.1);
  return arr;
}

// ── L484: vector_search — KNN 결과 0건 → return [] ───────────────────────────

describe("ToolIndex.vector_search — L484: KNN 0건 → []", () => {
  it("tools_vec 비어있음 + KNN 쿼리 → 0 rows → L484 return []", async () => {
    const tmp = make_tmp();
    const db_path = join(tmp, "test.db");

    // build()로 실제 DB 생성 (tools_vec는 build 후 비어 있음)
    const index = new ToolIndex();
    index.build([make_tool("test_tool", "A test tool for coverage")], { test_tool: "util" }, db_path);

    // embed_fn 설정 (L462 bypass)
    (index as any).embed_fn = async (_: string[]) => ({ embeddings: [Array.from(make_zero_vec())] });

    // fresh_checked_at을 현재로 설정 → ensure_embeddings_fresh TTL check (L529) 통과
    (index as any).fresh_checked_at = Date.now();

    // _get_or_embed_query를 stub → non-null Float32Array 반환 (L469 bypass)
    (index as any)._get_or_embed_query = async () => make_zero_vec();

    // tools_vec 비어있음 → KNN 결과 0건 → L484 fires → [] 반환
    const result = await (index as any).vector_search("test query", 5);
    expect(result).toEqual([]);
  });
});

// ── L544: ensure_embeddings_fresh — stale_rows 없음 → return ─────────────────

describe("ToolIndex.ensure_embeddings_fresh — L544: stale_rows 없음 → 즉시 반환", () => {
  it("모든 tool_docs에 tools_vec 항목 존재 → stale_rows=0 → L544 return", async () => {
    const tmp = make_tmp();
    const db_path = join(tmp, "test.db");

    // build()로 실제 DB 생성
    const index = new ToolIndex();
    index.build([make_tool("coverage_tool", "Coverage test tool")], { coverage_tool: "util" }, db_path);

    // tools_vec에 수동으로 tool_docs의 모든 항목 삽입 (stale 없음 상태 만들기)
    const pre_db = new Database(db_path);
    sqliteVec.load(pre_db);

    const tool_docs_rows = pre_db.prepare(
      "SELECT c.rowid FROM tool_docs c JOIN tools t ON c.name = t.name",
    ).all() as { rowid: number }[];

    const ins_vec = pre_db.prepare("INSERT INTO tools_vec (rowid, embedding) VALUES (?, ?)");
    for (const row of tool_docs_rows) {
      const vec = make_zero_vec();
      ins_vec.run(BigInt(row.rowid), vec);
    }
    pre_db.close();

    // embed_fn 설정 (L527 bypass)
    (index as any).embed_fn = async (_: string[]) => ({ embeddings: [Array.from(make_zero_vec())] });
    // fresh_checked_at을 0으로 설정 → TTL 체크 통과 (L529 bypass) → DB 조회 진행
    (index as any).fresh_checked_at = 0;

    // stale_rows가 없으므로 → L544 fires → 즉시 반환 (embed_fn 호출 없음)
    const embed_spy_calls: string[][] = [];
    (index as any).embed_fn = async (texts: string[]) => {
      embed_spy_calls.push(texts);
      return { embeddings: [] };
    };

    await (index as any).ensure_embeddings_fresh();

    // L544에서 return → embed_fn이 호출되지 않음
    expect(embed_spy_calls).toHaveLength(0);
  });
});
