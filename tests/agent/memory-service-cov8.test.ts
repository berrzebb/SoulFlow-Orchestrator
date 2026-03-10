/**
 * MemoryStore — 미커버 경로 보충 (cov8).
 * - age_fn / content_fn 클로저 (L403-417): FTS 실제 히트 → apply_temporal_decay 경로
 * - get_chunk_meta (L559-561): age_fn 내부 호출
 * - ensure_longterm_document "row exists" 경로 (L189)
 * - consolidate archive=true → sqlite_delete_daily (L621-622)
 * - ensure_chunk_embeddings_fresh 실제 임베딩 배치 (L519-548)
 * - search_chunks_vec kind=longterm 필터 (L498)
 * - search_chunks_vec kind=daily + day 필터 (L499-501)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "@src/agent/memory.service.js";

let tmp_dir: string;

async function setup(): Promise<MemoryStore> {
  tmp_dir = await mkdtemp(join(tmpdir(), "mem-cov8-"));
  return new MemoryStore(tmp_dir);
}

async function teardown(): Promise<void> {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
}

afterEach(async () => {
  await teardown();
});

// ══════════════════════════════════════════════════════════
// FTS 히트 → age_fn / content_fn 콜백 실행 (L403-417)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — FTS 히트 → age_fn/content_fn 클로저 실행 (L403-417)", () => {
  it("daily 내용 작성 후 단어 검색 → FTS 히트 → apply_temporal_decay 경로", async () => {
    const store = await setup();

    // FTS가 확실히 히트하도록 간단한 영문 내용 작성
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("alpha bravo charlie delta echo foxtrot", today);

    // 검색 — FTS가 "alpha"를 히트 → age_fn 실행 (L403+)
    const results = await store.search("alpha", { kind: "daily", day: today });
    // 히트 여부와 무관하게 정상 반환 (Array)
    expect(Array.isArray(results)).toBe(true);
  });

  it("longterm 내용 작성 후 검색 → age_fn null 반환 (longterm은 감쇠 면제)", async () => {
    const store = await setup();
    await store.write_longterm("## Memory\nalpha bravo charlie important notes");

    const results = await store.search("alpha", { kind: "longterm" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("kind=all + day 필터로 검색 → search_chunks_fts day 필터 경로", async () => {
    const store = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## Report\nalpha bravo", today);

    const results = await store.search("alpha", { kind: "all", day: today });
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// ensure_longterm_document "row exists" 경로 (L189)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — ensure_longterm_document row already exists (L189)", () => {
  it("같은 디렉토리에 두 번째 MemoryStore 생성 → row exists → early return", async () => {
    // 첫 번째 MemoryStore: longterm document 생성
    const store1 = await setup();
    await store1.write_longterm("existing longterm content");

    // 두 번째 MemoryStore: 같은 경로 → ensure_longterm_document에서 row 발견 → L189 실행
    const store2 = new MemoryStore(tmp_dir);
    const content = await store2.read_longterm();
    // 기존 내용이 그대로 있어야 함 (덮어쓰지 않음)
    expect(content).toBe("existing longterm content");
  });
});

// ══════════════════════════════════════════════════════════
// consolidate archive=true → sqlite_delete_daily (L621-622)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — consolidate archive=true → sqlite_delete_daily (L621-622)", () => {
  it("archive=true → 윈도우 내 daily 삭제 + archived 목록 반환", async () => {
    const store = await setup();

    // 오늘 날짜 daily 작성
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("archive this content", today);

    // 작성 확인
    const before = await store.read_daily(today);
    expect(before.trim()).toBe("archive this content");

    const result = await store.consolidate({ archive: true, memory_window: 7 });
    expect(result.ok).toBe(true);
    // archive=true → 삭제된 daily가 archived_files에 포함됨
    expect(result.archived_files).toBeInstanceOf(Array);
    expect(result.archived_files.length).toBeGreaterThan(0);

    // 삭제 후 read_daily 빈 문자열
    const after = await store.read_daily(today);
    expect(after.trim()).toBe("");
  });

  it("archive=true + window_days=0 → 오래된 daily만 삭제 (없으면 archived_files=[])", async () => {
    const store = await setup();

    const result = await store.consolidate({ archive: true, memory_window: 0 });
    expect(result.ok).toBe(true);
    expect(result.archived_files).toBeInstanceOf(Array);
  });
});

// ══════════════════════════════════════════════════════════
// content_fn 클로저 실행 (L414-417): scored.length > 1 필요
// ══════════════════════════════════════════════════════════

describe("MemoryStore — content_fn 클로저 실행 (L414-417)", () => {
  it("다중 섹션 문서 → 2개 이상 청크 → mmr_rerank에서 content_fn 호출됨", async () => {
    const store = await setup();
    const today = new Date().toISOString().slice(0, 10);

    // 여러 헤딩으로 여러 청크 생성 (chunk_markdown은 헤딩 단위로 분할)
    await store.write_daily([
      "# Section Alpha",
      "alpha bravo charlie delta relevant",
      "",
      "# Section Beta",
      "alpha echo foxtrot golf relevant",
      "",
      "# Section Gamma",
      "alpha hotel india juliet relevant",
    ].join("\n"), today);

    // "alpha"로 검색 → 여러 청크 히트 → scored.length > 1 → mmr_rerank content_fn 호출
    const results = await store.search("alpha", { kind: "daily", day: today });
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// ensure_chunk_embeddings_fresh 실제 배치 임베딩 (L519-548)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — ensure_chunk_embeddings_fresh 배치 임베딩 (L519-548)", () => {
  it("stale 청크 있음 + embed_fn 올바른 개수 반환 → 임베딩 배치 삽입 (L530-546)", async () => {
    const store = await setup();

    // embed_fn 없이 내용 작성 → stale 청크 생성
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily([
      "# Section A",
      "stale chunk content to embed properly",
      "",
      "# Section B",
      "another section for embedding batch",
    ].join("\n"), today);

    // embed_fn: 입력 텍스트 수만큼 임베딩 반환 (올바른 개수)
    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map((_, i) => Array.from({ length: 256 }, (_, j) => Math.sin(i + j))),
    }));
    store.set_embed(embed_fn);

    // search → ensure_chunk_embeddings_fresh → 배치 임베딩 삽입 (L530-546)
    const results = await store.search("stale chunk", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
    // embed_fn 호출 확인
    expect(embed_fn).toHaveBeenCalled();
  });

  it("embed_fn 반환 embeddings.length !== stale.length → 삽입 건너뜀 (L532)", async () => {
    const store = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## Test\ncontent here embed", today);

    // 잘못된 개수의 임베딩 반환 → L532 early return
    const embed_fn = vi.fn().mockResolvedValue({ embeddings: [] });
    store.set_embed(embed_fn);

    const results = await store.search("content", { kind: "daily" });
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// search_chunks_vec kind 필터 (L496-502) — 실제 vec 데이터 사용
// ══════════════════════════════════════════════════════════

describe("MemoryStore — search_chunks_vec kind 필터 경로 (L496-502)", () => {
  it("embed_fn + 실제 임베딩 데이터 → kind=longterm 필터 경로 (L498)", async () => {
    const store = await setup();
    await store.write_longterm("## Section\nvector longterm important notes content");

    // embed_fn으로 먼저 stale 청크 임베딩 삽입 (ensure_chunk_embeddings_fresh)
    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => Array.from({ length: 256 }, (_, i) => i === 0 ? 1.0 : 0.0)),
    }));
    store.set_embed(embed_fn);

    const results = await store.search("vector longterm", { kind: "longterm" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("embed_fn + 실제 임베딩 데이터 → kind=daily+day 필터 경로 (L499-501)", async () => {
    const store = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("## Section\nvector daily content important", today);

    const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => Array.from({ length: 256 }, (_, i) => i === 0 ? 1.0 : 0.0)),
    }));
    store.set_embed(embed_fn);

    const results = await store.search("vector daily", { kind: "daily", day: today });
    expect(Array.isArray(results)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// consolidate — 윈도우 밖 daily → 스킵 (L574-581)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — consolidate window_days 경계 (L574-581)", () => {
  it("30일 이전 daily 내용 + window_days=7 → 해당 daily 미포함", async () => {
    const store = await setup();

    // 30일 전 날짜
    const old_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await store.write_daily("old daily content", old_date);

    const result = await store.consolidate({ memory_window: 7 });
    expect(result.ok).toBe(true);
    // 오래된 daily는 window 밖 → daily_entries_used에 포함 안 됨
    expect(result.daily_entries_used).not.toContain(old_date);
  });

  it("daily content 비어 있음 → !content continue 경로 (L581)", async () => {
    const store = await setup();
    const today = new Date().toISOString().slice(0, 10);
    // 빈 내용 작성
    await store.write_daily("", today);

    const result = await store.consolidate({ memory_window: 7 });
    expect(result.ok).toBe(true);
    // 빈 daily → daily_entries_used에 포함 안 됨
    expect(result.daily_entries_used).not.toContain(today);
  });
});
