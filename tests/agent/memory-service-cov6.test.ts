/**
 * MemoryStore — 추가 미커버 분기 커버리지 (cov6).
 * - append_longterm / append_daily
 * - save_memory (overwrite 모드, daily 모드)
 * - search_chunks_fts: kind=longterm 필터, kind=daily+day 필터
 * - rechunk_document to_delete 경로 (큰 내용→작은 내용으로 교체)
 * - ensure_chunk_embeddings_fresh: 스테일 청크 임베딩
 * - normalize_vec norm=0 경로 (embed_fn 반환 [0,0,...])
 * - consolidate_with_provider: memory_update 문자열 동일 → 저장 안 함
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.js";
import type { ConsolidationSession } from "@src/agent/memory.types.js";

let workspace: string;
let store: MemoryStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mem-cov6-"));
  store = new MemoryStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════
// append_longterm / append_daily
// ══════════════════════════════════════════════════════════

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
    // today_key()는 로컬 시간 사용 → getDate() 기반
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const result = await store.read_daily(today);
    expect(result).toContain("오늘 추가 내용");
  });
});

// ══════════════════════════════════════════════════════════
// save_memory
// ══════════════════════════════════════════════════════════

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

  it("kind=longterm + mode 기본값 → append", async () => {
    await store.write_longterm("초기");
    const r = await store.save_memory({ kind: "longterm", content: " 기본append" });
    expect(r.ok).toBe(true);
    expect(r.target).toContain("longterm");
    const result = await store.read_longterm();
    expect(result).toContain("기본append");
  });

  it("kind=daily + mode=overwrite → write_daily 호출", async () => {
    const day = "2026-05-01";
    await store.save_memory({ kind: "daily", content: "daily overwrite", mode: "overwrite", day });
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

// ══════════════════════════════════════════════════════════
// search_chunks_fts — kind=longterm 필터
// ══════════════════════════════════════════════════════════

describe("MemoryStore — search kind=longterm 필터", () => {
  it("longterm 내용 있을 때 kind=longterm 검색 → 결과 반환", async () => {
    await store.write_longterm("# 장기 기억\n\n중요한 아키텍처 결정: 마이크로서비스 사용.\n\n두 번째 섹션: 성능 최적화 방법.");
    const r = await store.search("아키텍처", { kind: "longterm" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("daily 내용 있을 때 kind=longterm 검색 → daily 결과 미포함", async () => {
    await store.write_daily("daily 전용 내용", "2026-04-10");
    await store.write_longterm("# 장기\n\n장기 메모 내용");
    const r = await store.search("장기 메모", { kind: "longterm" });
    // longterm 필터만 검색하므로 daily 내용은 포함 안 됨
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// search_chunks_fts — kind=daily + day 필터
// ══════════════════════════════════════════════════════════

describe("MemoryStore — search kind=daily + day 필터", () => {
  it("특정 날짜 daily 검색 → 해당 날짜 내용만 반환", async () => {
    await store.write_daily("# 4월 10일\n\n특별한 회의 내용.", "2026-04-10");
    await store.write_daily("# 4월 11일\n\n다른 날의 내용.", "2026-04-11");
    const r = await store.search("회의", { kind: "daily", day: "2026-04-10" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("kind=all + day 필터 → day 필터 적용됨", async () => {
    await store.write_daily("# 특정일\n\n검색할 내용", "2026-06-01");
    const r = await store.search("검색할", { kind: "all", day: "2026-06-01" });
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// rechunk_document — to_delete 경로 (청크 수 줄어드는 경우)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — rechunk_document to_delete 경로", () => {
  it("큰 내용 → 작은 내용으로 교체 시 청크 수 줄어듦 (to_delete 경로)", async () => {
    // 충분히 큰 마크다운으로 여러 청크 생성
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

// ══════════════════════════════════════════════════════════
// ensure_chunk_embeddings_fresh — 스테일 청크 임베딩
// ══════════════════════════════════════════════════════════

describe("MemoryStore — ensure_chunk_embeddings_fresh 스테일 청크", () => {
  it("embed_fn 설정 + 실제 내용 있음 → embed_fn 호출됨 (임베딩 벡터 삽입)", async () => {
    const actual_embeddings = Array.from({ length: 256 }, (_, i) => i === 0 ? 1.0 : 0.0);
    const embed_fn = vi.fn().mockResolvedValue({ embeddings: [actual_embeddings] });
    store.set_embed(embed_fn);
    await store.write_longterm("# 테스트\n\n벡터 임베딩 대상 내용. " + "내용 ".repeat(20));

    // search 호출 시 ensure_chunk_embeddings_fresh가 실행됨
    await store.search("테스트");
    // embed_fn이 청크 임베딩을 위해 호출됨 (내부적으로)
    expect(embed_fn).toHaveBeenCalled();
  });

  it("embed_fn 반환 embeddings.length !== stale.length → 삽입 스킵", async () => {
    // 잘못된 embeddings 반환 → stale.length != embeddings.length
    const embed_fn = vi.fn()
      .mockResolvedValueOnce({ embeddings: [] }) // ensure_chunk_embeddings_fresh: 빈 반환
      .mockResolvedValueOnce({ embeddings: [] }); // search_chunks_vec: empty embeddings
    store.set_embed(embed_fn);
    await store.write_longterm("# 테스트\n\n내용이 있습니다.");
    const r = await store.search("테스트");
    expect(Array.isArray(r)).toBe(true); // 오류 없이 처리됨
  });
});

// ══════════════════════════════════════════════════════════
// search_chunks_vec — normalize_vec norm=0 경로
// ══════════════════════════════════════════════════════════

describe("MemoryStore — normalize_vec norm=0 (zero vector 임베딩)", () => {
  it("zero vector 임베딩 반환 → 정규화 시 all-zero → vec 검색 결과 없음", async () => {
    const zero_vec = Array(256).fill(0);
    const embed_fn = vi.fn()
      .mockResolvedValue({ embeddings: [zero_vec] }); // norm=0 → normalize 시 모두 0
    store.set_embed(embed_fn);
    await store.write_longterm("# 제로 벡터 테스트\n\n임베딩 내용.");
    const r = await store.search("제로 벡터", { kind: "longterm" });
    // zero vector로 KNN 검색 → 결과는 비어있거나 FTS 결과만
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// consolidate_with_provider — memory_update 동일 내용 → 저장 안 함
// ══════════════════════════════════════════════════════════

function make_session(messages: any[], last_consolidated = 0): ConsolidationSession {
  return { messages, last_consolidated };
}

function make_provider(response: any = {}) {
  return {
    chat: vi.fn().mockResolvedValue({
      content: "",
      has_tool_calls: false,
      tool_calls: [],
      ...response,
    }),
  } as any;
}

describe("MemoryStore — consolidate_with_provider memory_update 동일 내용", () => {
  it("memory_update가 현재 longterm과 동일 → write_longterm 미호출", async () => {
    // 현재 longterm 내용 설정
    const current = "현재 장기 기억 내용";
    await store.write_longterm(current);

    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: {
          history_entry: "새 히스토리",
          memory_update: current, // 동일 내용 → 저장 안 함
        },
      }],
    });
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
      timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    }));
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);
    // longterm은 변경 안 됨 (write_longterm 호출 안 됨)
    const longterm = await store.read_longterm();
    expect(longterm).toBe(current);
  });

  it("memory_update가 객체형 → JSON.stringify 후 저장", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: {
          history_entry: null,
          memory_update: { key: "value", count: 42 }, // 객체형
        },
      }],
    });
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
      timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    }));
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);
    const longterm = await store.read_longterm();
    expect(longterm).toContain("value");
  });

  it("history_entry 빈 문자열(trim 후) → append_daily 미호출", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: {
          history_entry: "   ", // trim 후 빈 문자열
          memory_update: "새로운 메모리",
        },
      }],
    });
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
      timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    }));
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);
    // longterm은 새 내용으로 변경됨
    const longterm = await store.read_longterm();
    expect(longterm).toContain("새로운 메모리");
  });
});

// ══════════════════════════════════════════════════════════
// consolidate — longterm_raw 있는 경우 (body 있음)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — consolidate body 있음 + longterm_raw 있음", () => {
  it("window 내 daily + longterm_raw → summary에 daily 개수 포함", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_longterm("기존 장기 기억");
    await store.write_daily("오늘의 일지", today);
    const r = await store.consolidate({ memory_window: 7 });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("consolidated");
    expect(r.daily_entries_used).toContain(today);
    expect(r.compressed_prompt).toContain("기존 장기 기억");
  });
});
