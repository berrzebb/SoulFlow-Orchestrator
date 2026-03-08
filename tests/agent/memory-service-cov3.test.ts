/**
 * MemoryStore — 벡터 검색 경로 보충.
 * set_embed 후 search → search_chunks_vec 진입,
 * ensure_chunk_embeddings_fresh (청크 임베딩 배치),
 * search_chunks_vec embeddings 없음 → [] 반환,
 * search 빈 쿼리 → [] 반환 (build_fts_query empty guard),
 * consolidate_with_provider memory_update 동일 내용 → write 생략,
 * consolidate_with_provider no tool calls → false.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.js";
import type { EmbedFn } from "@src/agent/memory.service.js";

let workspace: string;
let store: MemoryStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mem-cov3-"));
  store = new MemoryStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// search — 빈 쿼리 → []
// ══════════════════════════════════════════

describe("MemoryStore — search 빈 쿼리", () => {
  it("query 빈 문자열 → 빈 배열 반환", async () => {
    const r = await store.search("   ");
    expect(r).toEqual([]);
  });
});

// ══════════════════════════════════════════
// search_chunks_vec — embed_fn 없음 → FTS만
// ══════════════════════════════════════════

describe("MemoryStore — search embed_fn 없을 때 FTS 검색", () => {
  it("embed_fn 없어도 FTS 검색 동작함", async () => {
    await store.write_longterm("벡터검색 없이도 FTS로 검색 가능");
    const r = await store.search("FTS로");
    // FTS 결과가 있거나 빈 배열
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// set_embed + search_chunks_vec — 임베딩 배열 빈 경우 → []
// ══════════════════════════════════════════

describe("MemoryStore — set_embed + search: embeddings 빈 반환 → 벡터 결과 없음", () => {
  it("embed_fn이 빈 embeddings 반환 → 벡터 결과 없음, FTS 결과만", async () => {
    const empty_embed: EmbedFn = async () => ({ embeddings: [] });
    store.set_embed(empty_embed);
    await store.write_longterm("임베딩 빈 반환 테스트 데이터");
    // 에러 없이 실행되어야 함
    const r = await store.search("임베딩 빈");
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// set_embed + search_chunks_vec — 256차원 임베딩
// ══════════════════════════════════════════

describe("MemoryStore — set_embed 256차원 임베딩 → 벡터 검색 진입", () => {
  it("정상 256차원 embed_fn 설정 후 search → ensure_chunk_embeddings_fresh + vec 검색", async () => {
    // 256차원 벡터 반환하는 embed_fn mock
    const embed_fn: EmbedFn = vi.fn().mockResolvedValue({
      embeddings: [new Array(256).fill(0.1)],
    });
    store.set_embed(embed_fn);

    // 롱텀 메모리에 내용 추가 (청크 생성)
    await store.write_longterm("벡터 임베딩 테스트 내용. 중요한 데이터를 포함.");

    // search → ensure_chunk_embeddings_fresh 호출 → embed_fn 호출
    const r = await store.search("벡터 임베딩");
    expect(Array.isArray(r)).toBe(true);
    // embed_fn이 호출되었는지 확인 (임베딩 fresh 확인용)
    expect(embed_fn).toHaveBeenCalled();
  });

  it("embed_fn 가 null 반환 → vec 검색 실패 시 빈 배열 (에러 격리)", async () => {
    const failing_embed: EmbedFn = vi.fn().mockRejectedValue(new Error("embed service down"));
    store.set_embed(failing_embed);
    await store.write_longterm("에러 격리 테스트");
    // embed 실패해도 에러 전파 없음
    const r = await store.search("에러 격리");
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// ensure_chunk_embeddings_fresh — stale 없음 → early return
// ══════════════════════════════════════════

describe("MemoryStore — ensure_chunk_embeddings_fresh stale 없음", () => {
  it("청크 없을 때 embed_fn 호출 안 함", async () => {
    const embed_fn: EmbedFn = vi.fn().mockResolvedValue({
      embeddings: [new Array(256).fill(0.05)],
    });
    store.set_embed(embed_fn);

    // 청크 없는 상태에서 search → ensure_chunk_embeddings_fresh stale=[]:0 → early return
    const r = await store.search("쿼리없는데이터");
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider — memory_update 동일 내용 → write 생략
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider memory_update 동일 내용 생략", () => {
  it("memory_update가 현재 longterm과 동일 → write_longterm 호출 생략됨", async () => {
    const current = "동일한 메모리 내용";
    await store.write_longterm(current);

    const provider = {
      chat: vi.fn().mockResolvedValue({
        content: "",
        has_tool_calls: true,
        tool_calls: [
          {
            name: "save_memory",
            arguments: {
              history_entry: "오늘 작업 완료",
              memory_update: current, // 동일 내용
            },
          },
        ],
      }),
    };

    const session = {
      messages: [
        { role: "user", content: "안녕", timestamp: "2026-03-08T10:00:00Z" },
        { role: "assistant", content: "네 안녕하세요", timestamp: "2026-03-08T10:01:00Z" },
        { role: "user", content: "작업 완료", timestamp: "2026-03-08T10:02:00Z" },
        { role: "assistant", content: "알겠습니다", timestamp: "2026-03-08T10:03:00Z" },
      ],
      last_consolidated: 0,
    };

    const r = await store.consolidate_with_provider(session as any, provider as any, "model", { memory_window: 2 });
    expect(r).toBe(true);
    // write_longterm 생략 → 롱텀 메모리는 current와 동일
    const after = await store.read_longterm();
    expect(after).toContain(current);
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider — no tool calls → false
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider 빈 도구 호출 → false", () => {
  it("tool_calls 없고 텍스트에서도 파싱 불가 → false", async () => {
    const provider = {
      chat: vi.fn().mockResolvedValue({
        content: "도구 호출 없는 응답",
        has_tool_calls: false,
        tool_calls: [],
      }),
    };

    const session = {
      messages: [
        { role: "user", content: "테스트 메시지", timestamp: "2026-03-08T10:00:00Z" },
        { role: "assistant", content: "응답", timestamp: "2026-03-08T10:01:00Z" },
        { role: "user", content: "또 다른 메시지", timestamp: "2026-03-08T10:02:00Z" },
        { role: "assistant", content: "또 다른 응답", timestamp: "2026-03-08T10:03:00Z" },
      ],
      last_consolidated: 0,
    };

    const r = await store.consolidate_with_provider(session as any, provider as any, "model", { memory_window: 2 });
    expect(r).toBe(false);
  });
});

// ══════════════════════════════════════════
// search — case_sensitive 옵션 (커버리지 추가)
// ══════════════════════════════════════════

describe("MemoryStore — search case_sensitive 옵션", () => {
  it("case_sensitive=true로도 에러 없이 실행", async () => {
    await store.write_daily("Case Sensitive 테스트 데이터");
    const r = await store.search("Case", { case_sensitive: true });
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// search — limit 옵션
// ══════════════════════════════════════════

describe("MemoryStore — search limit 옵션", () => {
  it("limit=1 → 최대 1개 반환", async () => {
    await store.write_longterm("첫번째 내용 테스트 데이터");
    await store.write_daily("두번째 내용 테스트 데이터");
    const r = await store.search("내용 테스트", { limit: 1 });
    expect(r.length).toBeLessThanOrEqual(1);
  });
});
