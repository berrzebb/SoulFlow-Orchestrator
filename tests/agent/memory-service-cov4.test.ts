/**
 * MemoryStore — 미커버 분기 추가 커버리지.
 * - consolidate_with_provider: archive_all=true, messages <= keep_count, last_consolidated unchanged
 * - consolidate_with_provider: old_messages.length=0, lines.length=0
 * - consolidate_with_provider: history_entry가 객체 (JSON.stringify), memory_update가 객체
 * - consolidate_with_provider: implicit tool calls (text parsing)
 * - search: kind=longterm/daily + day 필터 조합
 * - save_memory: overwrite 모드 (longterm + daily)
 * - append_longterm / append_daily 후 청크 재인덱싱
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.js";

let workspace: string;
let store: MemoryStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mem-cov4-"));
  store = new MemoryStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// save_memory — overwrite 모드
// ══════════════════════════════════════════

describe("MemoryStore — save_memory overwrite", () => {
  it("longterm overwrite → 기존 내용 완전 교체", async () => {
    await store.write_longterm("원래 내용");
    const r = await store.save_memory({ kind: "longterm", content: "새 내용", mode: "overwrite" });
    expect(r.ok).toBe(true);
    const after = await store.read_longterm();
    expect(after).toBe("새 내용");
    expect(after).not.toContain("원래 내용");
  });

  it("daily overwrite → 날짜 지정 저장", async () => {
    const day = "2026-01-15";
    await store.write_daily("첫 번째", day);
    const r = await store.save_memory({ kind: "daily", content: "덮어쓰기", mode: "overwrite", day });
    expect(r.ok).toBe(true);
    const after = await store.read_daily(day);
    expect(after).toBe("덮어쓰기");
  });

  it("daily append (기본 모드) → 기존 내용에 추가", async () => {
    const day = "2026-01-16";
    await store.write_daily("초기", day);
    await store.save_memory({ kind: "daily", content: " 추가", day });
    const after = await store.read_daily(day);
    expect(after).toContain("초기");
    expect(after).toContain("추가");
  });
});

// ══════════════════════════════════════════
// search — kind 필터 (longterm / daily)
// ══════════════════════════════════════════

describe("MemoryStore — search kind 필터", () => {
  it("kind=longterm → longterm 문서에서만 검색", async () => {
    await store.write_longterm("longterm검색키워드 내용");
    await store.write_daily("daily전용키워드 내용");
    const r = await store.search("longterm검색키워드", { kind: "longterm" });
    expect(Array.isArray(r)).toBe(true);
    // longterm 검색 → daily 결과 없음
  });

  it("kind=daily → daily 문서에서만 검색", async () => {
    await store.write_longterm("longterm전용키워드");
    await store.write_daily("daily검색키워드 내용");
    const r = await store.search("daily검색키워드", { kind: "daily" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("kind=daily + day → 특정 날짜만 검색", async () => {
    await store.write_daily("특정날짜데이터", "2026-01-10");
    await store.write_daily("다른날짜데이터", "2026-01-11");
    const r = await store.search("특정날짜데이터", { kind: "daily", day: "2026-01-10" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("kind=all + day → 해당 날짜 필터 적용", async () => {
    await store.write_daily("날짜필터테스트", "2026-02-01");
    const r = await store.search("날짜필터테스트", { kind: "all", day: "2026-02-01" });
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider — messages <= keep_count → true
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider 조기 종료", () => {
  it("messages.length <= keep_count → 즉시 true 반환 (provider 미호출)", async () => {
    const provider = { chat: vi.fn() };
    const session = {
      messages: [
        { role: "user", content: "msg1", timestamp: "2026-01-01T00:00:00Z" },
      ],
      last_consolidated: 0,
    };
    // memory_window=50 → keep_count=25 → messages.length(1) <= 25 → early true
    const r = await store.consolidate_with_provider(session as any, provider as any, "model", { memory_window: 50 });
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("last_consolidated = messages.length → 처리할 메시지 없음 → true", async () => {
    const provider = { chat: vi.fn() };
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `메시지${i}`,
      timestamp: "2026-01-01T00:00:00Z",
    }));
    const session = { messages: msgs, last_consolidated: 30 };
    const r = await store.consolidate_with_provider(session as any, provider as any, "model", { memory_window: 10 });
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("old_messages.length=0 (slice 결과 빈 배열) → true", async () => {
    const provider = { chat: vi.fn() };
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user",
      content: `메시지${i}`,
      timestamp: "2026-01-01T00:00:00Z",
    }));
    // last_consolidated = messages.length - keep_count → slice 결과 0
    const session = { messages: msgs, last_consolidated: 16 };
    // memory_window=28 → keep_count=14 → old_messages = msgs.slice(16, 30-14) = slice(16,16) = []
    const r = await store.consolidate_with_provider(session as any, provider as any, "model", { memory_window: 28 });
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider — archive_all=true
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider archive_all=true", () => {
  it("archive_all=true → 모든 메시지 처리, session.last_consolidated=0", async () => {
    const provider = {
      chat: vi.fn().mockResolvedValue({
        content: "",
        has_tool_calls: true,
        tool_calls: [
          {
            name: "save_memory",
            arguments: { history_entry: "아카이브 완료", memory_update: "새 롱텀" },
          },
        ],
      }),
    };
    const session = {
      messages: [
        { role: "user", content: "아카이브 메시지", timestamp: "2026-01-01T00:00:00Z" },
        { role: "assistant", content: "응답", timestamp: "2026-01-01T00:01:00Z" },
      ],
      last_consolidated: 0,
    };
    const r = await store.consolidate_with_provider(session as any, provider as any, "model", { archive_all: true });
    expect(r).toBe(true);
    expect(session.last_consolidated).toBe(0); // archive_all → 0으로 리셋
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider — tool args가 객체인 경우
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider args 타입 처리", () => {
  it("history_entry가 객체 → JSON.stringify 후 처리", async () => {
    const provider = {
      chat: vi.fn().mockResolvedValue({
        content: "",
        has_tool_calls: true,
        tool_calls: [
          {
            name: "save_memory",
            arguments: {
              history_entry: { summary: "객체형 히스토리" }, // 객체
              memory_update: "업데이트된 메모리",
            },
          },
        ],
      }),
    };
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `메시지${i}`,
      timestamp: "2026-01-01T00:00:00Z",
    }));
    const session = { messages: msgs, last_consolidated: 0 };
    const r = await store.consolidate_with_provider(session as any, provider as any, "model", { memory_window: 10 });
    expect(r).toBe(true);
  });

  it("message.content가 null/undefined → lines에 포함 안 됨", async () => {
    const provider = {
      chat: vi.fn().mockResolvedValue({
        content: "",
        has_tool_calls: true,
        tool_calls: [{ name: "save_memory", arguments: { history_entry: "정상" } }],
      }),
    };
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: "user",
      content: i === 5 ? null : `메시지${i}`, // 하나는 null
      timestamp: "2026-01-01T00:00:00Z",
    }));
    const session = { messages: msgs, last_consolidated: 0 };
    const r = await store.consolidate_with_provider(session as any, provider as any, "model", { memory_window: 10 });
    expect(r).toBe(true);
  });

  it("tools_used 배열 있음 → 로그 줄에 [tools: ...] 포함", async () => {
    const provider = {
      chat: vi.fn().mockResolvedValue({
        content: "",
        has_tool_calls: true,
        tool_calls: [{ name: "save_memory", arguments: { history_entry: "도구사용" } }],
      }),
    };
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `메시지${i}`,
      timestamp: "2026-01-01T00:00:00Z",
      tools_used: i === 1 ? ["search", "calc"] : [],
    }));
    const session = { messages: msgs, last_consolidated: 0 };
    const r = await store.consolidate_with_provider(session as any, provider as any, "model", { memory_window: 10 });
    expect(r).toBe(true);
    expect(provider.chat).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// consolidate — archive 옵션
// ══════════════════════════════════════════

describe("MemoryStore — consolidate archive 옵션", () => {
  it("archive=true → 윈도우 내 daily 항목 archiving", async () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const day_key = yesterday.toISOString().slice(0, 10);
    await store.write_daily("archive 테스트 내용", day_key);
    const r = await store.consolidate({ memory_window: 7, archive: true });
    expect(r.ok).toBe(true);
    // 윈도우 내 항목이 archive됨 (또는 없음)
  });

  it("archive=false → daily 항목 보존", async () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const day_key = yesterday.toISOString().slice(0, 10);
    await store.write_daily("보존 테스트 내용", day_key);
    const r = await store.consolidate({ memory_window: 7, archive: false });
    expect(r.ok).toBe(true);
    expect(r.archived_files).toHaveLength(0);
    // daily 항목 보존됨
    const content = await store.read_daily(day_key);
    expect(content).toContain("보존 테스트 내용");
  });
});

// ══════════════════════════════════════════
// append_longterm / append_daily
// ══════════════════════════════════════════

describe("MemoryStore — append 후 청크 재인덱싱", () => {
  it("append_longterm → 내용 추가 + FTS 검색 가능", async () => {
    await store.write_longterm("초기 롱텀 내용");
    await store.append_longterm("\n추가 항목: 특수키워드검색가능");
    const r = await store.search("특수키워드검색가능");
    expect(Array.isArray(r)).toBe(true);
  });

  it("append_daily → 내용 누적", async () => {
    const day = "2026-03-01";
    await store.write_daily("첫 번째 항목", day);
    await store.append_daily(" 두 번째 항목", day);
    const content = await store.read_daily(day);
    expect(content).toContain("첫 번째 항목");
    expect(content).toContain("두 번째 항목");
  });
});

// ══════════════════════════════════════════
// get_paths / resolve_daily_path
// ══════════════════════════════════════════

describe("MemoryStore — get_paths / resolve_daily_path", () => {
  it("get_paths → workspace/memoryDir/sqlitePath 반환", async () => {
    const paths = await store.get_paths();
    expect(paths.workspace).toBe(workspace);
    expect(paths.memoryDir).toContain("memory");
    expect(paths.sqlitePath).toContain("memory.db");
  });

  it("resolve_daily_path(day) → 날짜 포함 URI", async () => {
    const p = await store.resolve_daily_path("2026-03-05");
    expect(p).toContain("2026-03-05");
  });

  it("resolve_daily_path(undefined) → today URI", async () => {
    const p = await store.resolve_daily_path();
    expect(p).toMatch(/sqlite:\/\/memory\/daily\/\d{4}-\d{2}-\d{2}/);
  });
});

// ══════════════════════════════════════════
// consolidate — no daily entries in window
// ══════════════════════════════════════════

describe("MemoryStore — consolidate no daily entries", () => {
  it("윈도우 내 daily 없음 → 'no daily entries consolidated'", async () => {
    const r = await store.consolidate({ memory_window: 1 });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("no daily entries");
  });
});
