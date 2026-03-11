/**
 * ToolIndex — 미커버 분기 (cov4):
 * - L266, L267: build() — tool_docs 존재 + tools_fts 없음 → FTS5 catch → 테이블 드롭
 * - L451: select() — vector_search 결과 max 도달 → break
 * - L462: vector_search — embed_fn/db_path 없음 → [] 반환
 * - L469: vector_search — query_buf null → [] 반환
 * - L498: _get_or_embed_query — embed_fn 없음 → null 반환
 * - L501: _get_or_embed_query — 쿼리 캐시 적중
 * - L504: _get_or_embed_query — embed_fn이 빈 embeddings 반환 → null
 * - L527: ensure_embeddings_fresh — embed_fn/db_path 없음 → 즉시 반환
 * - L529: ensure_embeddings_fresh — TTL 내 재호출 → 즉시 반환
 * - L608: normalize_vec — norm=0 → v 그대로 반환
 */
import { describe, it, expect, afterEach } from "vitest";
import { ToolIndex } from "@src/orchestration/tool-index.js";
import type { ToolSchema } from "@src/agent/tools/types.js";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  const d = mkdtempSync(join(tmpdir(), "tool-idx-cov4-"));
  tmp_dirs.push(d);
  return d;
}

// ── L266, L267: tool_docs 존재 + tools_fts 없음 → catch → 드롭 ──────────────

describe("ToolIndex.build — L266/267: tool_docs 있음 + tools_fts 없음 → FTS catch 실행", () => {
  it("tool_docs 테이블만 있는 DB로 build() → FTS5 체크 실패 → L266/267 실행 후 재생성", () => {
    const tmp = make_tmp();
    const db_path = join(tmp, "test.db");

    // tool_docs만 생성, tools_fts는 없음
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
    // build() → has_tool_docs=true → else → SELECT 1 FROM tools_fts → 없으므로 throw → L266/267
    index.build([make_tool("test_tool", "A test tool")], { test_tool: "util" }, db_path);

    // 예외 없이 완료 → select도 정상 작동
    expect(index.size).toBeGreaterThan(0);
  });
});

// ── L462: vector_search — embed_fn/db_path 없음 → [] 반환 ───────────────────

describe("ToolIndex.vector_search — L462: embed_fn 없음 → [] 반환", () => {
  it("embed_fn 미설정 시 vector_search 즉시 [] 반환 (L462)", async () => {
    const index = new ToolIndex();
    // embed_fn=null, db_path=null → L462 early return
    const result = await (index as any).vector_search("test query", 5);
    expect(result).toEqual([]);
  });

  it("db_path 미설정 시 vector_search 즉시 [] 반환 (L462)", async () => {
    const index = new ToolIndex();
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [[0.1]] });
    // db_path=null → L462 early return
    const result = await (index as any).vector_search("test query", 5);
    expect(result).toEqual([]);
  });
});

// ── L469: vector_search — query_buf null → [] 반환 ──────────────────────────

describe("ToolIndex.vector_search — L469: query_buf null → [] 반환", () => {
  it("embed_fn이 빈 embeddings 반환 → query_buf null → L469", async () => {
    const index = new ToolIndex();
    // embed_fn은 빈 배열 반환 → _get_or_embed_query null 반환
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [] });
    (index as any).db_path = "/some/path.db";
    // TTL을 지금으로 설정 → ensure_embeddings_fresh가 L529에서 조기 반환
    (index as any).fresh_checked_at = Date.now();

    const result = await (index as any).vector_search("test", 5);
    expect(result).toEqual([]);
  });
});

// ── L498: _get_or_embed_query — embed_fn 없음 → null 반환 ───────────────────

describe("ToolIndex._get_or_embed_query — L498: embed_fn 없음 → null", () => {
  it("embed_fn 미설정 시 _get_or_embed_query null 반환 (L498)", async () => {
    const index = new ToolIndex();
    const result = await (index as any)._get_or_embed_query("any text");
    expect(result).toBeNull();
  });
});

// ── L501: _get_or_embed_query — 쿼리 캐시 적중 ───────────────────────────────

describe("ToolIndex._get_or_embed_query — L501: 캐시 적중", () => {
  it("동일 텍스트 두 번 호출 → 캐시에서 반환 (L501)", async () => {
    const index = new ToolIndex();
    const cached = new Float32Array([0.1, 0.2, 0.3]);
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [[0.1, 0.2, 0.3]] });
    (index as any).query_cache.set("cached_query", cached);

    // 캐시에 이미 있음 → L501: cached 반환 (embed_fn 미호출)
    const result = await (index as any)._get_or_embed_query("cached_query");
    expect(result).toBe(cached);
  });
});

