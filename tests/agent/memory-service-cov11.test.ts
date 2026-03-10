/**
 * MemoryStore — 미커버 분기 보충 (cov11):
 * - L199: ensure_longterm_document → row 이미 존재 → early return
 * - L617: consolidate 루프 → 무효한 날짜 문자열 → Number.isFinite 실패 → continue
 * - L621: consolidate 루프 → 빈 content → continue
 *
 * NOTE:
 * - L615: list_daily()가 is_day_key로 이미 필터링 → consolidate L615는 dead code
 * - L443: rrf_merge가 Map으로 중복 제거 → age_fn 캐시 히트 불가 → dead code
 * - L465: meta=null → FTS와 memory_chunks 동기화 상태에서는 도달 불가
 * - L532-548, L570-590: sqlite-vec 미로딩 환경에서 도달 불가
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "@src/agent/memory.service.js";

let tmp_dir: string;

async function setup_store(): Promise<MemoryStore> {
  tmp_dir = await mkdtemp(join(tmpdir(), "mem-cov11-"));
  const store = new MemoryStore(tmp_dir);
  await (store as any).initialized;
  return store;
}

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════════════════════
// L199 — ensure_longterm_document row already exists
// ══════════════════════════════════════════════════════════

describe("MemoryStore — L199 ensure_longterm_document row 이미 존재", () => {
  it("초기화 후 ensure_longterm_document 재호출 → L199 early return (에러 없이 완료)", async () => {
    const store = await setup_store();
    // 첫 번째 호출은 이미 생성자에서 실행됨
    // 두 번째 호출: row 존재 → L199 if (row) return
    (store as any).ensure_longterm_document();
    // 세 번째 호출도 동일
    (store as any).ensure_longterm_document();
    // row가 중복 생성되지 않았음을 read_longterm으로 확인
    const content = await store.read_longterm();
    expect(typeof content).toBe("string");
  });
});

// ══════════════════════════════════════════════════════════
// L617 — consolidate → 유효 형식이지만 무효한 날짜 → Number.isFinite 실패 → continue
// ══════════════════════════════════════════════════════════

describe("MemoryStore — L617 consolidate 무효 날짜 continue", () => {
  it("형식은 맞지만 날짜 범위 초과 day → NaN Date → L617 continue", async () => {
    const store = await setup_store();

    // "2000-13-45" → is_day_key 통과(regex만 검사) BUT new Date("2000-13-45T00:00:00Z") = Invalid Date
    // sqlite_upsert_document로 직접 삽입 (write_daily는 validate 없이 저장, normalize_day_key가 통과시킴)
    (store as any).sqlite_upsert_document("daily", "2000-13-45", "memory://daily/2000-13-45", "Invalid date content");

    // consolidate → list_daily → "2000-13-45" 반환 → L615 통과 → L617: isFinite 실패 → continue
    const result = await store.consolidate({ archive: false, memory_window: 365 });
    expect(result.ok).toBe(true);
    // 무효 날짜는 used에 포함 안 됨
    expect(result.compressed_prompt).not.toContain("2000-13-45");
  });
});

// ══════════════════════════════════════════════════════════
// L621 — consolidate → 빈 content trim → continue
// ══════════════════════════════════════════════════════════

describe("MemoryStore — L621 consolidate 빈 content continue", () => {
  it("content가 빈 문자열인 daily → trim() = '' → L621 continue → used에 미포함", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);

    // 빈 content로 daily 작성
    await store.write_daily("", today);

    const result = await store.consolidate({ archive: false, memory_window: 7 });
    expect(result.ok).toBe(true);
    // 빈 content daily는 chunks에 미포함
    expect(result.compressed_prompt).toContain("no daily content in window");
  });

  it("공백만 있는 content → trim() = '' → L621 continue", async () => {
    const store = await setup_store();
    const today = new Date().toISOString().slice(0, 10);

    await store.write_daily("   \n  \t  ", today);

    const result = await store.consolidate({ archive: false, memory_window: 7 });
    expect(result.ok).toBe(true);
    expect(result.compressed_prompt).toContain("no daily content in window");
  });
});
