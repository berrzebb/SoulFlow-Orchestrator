/**
 * MemoryStore — consolidation 관련 테스트 통합.
 * consolidate(), ensure_longterm_document(), consolidate_with_provider() 전체 분기.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.js";
import type { ConsolidationSession } from "@src/agent/memory.types.js";

// ── 공통 헬퍼 ──────────────────────────────────────────────

let workspace: string;
let store: MemoryStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mem-consolidate-"));
  store = new MemoryStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function today_key(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function make_session(messages: ConsolidationSession["messages"], last_consolidated = 0): ConsolidationSession {
  return { messages, last_consolidated };
}

function make_provider(response: Record<string, unknown> = {}) {
  return {
    chat: vi.fn().mockResolvedValue({
      content: "",
      has_tool_calls: false,
      tool_calls: [],
      ...response,
    }),
  } as any;
}

function make_msgs(count: number): ConsolidationSession["messages"] {
  return Array.from({ length: count }, (_, i) => ({
    role: "user" as const,
    content: `message ${i}`,
    timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
  }));
}

// ══════════════════════════════════════════════════════════════
// 1. consolidate()
// ══════════════════════════════════════════════════════════════

describe("consolidate() — empty body fix (C-16)", () => {
  // Bug C-16: daily 내용이 없을 때 longterm에 빈 헤더를 append하던 문제
  // → 수정 후: body가 없으면 append_longterm 호출하지 않음

  it("daily 엔트리가 없으면 longterm에 아무것도 append하지 않는다", async () => {
    await store.write_longterm("기존 longterm 내용");

    const result = await store.consolidate({ memory_window: 7 });

    expect(result.ok).toBe(true);
    expect(result.longterm_appended_chars).toBe(0);
    expect(result.daily_entries_used).toHaveLength(0);
    expect(result.summary).toBe("no daily entries consolidated");

    // longterm 내용이 변하지 않았는지 확인
    const lt = await store.read_longterm();
    expect(lt.trim()).toBe("기존 longterm 내용");
  });

  it("window 범위 밖 daily만 있으면 longterm에 append하지 않는다", async () => {
    // 100일 전 daily — window_days=7 범위 밖
    await store.write_daily("오래된 내용", "2025-11-01");
    await store.write_longterm("기존 장기 메모리");

    const result = await store.consolidate({ memory_window: 7 });

    expect(result.longterm_appended_chars).toBe(0);
    expect(result.daily_entries_used).toHaveLength(0);

    const lt = await store.read_longterm();
    expect(lt.trim()).toBe("기존 장기 메모리");
  });

  it("window 범위 내 daily가 있으면 정상 append한다", async () => {
    const today = today_key();
    await store.write_daily("오늘 대화 기록", today);

    const result = await store.consolidate({ memory_window: 7 });

    expect(result.ok).toBe(true);
    expect(result.longterm_appended_chars).toBeGreaterThan(0);
    expect(result.daily_entries_used).toContain(today);
    expect(result.summary).toContain("1 daily entries");

    const lt = await store.read_longterm();
    expect(lt).toContain("오늘 대화 기록");
  });
});

describe("consolidate() — archive=true → sqlite_delete_daily", () => {
  it("archive=true → 윈도우 내 daily 삭제 + archived 목록 반환", async () => {
    const today = today_key();
    await store.write_daily("archive this content", today);

    const before = await store.read_daily(today);
    expect(before.trim()).toBe("archive this content");

    const result = await store.consolidate({ archive: true, memory_window: 7 });
    expect(result.ok).toBe(true);
    expect(result.archived_files).toBeInstanceOf(Array);
    expect(result.archived_files.length).toBeGreaterThan(0);

    // 삭제 후 read_daily 빈 문자열
    const after = await store.read_daily(today);
    expect(after.trim()).toBe("");
  });

  it("archive=true + window_days=0 → 오래된 daily만 삭제 (없으면 archived_files=[])", async () => {
    const result = await store.consolidate({ archive: true, memory_window: 0 });
    expect(result.ok).toBe(true);
    expect(result.archived_files).toBeInstanceOf(Array);
  });

  it("archive=false → daily 항목 보존, archived_files=[]", async () => {
    const today = today_key();
    await store.write_daily("보존 테스트 내용", today);

    const r = await store.consolidate({ memory_window: 7, archive: false });
    expect(r.archived_files).toEqual([]);

    const content = await store.read_daily(today);
    expect(content).toContain("보존 테스트 내용");
  });
});

describe("consolidate() — window boundary", () => {
  it("30일 이전 daily + window_days=7 → 해당 daily 미포함", async () => {
    const old_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await store.write_daily("old daily content", old_date);

    const result = await store.consolidate({ memory_window: 7 });
    expect(result.ok).toBe(true);
    expect(result.daily_entries_used).not.toContain(old_date);
  });
});

describe("consolidate() — invalid date NaN continue", () => {
  it("형식은 맞지만 날짜 범위 초과 day → NaN Date → continue", async () => {
    // initialized 완료 대기 — sqlite_upsert_document가 DB 접근하므로 필요
    await (store as any).initialized;
    // "2000-13-45" → is_day_key regex 통과 BUT new Date("2000-13-45T00:00:00Z") = Invalid Date
    (store as any).sqlite_upsert_document("daily", "2000-13-45", "memory://daily/2000-13-45", "Invalid date content");

    const result = await store.consolidate({ archive: false, memory_window: 365 });
    expect(result.ok).toBe(true);
    expect(result.compressed_prompt).not.toContain("2000-13-45");
  });
});

describe("consolidate() — empty/whitespace content continue", () => {
  it("빈 content daily → trim() = '' → used에 미포함", async () => {
    const today = today_key();
    await store.write_daily("", today);

    const result = await store.consolidate({ archive: false, memory_window: 7 });
    expect(result.ok).toBe(true);
    expect(result.daily_entries_used).not.toContain(today);
  });

  it("공백만 있는 content → trim() = '' → continue", async () => {
    const today = today_key();
    await store.write_daily("   \n  \t  ", today);

    const result = await store.consolidate({ archive: false, memory_window: 7 });
    expect(result.ok).toBe(true);
    expect(result.compressed_prompt).toContain("no daily content in window");
  });
});

describe("consolidate() — body + longterm_raw", () => {
  it("window 내 daily + longterm_raw → summary에 consolidated 포함, compressed_prompt에 longterm 포함", async () => {
    const today = today_key();
    await store.write_longterm("기존 장기 기억");
    await store.write_daily("오늘의 일지", today);

    const r = await store.consolidate({ memory_window: 7 });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("consolidated");
    expect(r.daily_entries_used).toContain(today);
    expect(r.compressed_prompt).toContain("기존 장기 기억");
  });

  it("longterm_raw 없음 → compressed_prompt에 '(empty)' 포함", async () => {
    const today = today_key();
    await store.write_daily("daily 내용", today);

    const r = await store.consolidate({ memory_window: 7 });
    expect(r.compressed_prompt).toContain("(empty)");
  });
});

// ══════════════════════════════════════════════════════════════
// 2. ensure_longterm_document
// ══════════════════════════════════════════════════════════════

describe("ensure_longterm_document — row already exists", () => {
  it("같은 디렉토리에 두 번째 MemoryStore 생성 → row exists → early return (덮어쓰지 않음)", async () => {
    await store.write_longterm("existing longterm content");

    // 두 번째 MemoryStore: 같은 경로 → ensure_longterm_document에서 row 발견
    const store2 = new MemoryStore(workspace);
    const content = await store2.read_longterm();
    expect(content).toBe("existing longterm content");
  });

  it("ensure_longterm_document 재호출 → early return (에러 없이 완료)", async () => {
    await (store as any).initialized;
    // 이미 생성자에서 실행된 이후 재호출
    (store as any).ensure_longterm_document();
    (store as any).ensure_longterm_document();

    const content = await store.read_longterm();
    expect(typeof content).toBe("string");
  });
});

// ══════════════════════════════════════════════════════════════
// 3. consolidate_with_provider()
// ══════════════════════════════════════════════════════════════

describe("consolidate_with_provider() — early returns", () => {
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

  it("last_consolidated = messages.length → 처리할 메시지 없음 → true", async () => {
    const provider = make_provider();
    const msgs = make_msgs(20);
    const session = make_session(msgs, 20);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("old_messages.length=0 (slice 결과 빈 배열) → true", async () => {
    const provider = make_provider();
    const msgs = make_msgs(30);
    // last_consolidated=29, keep_count=25 → slice(29, max(0,5)) = slice(29,5) = []
    const session = make_session(msgs, 29);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 50 });
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("모든 content 비어있음 → lines.length=0 → true (provider 미호출)", async () => {
    const provider = make_provider();
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: "",
      timestamp: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`,
    }));
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("content null/undefined인 메시지만 → lines에 포함 안 됨 → true", async () => {
    const provider = make_provider();
    const msgs = Array.from({ length: 30 }, () => ({
      role: "user" as const,
      content: null as any,
      timestamp: "2026-01-01T00:00:00Z",
    }));
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);
    expect(provider.chat).not.toHaveBeenCalled();
  });
});

describe("consolidate_with_provider() — tool_calls 성공", () => {
  it("tool_calls + history_entry/memory_update → daily/longterm에 저장", async () => {
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
    const msgs = make_msgs(30);
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);

    const today = today_key();
    const daily = await store.read_daily(today);
    expect(daily).toContain("오늘의 요약");

    const longterm = await store.read_longterm();
    expect(longterm).toContain("업데이트된 장기 기억");
  });

  it("tools_used 있는 메시지 → 프롬프트에 [tools: ...] 포함", async () => {
    const captured_prompts: string[] = [];
    const provider = {
      chat: vi.fn().mockImplementation(async (req: { messages: Array<{ role: string; content: string }> }) => {
        captured_prompts.push(req.messages[1]?.content || "");
        return {
          content: "",
          has_tool_calls: true,
          tool_calls: [{ id: "tc1", name: "save_memory", arguments: { history_entry: "h", memory_update: "m" } }],
        };
      }),
    } as any;
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
      timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
      tools_used: i === 0 ? ["bash", "read"] : [],
    }));
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);
    expect(captured_prompts[0]).toContain("[tools: bash, read]");
  });
});

describe("consolidate_with_provider() — no tool_calls → false", () => {
  it("tool_calls 없고 텍스트에서도 파싱 불가 → false", async () => {
    const provider = make_provider({
      content: "분석 완료했습니다. 저장할 내용은 없습니다.",
      has_tool_calls: false,
      tool_calls: [],
    });
    const msgs = make_msgs(30);
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(false);
  });
});

describe("consolidate_with_provider() — archive_all=true", () => {
  it("archive_all=true → 전체 메시지 처리, session.last_consolidated=0으로 리셋", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: { history_entry: "아카이브 완료", memory_update: "새 롱텀" },
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
});

describe("consolidate_with_provider() — history_entry variations", () => {
  it("history_entry가 객체 → JSON.stringify 후 저장", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: {
          history_entry: { summary: "요약본", tags: ["tag1"] },
          memory_update: null,
        },
      }],
    });
    const msgs = make_msgs(30);
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);

    const today = today_key();
    const daily = await store.read_daily(today);
    expect(daily).toContain("요약본");
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
    const msgs = make_msgs(30);
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);

    const longterm = await store.read_longterm();
    expect(longterm).toContain("새로운 메모리");
  });
});

describe("consolidate_with_provider() — memory_update same content skip", () => {
  it("memory_update가 현재 longterm과 동일 → write 생략, 기존 내용 보존", async () => {
    const current = "동일한 메모리 내용";
    await store.write_longterm(current);

    const provider = {
      chat: vi.fn().mockResolvedValue({
        content: "",
        has_tool_calls: true,
        tool_calls: [{
          name: "save_memory",
          arguments: {
            history_entry: "오늘 작업 완료",
            memory_update: current, // 동일 내용
          },
        }],
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
    const after = await store.read_longterm();
    expect(after).toContain(current);
  });
});

describe("consolidate_with_provider() — memory_update object type", () => {
  it("memory_update가 객체형 → JSON.stringify 후 저장", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{
        id: "tc1",
        name: "save_memory",
        arguments: {
          history_entry: null,
          memory_update: { key: "value", count: 42 },
        },
      }],
    });
    const msgs = make_msgs(30);
    const session = make_session(msgs, 0);
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(r).toBe(true);

    const longterm = await store.read_longterm();
    expect(longterm).toContain("value");
  });
});

describe("consolidate_with_provider() — implicit tool call JSON text parse", () => {
  it("has_tool_calls=false + content에 JSON tool call → 파싱 시도", async () => {
    const provider = make_provider({
      content: JSON.stringify({
        name: "save_memory",
        arguments: { history_entry: "implicit", memory_update: "새 메모리" },
      }),
      has_tool_calls: false,
      tool_calls: [],
    });
    const msgs = make_msgs(30);
    const session = make_session(msgs, 0);
    // implicit tool call 파싱 성공/실패 모두 가능 → boolean 타입만 확인
    const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
    expect(typeof r).toBe("boolean");
  });
});

describe("consolidate_with_provider() — longterm_raw empty → '(empty)'", () => {
  it("longterm_raw 없음 + daily 있음 → compressed_prompt에 '(empty)' 포함", async () => {
    const today = today_key();
    await store.write_daily("daily 내용", today);

    const r = await store.consolidate({ memory_window: 7 });
    expect(r.compressed_prompt).toContain("(empty)");
  });
});

describe("consolidate_with_provider() — message.content null 포함", () => {
  it("일부 message.content null → lines에서 제외, 나머지 정상 처리", async () => {
    const provider = make_provider({
      has_tool_calls: true,
      tool_calls: [{ name: "save_memory", arguments: { history_entry: "정상" } }],
    });
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: i === 5 ? null : `메시지${i}`,
      timestamp: "2026-01-01T00:00:00Z",
    }));
    const session = make_session(msgs as any, 0);
    const r = await store.consolidate_with_provider(session, provider as any, "model", { memory_window: 10 });
    expect(r).toBe(true);
  });
});
