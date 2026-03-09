/**
 * ToolIndex — 미커버 분기 보충 (cov2).
 * - _get_or_embed_query: query_cache 만료 후 최고 항목 삭제 (L508)
 * - build_fts_query: dead code지만 직접 테스트 가능 (L570-597)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolIndex } from "@src/orchestration/tool-index.js";
import type { ToolSchema } from "@src/agent/tools/types.js";
import type { EmbedFn } from "@src/agent/memory.service.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const VEC_DIM = 256;

function make_embed_fn(): EmbedFn {
  return vi.fn(async (texts: string[]) => {
    const embeddings = texts.map((text) => {
      const hash = Array.from(text).reduce((a, b) => a + b.charCodeAt(0), 0);
      const vec = new Array(VEC_DIM).fill(0);
      vec[hash % VEC_DIM] = 1.0;
      return vec;
    });
    return { embeddings };
  });
}

function make_tools(): ToolSchema[] {
  return [
    { function: { name: "read_file", description: "Read file contents", parameters: { type: "object", properties: {} } } },
    { function: { name: "write_file", description: "Write file contents", parameters: { type: "object", properties: {} } } },
  ];
}

let testDbPath: string;
let index: ToolIndex;

beforeEach(() => {
  testDbPath = join(tmpdir(), `tool-index-cov2-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  index = new ToolIndex();
});

afterEach(() => {
  if (existsSync(testDbPath)) rmSync(testDbPath, { force: true });
  [testDbPath + "-shm", testDbPath + "-wal"].forEach(f => { if (existsSync(f)) rmSync(f, { force: true }); });
});

// ══════════════════════════════════════════
// L508: query_cache 만료 → 최고 항목 삭제
// ══════════════════════════════════════════

describe("ToolIndex — query_cache 최대 크기 초과 후 eviction (L508)", () => {
  it("17개 이상의 query_cache 항목 → 첫 번째 항목 삭제", async () => {
    index.build(make_tools(), {}, testDbPath);
    const embed_fn = make_embed_fn();
    index.set_embed(embed_fn);

    // QUERY_CACHE_MAX = 16, 17번 다른 쿼리로 채우면 L508 도달
    for (let i = 0; i < 17; i++) {
      await (index as any)._get_or_embed_query(`unique_query_${i}_text`);
    }

    // query_cache는 최대 16개 유지
    const cache = (index as any).query_cache as Map<string, Float32Array>;
    expect(cache.size).toBeLessThanOrEqual(16);
  });
});

// ══════════════════════════════════════════
// L570-597: build_fts_query — 직접 호출 (dead code)
// ══════════════════════════════════════════

describe("ToolIndex — build_fts_query (L570-597)", () => {
  it("영어 키워드 → OR 조합 FTS 쿼리 반환", () => {
    const result = (index as any).build_fts_query("read file contents search");
    expect(typeof result).toBe("string");
    expect(result).toContain("OR");
  });

  it("한국어 키워드 → 영어 태그로 확장", () => {
    const result = (index as any).build_fts_query("파일 검색하기");
    // '파일' → ["file", "files", "read", "write", "upload", "download"]
    // '검색' → ["search", "find", "query", "filter"]
    expect(result).toBeTruthy();
    expect(result).toContain("OR");
  });

  it("수학 키워드 → math 관련 태그 확장", () => {
    const result = (index as any).build_fts_query("수학 계산");
    expect(result).toContain("math");
  });

  it("camelCase 식별자 → 분리 후 FTS 쿼리", () => {
    const result = (index as any).build_fts_query("readFileContents");
    // 'readFileContents' 전체 + 소문자 토큰 포함
    expect(result).toBeTruthy();
  });

  it("snake_case 식별자 → _ 분리 후 FTS 쿼리", () => {
    const result = (index as any).build_fts_query("read_file_contents");
    expect(result).toContain("read");
    expect(result).toContain("file");
    expect(result).toContain("contents");
  });

  it("빈 문자열 → null 반환 (L594)", () => {
    const result = (index as any).build_fts_query("");
    expect(result).toBeNull();
  });

  it("stop word만 있는 경우 → null 반환", () => {
    // 짧고 stop word인 텍스트
    const result = (index as any).build_fts_query("a i");
    // 짧은 단어들(길이 < 2)이면 terms.size === 0 → null
    expect(result).toBeNull();
  });
});
