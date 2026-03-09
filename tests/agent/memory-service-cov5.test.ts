/**
 * MemoryStore — 추가 미커버 분기 커버리지 (cov5).
 * - list_daily / resolve_daily_path / get_paths
 * - consolidate: archive=true 분기, no daily content
 * - search: embed_fn 설정 시 vec 경로, FTS 직접 호출 경로
 * - consolidate_with_provider: tool_calls 없음 → false
 * - consolidate_with_provider: history_entry/memory_update 객체형
 * - consolidate_with_provider: lines.length=0 (모든 content 빈 경우)
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
  workspace = await mkdtemp(join(tmpdir(), "mem-cov5-"));
  store = new MemoryStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// get_paths / resolve_daily_path
// ══════════════════════════════════════════

describe("MemoryStore — get_paths / resolve_daily_path", () => {
  it("get_paths() → workspace, memoryDir, sqlitePath 반환", async () => {
    const paths = await store.get_paths();
    expect(paths.workspace).toBe(workspace);
    expect(paths.memoryDir).toContain("memory");
    expect(paths.sqlitePath).toContain("memory.db");
  });

  it("resolve_daily_path(day) → sqlite://memory/daily/{day} URI", async () => {
    const uri = await store.resolve_daily_path("2026-03-01");
    expect(uri).toContain("2026-03-01");
  });

  it("resolve_daily_path() 날짜 없음 → 오늘 날짜 URI 반환", async () => {
    const uri = await store.resolve_daily_path();
    const today = new Date().toISOString().slice(0, 10);
    expect(uri).toContain(today);
  });
});

// ══════════════════════════════════════════
// list_daily
// ══════════════════════════════════════════

describe("MemoryStore — list_daily", () => {
  it("daily 없음 → 빈 배열", async () => {
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
// consolidate — no daily content
// ══════════════════════════════════════════

describe("MemoryStore — consolidate 일별 컨텐츠 없음", () => {
  it("daily 없음 → summary = 'no daily entries consolidated'", async () => {
    const r = await store.consolidate({ memory_window: 7 });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe("no daily entries consolidated");
    expect(r.daily_entries_used).toEqual([]);
    expect(r.archived_files).toEqual([]);
  });

  it("window 범위 밖 daily → consolidated에 포함 안 됨", async () => {
    // 100일 전 날짜
    const old_date = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const old_day = old_date.toISOString().slice(0, 10);
    await store.write_daily("오래된 내용", old_day);
    const r = await store.consolidate({ memory_window: 7 });
    expect(r.daily_entries_used).not.toContain(old_day);
  });
});

// ══════════════════════════════════════════
// consolidate — archive=true
// ══════════════════════════════════════════

describe("MemoryStore — consolidate archive=true", () => {
  it("archive=true + window 내 daily → archived_files에 URI 포함", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("오늘의 내용", today);
    const r = await store.consolidate({ memory_window: 7, archive: true });
    expect(r.ok).toBe(true);
    expect(r.daily_entries_used).toContain(today);
    // archived_files: sqlite://memory/archive/daily/{day}
    expect(r.archived_files.some(f => f.includes(today))).toBe(true);
    // 아카이브 후 daily 삭제 확인
    const after = await store.read_daily(today);
    expect(after).toBe("");
  });

  it("archive=false → archived_files 비어있음", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("내용", today);
    const r = await store.consolidate({ memory_window: 7, archive: false });
    expect(r.archived_files).toEqual([]);
  });
});

// ══════════════════════════════════════════
// search — empty / FTS / vec
// ══════════════════════════════════════════

describe("MemoryStore — search", () => {
  it("빈 쿼리 → 빈 배열 반환", async () => {
    const r = await store.search("  ");
    expect(r).toEqual([]);
  });

  it("내용 없을 때 쿼리 → 빈 배열", async () => {
    const r = await store.search("없는내용");
    expect(r).toEqual([]);
  });

  it("longterm 내용 있을 때 search → 결과 반환", async () => {
    await store.write_longterm("# 프로젝트 메모리\n\n중요한 정보가 여기 있습니다.\n\n코딩 작업 진행 중.");
    const r = await store.search("중요한 정보", { kind: "longterm" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("kind=daily + day 필터로 검색", async () => {
    const day = "2026-03-01";
    await store.write_daily("# 일일 메모\n\n오늘의 작업 내용입니다.", day);
    const r = await store.search("오늘의 작업", { kind: "daily", day });
    expect(Array.isArray(r)).toBe(true);
  });

  it("embed_fn 설정 시 벡터 검색도 시도 (빈 임베딩 처리)", async () => {
    // embed_fn이 빈 embeddings 반환 → vec 경로에서 조기 반환
    store.set_embed(vi.fn().mockResolvedValue({ embeddings: [] }));
    await store.write_longterm("# 테스트\n\n벡터 검색 테스트 내용.");
    const r = await store.search("테스트");
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider — 다양한 분기
// ══════════════════════════════════════════

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

describe("MemoryStore — consolidate_with_provider", () => {
  it("messages <= keep_count → provider 미호출, true 반환", async () => {
    const provider = make_provider();
    const session = make_session([
      { role: "user", content: "hi", timestamp: "2026-01-01T00:00:00Z" },
      { role: "assistant", content: "hello", timestamp: "2026-01-01T00:00:01Z" },
    ]);
    // memory_window=50 → keep_count=25, messages.length=2 <= 25 → 즉시 true
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 50 });
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("old_messages.length = 0 → true (빈 슬라이스)", async () => {
    const provider = make_provider();
    // 메시지는 충분하지만 last_consolidated가 거의 끝에 있어 old_messages 슬라이스 비어있음
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
    }));
    // last_consolidated=29 (거의 끝), messages.length=30, keep_count=25
    // old = slice(29, 30-25=5) → slice(29, 5) = 빈 배열
    const session = make_session(msgs, 29);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 50 });
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("모든 content 비어있음 → lines.length=0 → true (provider 호출됨)", async () => {
    const provider = make_provider();
    // 메시지 충분하지만 content="" → lines에 추가 안 됨
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: "", // 빈 content
      timestamp: `2026-01-01T00:${String(Math.floor(i/60)).padStart(2,"0")}:${String(i%60).padStart(2,"0")}Z`,
    }));
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    // lines.length=0 → return true before calling provider
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("tool_calls 없음 → false 반환", async () => {
    const provider = make_provider({
      has_tool_calls: false,
      content: "no tools here", // 텍스트에도 save_memory 도구 없음
    });
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `message ${i}`,
      timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    }));
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(false);
  });

  it("tool_calls 있음 + history_entry/memory_update 성공 → true", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: {
          history_entry: "오늘의 요약",
          memory_update: "업데이트된 장기 기억",
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
    // history_entry가 daily에 추가됨
    const today = new Date().toISOString().slice(0, 10);
    const daily = await store.read_daily(today);
    expect(daily).toContain("오늘의 요약");
    // memory_update가 longterm에 저장됨
    const longterm = await store.read_longterm();
    expect(longterm).toBe("업데이트된 장기 기억");
  });

  it("history_entry가 객체 → JSON.stringify 후 저장", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: {
          history_entry: { summary: "요약본", tags: ["tag1"] }, // 객체형
          memory_update: null,
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
    const today = new Date().toISOString().slice(0, 10);
    const daily = await store.read_daily(today);
    expect(daily).toContain("요약본");
  });

  it("archive_all=true → 전체 메시지 처리, last_consolidated=0으로 리셋", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: { history_entry: "archive all 요약", memory_update: "" },
      }],
    });
    const msgs = [
      { role: "user" as const, content: "메시지1", timestamp: "2026-01-01T00:00:00Z" },
      { role: "assistant" as const, content: "응답1", timestamp: "2026-01-01T00:00:01Z" },
    ];
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { archive_all: true });
    expect(r).toBe(true);
    expect(provider.chat).toHaveBeenCalled();
    expect(session.last_consolidated).toBe(0);
  });

  it("tools_used 있는 메시지 → [tools: ...] 포함", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: { history_entry: "도구 사용 요약" },
      }],
    });
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
      timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
      tools_used: i === 0 ? ["bash", "read"] : [],
    }));
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);
    // provider.chat가 호출됐고, 프롬프트에 tools 포함 확인
    const call_args = provider.chat.mock.calls[0][0];
    const user_content = call_args.messages[1].content;
    expect(user_content).toContain("[tools: bash, read]");
  });
});
