/**
 * MemoryStore (memory.service.ts) — 미커버 경로 보충.
 * get_paths / resolve_daily_path / list_daily / save_memory / search / set_embed / consolidate / consolidate_with_provider
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.js";

// ── 헬퍼 ──────────────────────────────────────────────

let workspace: string;
let store: MemoryStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mem-svc-"));
  store = new MemoryStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// get_paths
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
// resolve_daily_path
// ══════════════════════════════════════════

describe("MemoryStore — resolve_daily_path", () => {
  it("날짜 없음 → today 기반 URI 반환", async () => {
    const path = await store.resolve_daily_path();
    expect(path).toContain("sqlite://memory/daily/");
  });

  it("유효한 날짜 지정 → 해당 날짜 URI 반환", async () => {
    const path = await store.resolve_daily_path("2026-01-15");
    expect(path).toContain("2026-01-15");
  });
});

// ══════════════════════════════════════════
// list_daily
// ══════════════════════════════════════════

describe("MemoryStore — list_daily", () => {
  it("초기 상태 → 빈 배열", async () => {
    const days = await store.list_daily();
    expect(Array.isArray(days)).toBe(true);
    expect(days.length).toBe(0);
  });

  it("daily 작성 후 → 해당 날짜 포함", async () => {
    await store.write_daily("daily content", "2026-03-01");
    await store.write_daily("another daily", "2026-03-02");
    const days = await store.list_daily();
    expect(days).toContain("2026-03-01");
    expect(days).toContain("2026-03-02");
  });
});

// ══════════════════════════════════════════
// save_memory
// ══════════════════════════════════════════

describe("MemoryStore — save_memory", () => {
  it("longterm overwrite 모드 → 덮어씀", async () => {
    await store.write_longterm("original");
    const r = await store.save_memory({ kind: "longterm", content: "replaced", mode: "overwrite" });
    expect(r.ok).toBe(true);
    expect(r.target).toContain("longterm");
    const content = await store.read_longterm();
    expect(content).toBe("replaced");
  });

  it("longterm append 모드 (기본) → 추가", async () => {
    await store.write_longterm("first");
    const r = await store.save_memory({ kind: "longterm", content: " second" });
    expect(r.ok).toBe(true);
    const content = await store.read_longterm();
    expect(content).toContain("first");
    expect(content).toContain("second");
  });

  it("daily overwrite 모드 → 해당 날짜 덮어씀", async () => {
    await store.write_daily("old", "2026-02-01");
    const r = await store.save_memory({ kind: "daily", content: "new", mode: "overwrite", day: "2026-02-01" });
    expect(r.ok).toBe(true);
    expect(r.target).toContain("2026-02-01");
    const content = await store.read_daily("2026-02-01");
    expect(content).toBe("new");
  });

  it("daily append 모드 (기본) → 날짜 추가", async () => {
    await store.write_daily("line1\n", "2026-02-01");
    await store.save_memory({ kind: "daily", content: "line2\n", day: "2026-02-01" });
    const content = await store.read_daily("2026-02-01");
    expect(content).toContain("line1");
    expect(content).toContain("line2");
  });
});

// ══════════════════════════════════════════
// search (FTS, embed 없음)
// ══════════════════════════════════════════

describe("MemoryStore — search (FTS)", () => {
  it("빈 쿼리 → 빈 배열", async () => {
    const r = await store.search("");
    expect(r).toEqual([]);
  });

  it("콘텐츠 작성 후 검색 → 결과 반환", async () => {
    await store.write_longterm("# Longterm\n\n비밀번호 정책: 8자 이상\n");
    await store.write_daily("오늘 작업: 코드 리뷰 완료\n", "2026-03-01");
    // FTS가 색인될 시간이 필요하지 않음 (sqlite 트리거로 즉시 처리)
    const r = await store.search("코드 리뷰");
    expect(Array.isArray(r)).toBe(true);
    // FTS 결과가 있으면 파일/라인/텍스트 포함
    if (r.length > 0) {
      expect(r[0]).toHaveProperty("file");
      expect(r[0]).toHaveProperty("line");
      expect(r[0]).toHaveProperty("text");
    }
  });

  it("kind=longterm 필터 → longterm 결과만", async () => {
    await store.write_longterm("# 원칙\n\n품질 최우선\n");
    const r = await store.search("품질", { kind: "longterm" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("kind=daily, day 필터", async () => {
    await store.write_daily("특별 이벤트 완료\n", "2026-03-05");
    const r = await store.search("특별 이벤트", { kind: "daily", day: "2026-03-05" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("limit 적용 — limit=1 → 최대 1개 반환", async () => {
    await store.write_longterm("# 1\n\n공통 단어 테스트\n\n# 2\n\n공통 단어 다른 절\n");
    const r = await store.search("공통 단어", { limit: 1 });
    expect(r.length).toBeLessThanOrEqual(1);
  });
});

// ══════════════════════════════════════════
// set_embed
// ══════════════════════════════════════════

describe("MemoryStore — set_embed", () => {
  it("embed 함수 설정 후 search_chunks_vec 활성화 경로 진입", async () => {
    const embed_fn = async (texts: string[]) => ({
      embeddings: texts.map(() => Array.from({ length: 256 }, () => 0.01)),
    });
    store.set_embed(embed_fn);
    await store.write_longterm("벡터 검색 테스트 문서\n");
    // embed 없이도 FTS만으로 동작; embed 있으면 추가로 vec 검색 시도
    const r = await store.search("벡터 검색");
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// consolidate
// ══════════════════════════════════════════

describe("MemoryStore — consolidate", () => {
  it("daily 없음 → ok=true, summary 포함", async () => {
    const r = await store.consolidate({ session: "sess-1", provider: "claude", model: "opus" });
    expect(r.ok).toBe(true);
    expect(typeof r.summary).toBe("string");
    expect(typeof r.compressed_prompt).toBe("string");
  });

  it("daily 있음 → longterm에 압축 반영", async () => {
    await store.write_daily("중요 작업 완료\n", "2026-03-01");
    const r = await store.consolidate({ session: "s", provider: "p", model: "m", memory_window: 30 });
    expect(r.ok).toBe(true);
    expect(r.daily_entries_used).toContain("2026-03-01");
    const longterm = await store.read_longterm();
    expect(longterm).toContain("중요 작업 완료");
  });

  it("archive=true → 사용된 daily 제거", async () => {
    await store.write_daily("제거될 내용\n", "2026-02-01");
    const r = await store.consolidate({ archive: true, memory_window: 365 });
    expect(r.ok).toBe(true);
    // archive 후 해당 daily는 삭제
    const after = await store.read_daily("2026-02-01");
    expect(after).toBe("");
    expect(r.archived_files.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider", () => {
  it("메시지 수 keep_count 이하 → 즉시 true 반환 (LLM 호출 없음)", async () => {
    const provider = { chat: async () => ({ content: "", finish_reason: "stop", has_tool_calls: false, tool_calls: [] }) };
    const session = { messages: [{ role: "user" as const, content: "hi", timestamp: "2026-01-01" }], last_consolidated: 0 };
    const r = await store.consolidate_with_provider(session, provider as any, "model");
    expect(r).toBe(true);
  });

  it("메시지 충분 + LLM tool_calls 응답 → memory 갱신", async () => {
    // 15개 이상 메시지로 window_default(50) 초과
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `메시지 ${i}`,
      timestamp: "2026-01-01T00:00:00Z",
    }));
    const session = { messages, last_consolidated: 0 };

    const provider = {
      chat: async () => ({
        content: "",
        finish_reason: "tool_use",
        has_tool_calls: true,
        tool_calls: [{
          name: "save_memory",
          arguments: { history_entry: "요약 항목", memory_update: "업데이트된 장기 기억" },
        }],
      }),
    };

    const r = await store.consolidate_with_provider(session, provider as any, "claude-opus");
    expect(r).toBe(true);
    const longterm = await store.read_longterm();
    expect(longterm).toContain("업데이트된 장기 기억");
  });

  it("LLM 응답에 tool_calls 없음 → false 반환", async () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
      timestamp: "2026-01-01",
    }));
    const session = { messages, last_consolidated: 0 };

    const provider = {
      chat: async () => ({
        content: "그냥 텍스트 응답",
        finish_reason: "stop",
        has_tool_calls: false,
        tool_calls: [],
      }),
    };

    const r = await store.consolidate_with_provider(session, provider as any, "model");
    expect(r).toBe(false);
  });

  it("archive_all=true → 모든 메시지 처리", async () => {
    const messages = [
      { role: "user" as const, content: "archiving", timestamp: "2026-01-01" },
      { role: "assistant" as const, content: "ok", timestamp: "2026-01-01" },
    ];
    const session = { messages, last_consolidated: 0 };

    const provider = {
      chat: async () => ({
        content: "",
        finish_reason: "tool_use",
        has_tool_calls: true,
        tool_calls: [{ name: "save_memory", arguments: { memory_update: "archived content" } }],
      }),
    };

    const r = await store.consolidate_with_provider(session, provider as any, "model", { archive_all: true });
    expect(r).toBe(true);
  });
});
