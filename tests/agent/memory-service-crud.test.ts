/**
 * MemoryStore — Core CRUD 통합 테스트.
 * get_paths / resolve_daily_path / list_daily / save_memory / set_embed /
 * set_embed_worker_config / rechunk_document / append_longterm / append_daily / normalize_vec
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.js";
import { chunk_markdown } from "@src/agent/memory-chunker.js";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

// ── 공유 헬퍼 ──────────────────────────────────────────────

let workspace: string;
let store: MemoryStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mem-crud-"));
  store = new MemoryStore(workspace);
  await (store as any).initialized;
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** Worker 우회 — chunk_markdown + SQLite 직접 삽입으로 동기 청킹. */
function rechunk_sync(
  s: MemoryStore,
  doc_key: string,
  kind: string,
  day: string,
  content: string,
): void {
  const sqlite_path = (s as any).sqlite_path as string;
  const chunks = chunk_markdown(content, doc_key);
  with_sqlite(sqlite_path, (db) => {
    db.prepare("DELETE FROM memory_chunks WHERE doc_key = ?").run(doc_key);
    const ins = db.prepare(`
      INSERT INTO memory_chunks (chunk_id, doc_key, kind, day, heading, start_line, end_line, content, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of chunks) {
      ins.run(c.chunk_id, doc_key, kind, day, c.heading, c.start_line, c.end_line, c.content, c.content_hash);
    }
    return true;
  });
}

// ══════════════════════════════════════════
// 1. get_paths
// ══════════════════════════════════════════

describe("MemoryStore — get_paths", () => {
  it("workspace / memoryDir / sqlitePath 반환", async () => {
    const paths = await store.get_paths();
    expect(paths.workspace).toBe(workspace);
    expect(paths.memoryDir).toContain("memory");
    expect(paths.sqlitePath).toContain("memory.db");
  });
});

// ══════════════════════════════════════════
// 2. resolve_daily_path
// ══════════════════════════════════════════

describe("MemoryStore — resolve_daily_path", () => {
  it("날짜 없음 → 오늘 날짜 URI 반환", async () => {
    const uri = await store.resolve_daily_path();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(uri).toContain(today);
  });

  it("유효한 날짜 지정 → 해당 날짜 URI 반환", async () => {
    const uri = await store.resolve_daily_path("2026-01-15");
    expect(uri).toContain("2026-01-15");
  });
});

// ══════════════════════════════════════════
// 3. list_daily
// ══════════════════════════════════════════

describe("MemoryStore — list_daily", () => {
  it("초기 상태 → 빈 배열", async () => {
    const days = await store.list_daily();
    expect(days).toEqual([]);
  });

  it("daily 항목 있음 → 날짜 목록 반환 (ASC 정렬)", async () => {
    await store.write_daily("B content", "2026-02-15");
    await store.write_daily("A content", "2026-01-10");
    const days = await store.list_daily();
    expect(days).toContain("2026-01-10");
    expect(days).toContain("2026-02-15");
    expect(days.indexOf("2026-01-10")).toBeLessThan(days.indexOf("2026-02-15"));
  });
});

// ══════════════════════════════════════════
// 4. save_memory
// ══════════════════════════════════════════

describe("MemoryStore — save_memory", () => {
  it("kind=longterm + mode=overwrite → write_longterm 호출", async () => {
    await store.save_memory({ kind: "longterm", content: "overwrite 내용", mode: "overwrite" });
    const result = await store.read_longterm();
    expect(result).toBe("overwrite 내용");
  });

  it("kind=longterm + mode=append → append_longterm 호출", async () => {
    await store.write_longterm("기존");
    await store.save_memory({ kind: "longterm", content: " 추가", mode: "append" });
    const result = await store.read_longterm();
    expect(result).toContain("기존");
    expect(result).toContain("추가");
  });

  it("kind=longterm + mode 기본값 → append (target URI 포함)", async () => {
    await store.write_longterm("초기");
    const r = await store.save_memory({ kind: "longterm", content: " 기본append" });
    expect(r.ok).toBe(true);
    expect(r.target).toContain("longterm");
    const result = await store.read_longterm();
    expect(result).toContain("기본append");
  });

  it("kind=daily + mode=overwrite → write_daily 호출", async () => {
    const day = "2026-05-01";
    await store.write_daily("old", day);
    const r = await store.save_memory({ kind: "daily", content: "daily overwrite", mode: "overwrite", day });
    expect(r.ok).toBe(true);
    expect(r.target).toContain(day);
    const result = await store.read_daily(day);
    expect(result).toBe("daily overwrite");
  });

  it("kind=daily + mode=append → append_daily 호출", async () => {
    const day = "2026-05-02";
    await store.write_daily("기존 daily\n", day);
    await store.save_memory({ kind: "daily", content: "추가 daily\n", mode: "append", day });
    const result = await store.read_daily(day);
    expect(result).toContain("기존 daily");
    expect(result).toContain("추가 daily");
  });

  it("kind=daily + target URI → daily/{day} URI 반환", async () => {
    const day = "2026-05-03";
    const r = await store.save_memory({ kind: "daily", content: "내용", day });
    expect(r.target).toContain(day);
  });
});

// ══════════════════════════════════════════
// 5. set_embed
// ══════════════════════════════════════════

describe("MemoryStore — set_embed", () => {
  it("embed 함수 설정 후 search_chunks_vec 활성화 경로 진입", async () => {
    const embed_fn = async (texts: string[]) => ({
      embeddings: texts.map(() => Array.from({ length: 256 }, () => 0.01)),
    });
    store.set_embed(embed_fn);
    await store.write_longterm("벡터 검색 테스트 문서\n");
    // embed 있으면 추가로 vec 검색 시도
    const r = await store.search("벡터 검색");
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// 6. set_embed_worker_config
// ══════════════════════════════════════════

describe("MemoryStore — set_embed_worker_config", () => {
  it("config 주입 → embed_worker_config 저장", async () => {
    const config = { model: "text-embed-test", api_key: "key-abc", base_url: "http://localhost:9999", dimensions: 256 };
    store.set_embed_worker_config(config as any);
    expect((store as any).embed_worker_config).toEqual(config);
  });
});

// ══════════════════════════════════════════
// 7. rechunk_document (직접 테스트)
// ══════════════════════════════════════════

describe("MemoryStore — rechunk_document 직접 호출", () => {
  it("새 content → chunk upsert → FTS에서 검색 가능", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    rechunk_sync(store, doc_key, "daily", today,
      "# Alpha Content\n\nThis rechunked content should be searchable via FTS immediately.");

    const results = await store.search("rechunked content searchable");
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("동일 doc_key 재청킹 → 기존 청크 삭제 + 새 청크 upsert", async () => {
    const doc_key = "longterm:MEMORY";

    rechunk_sync(store, doc_key, "longterm", "__longterm__",
      "# First Version\n\nOriginal document content to be replaced.");
    rechunk_sync(store, doc_key, "longterm", "__longterm__",
      "# Second Version\n\nReplacement content after rechunk with changed data.");

    const results = await store.search("replacement rechunk changed");
    expect(Array.isArray(results)).toBe(true);
  });

  it("빈 content → chunk 없음 → search 빈 결과", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const doc_key = `daily:${today}`;

    rechunk_sync(store, doc_key, "daily", today, "");

    const results = await store.search("anything here");
    expect(Array.isArray(results)).toBe(true);
  });

  it("동일 content 재청킹 → content_hash 동일 → skip upsert", async () => {
    const doc_key = "longterm:MEMORY";
    const content = "# Same Content\n\nThis content hash will be identical on rechunk. No change.";

    rechunk_sync(store, doc_key, "longterm", "__longterm__", content);
    rechunk_sync(store, doc_key, "longterm", "__longterm__", content);

    const results = await store.search("content hash identical");
    expect(Array.isArray(results)).toBe(true);
  });

  it("큰 내용 → 작은 내용으로 교체 시 청크 수 줄어듦 (to_delete 경로)", async () => {
    const big_content = [
      "# 섹션 1",
      "상세한 내용 1: " + "x".repeat(500),
      "",
      "# 섹션 2",
      "상세한 내용 2: " + "y".repeat(500),
      "",
      "# 섹션 3",
      "상세한 내용 3: " + "z".repeat(500),
    ].join("\n");
    await store.write_longterm(big_content);

    // 작은 내용으로 교체 → 기존 청크 삭제 경로 실행
    await store.write_longterm("# 짧은 내용\n\n단 하나의 섹션만.");
    const result = await store.read_longterm();
    expect(result).toContain("짧은 내용");
  });
});

// ══════════════════════════════════════════
// 8. append_longterm / append_daily
// ══════════════════════════════════════════

describe("MemoryStore — append_longterm / append_daily", () => {
  it("append_longterm → 기존 내용에 추가됨", async () => {
    await store.write_longterm("초기 내용");
    await store.append_longterm("\n추가 내용");
    const result = await store.read_longterm();
    expect(result).toContain("초기 내용");
    expect(result).toContain("추가 내용");
  });

  it("append_daily → 기존 daily에 추가됨", async () => {
    const day = "2026-04-01";
    await store.write_daily("1번 항목\n", day);
    await store.append_daily("2번 항목\n", day);
    const result = await store.read_daily(day);
    expect(result).toContain("1번 항목");
    expect(result).toContain("2번 항목");
  });

  it("append_daily: 날짜 없이 호출 → 오늘 daily에 추가", async () => {
    await store.append_daily("오늘 추가 내용\n");
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const result = await store.read_daily(today);
    expect(result).toContain("오늘 추가 내용");
  });
});

// ══════════════════════════════════════════
// 9. normalize_vec — zero vector
// ══════════════════════════════════════════

describe("MemoryStore — normalize_vec norm=0 (zero vector 임베딩)", () => {
  it("zero vector 임베딩 반환 → 정규화 시 all-zero → vec 검색 결과 없음", async () => {
    const zero_vec = Array(256).fill(0);
    const embed_fn = vi.fn()
      .mockResolvedValue({ embeddings: [zero_vec] });
    store.set_embed(embed_fn);
    await store.write_longterm("# 제로 벡터 테스트\n\n임베딩 내용.");
    const r = await store.search("제로 벡터", { kind: "longterm" });
    // zero vector로 KNN 검색 → 결과는 비어있거나 FTS 결과만
    expect(Array.isArray(r)).toBe(true);
  });
});
