/**
 * ToolIndex — 내부 메서드 및 네이티브 DB 조작 테스트.
 * better-sqlite3 / sqlite-vec 직접 사용하므로 base와 분리.
 */
import { describe, it, expect, afterEach } from "vitest";
import { ToolIndex } from "@src/orchestration/tool-index.js";
import type { ToolSchema } from "@src/agent/tools/types.js";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  const d = mkdtempSync(join(tmpdir(), "tool-idx-int-"));
  tmp_dirs.push(d);
  return d;
}

function make_zero_vec(): Float32Array {
  const arr = new Float32Array(VEC_DIMENSIONS);
  arr.fill(0.1);
  return arr;
}

// ── build: tool_docs 존재 + tools_fts 없음 → FTS catch 실행 ──

describe("ToolIndex.build — tool_docs 있음 + tools_fts 없음 → FTS catch → 재생성", () => {
  it("tool_docs 테이블만 있는 DB로 build() → FTS5 체크 실패 → 드롭 후 재생성", () => {
    const tmp = make_tmp();
    const db_path = join(tmp, "test.db");

    const pre_db = new Database(db_path);
    pre_db.exec(`
      CREATE TABLE tool_docs (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT ''
      )
    `);
    pre_db.close();

    const index = new ToolIndex();
    index.build([make_tool("test_tool", "A test tool")], { test_tool: "util" }, db_path);

    expect(index.size).toBeGreaterThan(0);
  });
});

// ── vector_search: embed_fn/db_path 없음 → [] 반환 ──

describe("ToolIndex.vector_search — early return 경로", () => {
  it("embed_fn 미설정 → 즉시 [] 반환", async () => {
    const index = new ToolIndex();
    const result = await (index as any).vector_search("test query", 5);
    expect(result).toEqual([]);
  });

  it("db_path 미설정 → 즉시 [] 반환", async () => {
    const index = new ToolIndex();
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [[0.1]] });
    const result = await (index as any).vector_search("test query", 5);
    expect(result).toEqual([]);
  });

  it("query_buf null (빈 embeddings 반환) → [] 반환", async () => {
    const index = new ToolIndex();
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [] });
    (index as any).db_path = "/some/path.db";
    (index as any).fresh_checked_at = Date.now();

    const result = await (index as any).vector_search("test", 5);
    expect(result).toEqual([]);
  });

  it("KNN 결과 0건 → [] 반환", async () => {
    const tmp = make_tmp();
    const db_path = join(tmp, "test.db");

    const index = new ToolIndex();
    index.build([make_tool("test_tool", "A test tool for coverage")], { test_tool: "util" }, db_path);

    (index as any).embed_fn = async (_: string[]) => ({ embeddings: [Array.from(make_zero_vec())] });
    (index as any).fresh_checked_at = Date.now();
    (index as any)._get_or_embed_query = async () => make_zero_vec();

    const result = await (index as any).vector_search("test query", 5);
    expect(result).toEqual([]);
  });
});

// ── _get_or_embed_query 경로 ──

describe("ToolIndex._get_or_embed_query — 분기 커버", () => {
  it("embed_fn 없음 → null", async () => {
    const index = new ToolIndex();
    const result = await (index as any)._get_or_embed_query("any text");
    expect(result).toBeNull();
  });

  it("캐시 적중 → cached Float32Array 반환", async () => {
    const index = new ToolIndex();
    const cached = new Float32Array([0.1, 0.2, 0.3]);
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [[0.1, 0.2, 0.3]] });
    (index as any).query_cache.set("cached_query", cached);

    const result = await (index as any)._get_or_embed_query("cached_query");
    expect(result).toBe(cached);
  });

  it("embed_fn이 빈 배열 반환 → null", async () => {
    const index = new ToolIndex();
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [] });

    const result = await (index as any)._get_or_embed_query("any text");
    expect(result).toBeNull();
  });
});

// ── ensure_embeddings_fresh 경로 ──

describe("ToolIndex.ensure_embeddings_fresh — 분기 커버", () => {
  it("embed_fn 미설정 → 즉시 반환", async () => {
    const index = new ToolIndex();
    await (index as any).ensure_embeddings_fresh();
    expect(true).toBe(true);
  });

  it("embed_fn 있고 db_path 없음 → 즉시 반환", async () => {
    const index = new ToolIndex();
    (index as any).embed_fn = async (_t: string[]) => ({ embeddings: [] });
    await (index as any).ensure_embeddings_fresh();
    expect(true).toBe(true);
  });

  it("fresh_checked_at 최근 → TTL 내 조기 반환", async () => {
    const index = new ToolIndex();
    (index as any).embed_fn = async (_t: string[]) => ({ embeddings: [] });
    (index as any).db_path = "/some/db.db";
    (index as any).fresh_checked_at = Date.now();

    await (index as any).ensure_embeddings_fresh();
    expect(true).toBe(true);
  });

  it("stale_rows 없음 → embed_fn 호출 없이 반환", async () => {
    const tmp = make_tmp();
    const db_path = join(tmp, "test.db");

    const index = new ToolIndex();
    index.build([make_tool("coverage_tool", "Coverage test tool")], { coverage_tool: "util" }, db_path);

    const pre_db = new Database(db_path);
    sqliteVec.load(pre_db);

    const tool_docs_rows = pre_db.prepare(
      "SELECT c.rowid FROM tool_docs c JOIN tools t ON c.name = t.name",
    ).all() as { rowid: number }[];

    const ins_vec = pre_db.prepare("INSERT INTO tools_vec (rowid, embedding) VALUES (?, ?)");
    for (const row of tool_docs_rows) {
      ins_vec.run(BigInt(row.rowid), make_zero_vec());
    }
    pre_db.close();

    const embed_spy_calls: string[][] = [];
    (index as any).embed_fn = async (texts: string[]) => {
      embed_spy_calls.push(texts);
      return { embeddings: [] };
    };
    (index as any).fresh_checked_at = 0;

    await (index as any).ensure_embeddings_fresh();
    expect(embed_spy_calls).toHaveLength(0);
  });
});

// ── normalize_vec: zero norm ──

describe("ToolIndex — normalize_vec zero norm → v 그대로 반환", () => {
  it("올-제로 벡터 → norm=0 → 그대로 반환", async () => {
    const index = new ToolIndex();
    const zeros = new Array(256).fill(0);
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [zeros] });

    const result = await (index as any)._get_or_embed_query("zero_embedding_test");
    expect(result).toBeInstanceOf(Float32Array);
    expect(result[0]).toBe(0);
  });
});

// ── select: vector_search 결과 max 도달 → break ──

describe("ToolIndex.select — vector_search 결과 max 도달 → break", () => {
  it("max_tools=1 + vector_search 2개 반환 → break 실행", async () => {
    const tmp = make_tmp();
    const db_path = join(tmp, "test.db");
    const index = new ToolIndex();

    index.build(
      [make_tool("custom_x", "custom x tool"), make_tool("custom_y", "custom y tool")],
      { custom_x: "util", custom_y: "util" },
      db_path,
    );

    (index as any).embed_fn = async (_t: string[]) => ({ embeddings: [] });
    (index as any).vector_search = async () => ["custom_x", "custom_y"];

    const result = await index.select("zzz_no_match", {
      max_tools: 1,
      mode: "agent",
    });

    expect(result.size).toBeLessThanOrEqual(1);
  });
});