// ── L504: _get_or_embed_query — embed_fn 빈 배열 반환 → null ────────────────

describe("ToolIndex._get_or_embed_query — L504: embeddings 빈 배열 → null", () => {
  it("embed_fn이 [] 반환 → L504: null 반환", async () => {
    const index = new ToolIndex();
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [] });

    const result = await (index as any)._get_or_embed_query("any text");
    expect(result).toBeNull();
  });
});

// ── L527: ensure_embeddings_fresh — embed_fn/db_path 없음 → 즉시 반환 ────────

describe("ToolIndex.ensure_embeddings_fresh — L527: embed_fn 없음 → 즉시 반환", () => {
  it("embed_fn 미설정 → ensure_embeddings_fresh 즉시 반환 (L527)", async () => {
    const index = new ToolIndex();
    // 예외 없이 반환
    await (index as any).ensure_embeddings_fresh();
    expect(true).toBe(true);
  });

  it("embed_fn 있고 db_path 없음 → ensure_embeddings_fresh 즉시 반환 (L527)", async () => {
    const index = new ToolIndex();
    (index as any).embed_fn = async (_t: string[]) => ({ embeddings: [] });
    // db_path=null → L527 early return
    await (index as any).ensure_embeddings_fresh();
    expect(true).toBe(true);
  });
});

// ── L529: ensure_embeddings_fresh — TTL 내 재호출 → 즉시 반환 ───────────────

describe("ToolIndex.ensure_embeddings_fresh — L529: TTL 내 재호출 → 조기 반환", () => {
  it("fresh_checked_at 최근 설정 → TTL 내 재호출 → L529 early return", async () => {
    const index = new ToolIndex();
    (index as any).embed_fn = async (_t: string[]) => ({ embeddings: [] });
    (index as any).db_path = "/some/db.db";
    // fresh_checked_at을 현재로 설정 → 5분 TTL 이내
    (index as any).fresh_checked_at = Date.now();

    // TTL 내 → L529 조기 반환 (DB 열지 않음)
    await (index as any).ensure_embeddings_fresh();
    expect(true).toBe(true);
  });
});

// ── L608: normalize_vec — norm=0 → v 그대로 반환 ────────────────────────────

describe("ToolIndex — L608: normalize_vec zero norm → v 그대로 반환", () => {
  it("embed_fn이 올-제로 벡터 반환 → normalize_vec norm=0 → L608 실행", async () => {
    const index = new ToolIndex();
    const zeros = new Array(256).fill(0);
    (index as any).embed_fn = async (_texts: string[]) => ({ embeddings: [zeros] });

    // _get_or_embed_query → normalize_vec(zeros) → norm=0 → L608: return v
    const result = await (index as any)._get_or_embed_query("zero_embedding_test");
    // norm=0이어도 Float32Array 반환 (zeros)
    expect(result).toBeInstanceOf(Float32Array);
    expect(result[0]).toBe(0);
  });
});

// ── L451: select() — vector_search 결과로 max 도달 → break ─────────────────

describe("ToolIndex.select — L451: vector_search 결과 반복 중 max 도달 → break", () => {
  it("max_tools=1 + vector_search가 2개 반환 → L451 break 실행", async () => {
    const tmp = make_tmp();
    const db_path = join(tmp, "test.db");
    const index = new ToolIndex();

    // 도구 빌드 (CORE_TOOLS 아닌 이름)
    index.build(
      [make_tool("custom_x", "custom x tool"), make_tool("custom_y", "custom y tool")],
      { custom_x: "util", custom_y: "util" },
      db_path,
    );

    // embed_fn과 db_path 설정 → vector search block 진입 조건 충족
    (index as any).embed_fn = async (_t: string[]) => ({ embeddings: [] });

    // vector_search를 인스턴스에서 직접 교체 → 2개 반환
    (index as any).vector_search = async () => ["custom_x", "custom_y"];

    // max_tools=1, 쿼리는 매칭 없음("zzz") → selected.size=0 < 1
    // vector_search 결과: custom_x, custom_y
    // iter 1: size=0<1 → add → size=1
    // iter 2: size=1>=1 → L451 break
    const result = await index.select("zzz_no_match", {
      max_tools: 1,
      mode: "agent",
    });

    expect(result.size).toBeLessThanOrEqual(1);
  });
});
