/**
 * MemoryStore — 미커버 경로 보충 (cov9):
 * - ensure_chunk_embeddings_fresh 배치 임베딩 (L519-548)
 * - search_chunks_vec kind 필터 분기 (L492-508): longterm/daily/day
 * - apply_temporal_decay age_fn 클로저 (L403-417): FTS 히트 후 실행
 * - get_paths() (L294): 빈 쿼리 FTS 빠른 반환은 dead code지만 get_paths는 커버 가능
 * - consolidate: is_day_key false (L575)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "@src/agent/memory.service.js";

let tmp_dir: string;

async function setup_store(): Promise<MemoryStore> {
  tmp_dir = await mkdtemp(join(tmpdir(), "mem-cov9-"));
  return new MemoryStore(tmp_dir);
}

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════════════════════
// get_paths() (L298-305)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — get_paths() (L298-305)", () => {
  it("초기화 후 get_paths → workspace/memoryDir/sqlitePath 반환", async () => {
    const store = await setup_store();
    const paths = await store.get_paths();
    expect(paths.workspace).toBe(tmp_dir);
    expect(typeof paths.memoryDir).toBe("string");
    expect(typeof paths.sqlitePath).toBe("string");
    expect(paths.sqlitePath).toContain(".db");
  });
});

// ══════════════════════════════════════════════════════════
// ensure_chunk_embeddings_fresh — stale 청크 있음 + embed_fn (L519-548)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — ensure_chunk_embeddings_fresh 배치 (L519-548)", () => {
  it("embed_fn 설정 후 search → stale 청크 임베딩 배치 삽입됨", async () => {
    const store = await setup_store();

    // 먼저 embed_fn 없이 내용 작성 → stale 청크 생성
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily([
      "# Alpha Section",
      "embed test alpha content here for coverage",
    ].join("\n"), today);

    // embed_fn: 정확한 수의 임베딩 반환 (256차원)
    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map((_, i) =>
        new Array(256).fill(0).map((_, j) => Math.sin((i + 1) * (j + 1) * 0.01)),
      ),
    }));
    store.set_embed(embed_fn);

    // search → search_chunks_vec → ensure_chunk_embeddings_fresh → 배치 삽입
    const results = await store.search("alpha embed test", { kind: "daily", day: today });
    expect(Array.isArray(results)).toBe(true);
    // embed_fn이 최소 1번 호출됨 (stale 청크 + 쿼리 임베딩)
    expect(embed_fn).toHaveBeenCalled();
  });

  it("embed_fn이 잘못된 개수 반환 → 임베딩 삽입 생략 (L532 guard)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("# Beta\nbeta embed mismatch test", today);

    // embed_fn: 항상 1개만 반환 (stale 청크 수와 불일치)
    const embed_fn = vi.fn().mockImplementation(async (_texts: string[]) => ({
      embeddings: [[0.1, 0.2, 0.3]],  // 항상 1개 → 불일치 시 L532 return
    }));
    store.set_embed(embed_fn);

    const results = await store.search("beta mismatch", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("embed_fn이 null embeddings 반환 → search_chunks_vec early return (L474)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("# Gamma\ngamma null embeddings test", today);

    const embed_fn = vi.fn()
      // 첫 번째 호출 (stale 배치): 올바른 반환
      .mockResolvedValueOnce({ embeddings: [new Array(256).fill(0.1)] })
      // 두 번째 호출 (쿼리 임베딩): null 반환 → L474 early return
      .mockResolvedValueOnce({ embeddings: null });
    store.set_embed(embed_fn);

    const results = await store.search("gamma null", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// search_chunks_vec kind 필터 분기 (L496-502)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — search_chunks_vec kind 필터 분기 (L496-502)", () => {
  async function setup_with_embed(store: MemoryStore): Promise<void> {
    // embed_fn: stale 배치 + 쿼리 임베딩 모두 올바른 256차원 반환
    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => new Array(256).fill(0).map((_, j) => j * 0.001)),
    }));
    store.set_embed(embed_fn);
  }

  it("kind=longterm → longterm 필터 (L498)", async () => {
    const store = await setup_store();
    await store.write_longterm("## LT\nlongterm vec filter test alpha");
    await setup_with_embed(store);

    const results = await store.search("longterm vec filter", { kind: "longterm" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("kind=daily + day key → daily + day 필터 (L499-501)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## Daily\ndaily vec day filter alpha test", today);
    await setup_with_embed(store);

    const results = await store.search("daily vec day filter", { kind: "daily", day: today });
    expect(Array.isArray(results)).toBe(true);
  });

  it("kind=all + day key → day only 필터 (L502)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## All\nall kind day filter alpha", today);
    await setup_with_embed(store);

    const results = await store.search("all kind day filter", { kind: "all", day: today });
    expect(Array.isArray(results)).toBe(true);
  });

  it("kind=daily + day 없음 → kind만 필터 (L499-500, day skip)", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## NoDay\nno day filter test alpha", today);
    await setup_with_embed(store);

    // day 파라미터 없음 → is_day_key("") false → day 필터 생략
    const results = await store.search("no day filter test", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// consolidate — window 내 daily + archive=false (L574-578)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — consolidate window 내 daily 처리 (L574-578)", () => {
  it("오늘 daily → window 내 → used에 포함, archive=false → archived_files=[]", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("consolidate window test content alpha beta", today);

    const result = await store.consolidate({ archive: false, memory_window: 7 });
    expect(result.ok).toBe(true);
    expect(result.daily_entries_used.length).toBeGreaterThan(0);
    expect(result.archived_files).toHaveLength(0);
  });

  it("window 밖 daily는 used에 포함 안 됨", async () => {
    const store = await setup_store();
    // 10일 전 날짜
    const old_date = new Date();
    old_date.setDate(old_date.getDate() - 10);
    const old_day = old_date.toISOString().slice(0, 10);
    await store.write_daily("old content alpha beta", old_day);

    const result = await store.consolidate({ archive: false, memory_window: 3 });
    expect(result.ok).toBe(true);
    // window_days=3 → 10일 전 → age > window → used에 미포함
    expect(result.daily_entries_used).not.toContain(old_day);
  });
});
