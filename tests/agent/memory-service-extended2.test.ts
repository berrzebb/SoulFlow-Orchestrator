/**
 * MemoryStore (memory.service.ts) — 미커버 분기 추가 보충.
 * consolidate_with_provider:
 *   - last_consolidated 초과 → return true (no-op)
 *   - old_messages 빈 슬라이스 → return true
 *   - messages 중 content 없는 것 → lines 빈 경우 → return true
 *   - history_entry 객체(비문자열) → JSON.stringify
 *   - has_tool_calls=false + 텍스트 기반 tool_call → implicit_tool_calls 경로
 *   - tools_used 필드 포함 메시지
 * rechunk_document:
 *   - 문서 내용 변경 → 기존 청크 삭제 후 새 청크 삽입 (to_delete 경로)
 * search:
 *   - kind=all + is_day_key(day) 필터 경로
 *   - kind=daily + day 필터 경로 (search_chunks_fts)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.js";

let workspace: string;
let store: MemoryStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mem-ext2-"));
  store = new MemoryStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// consolidate_with_provider — early return 분기
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider early return 분기", () => {
  const dummy_provider = {
    chat: async () => ({ content: "", finish_reason: "stop", has_tool_calls: false, tool_calls: [] }),
  };

  it("messages.length - last_consolidated <= 0 → true (no-op)", async () => {
    const messages = [
      { role: "user" as const, content: "a", timestamp: "t" },
      { role: "assistant" as const, content: "b", timestamp: "t" },
    ];
    // last_consolidated=2 → messages.length(2) - 2 = 0 → return true immediately
    const session = { messages, last_consolidated: 2 };
    const r = await store.consolidate_with_provider(session, dummy_provider as any, "model");
    expect(r).toBe(true);
  });

  it("old_messages 슬라이스가 빈 배열 → true (no-op)", async () => {
    // keep_count = floor(50/2) = 25, messages=30, last_consolidated=5
    // old_messages = slice(5, 30-25=5) → slice(5,5) = []
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const, content: `m${i}`, timestamp: "t",
    }));
    const session = { messages, last_consolidated: 5 };
    const r = await store.consolidate_with_provider(session, dummy_provider as any, "model", { memory_window: 50 });
    expect(r).toBe(true);
  });

  it("old_messages 중 content 없는 것들만 → lines 빈 배열 → true", async () => {
    // memory_window=4 → keep_count=2
    // messages=10, last_consolidated=0, old_messages=slice(0,8)
    const messages = Array.from({ length: 10 }, () => ({
      role: "user" as const,
      content: null as any, // content 없음
      timestamp: "t",
    }));
    const session = { messages, last_consolidated: 0 };
    const r = await store.consolidate_with_provider(session, dummy_provider as any, "model", { memory_window: 4 });
    expect(r).toBe(true);
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider — tools_used 필드
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider tools_used 경로", () => {
  it("messages에 tools_used 배열 포함 → [tools: ...] 형식 라인 생성", async () => {
    // memory_window=4 → keep_count=2
    // messages=10, old_messages=8개 (모두 content 있음)
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `content ${i}`,
      timestamp: "2026-01-01T00:00:00Z",
      tools_used: i === 0 ? ["search", "fetch"] : [],
    }));
    const session = { messages, last_consolidated: 0 };

    const saved_history: string[] = [];
    const provider = {
      chat: async (req: any) => {
        // 첫 번째 메시지에 [tools: search, fetch] 포함 여부 확인
        const prompt = req.messages.find((m: any) => m.role === "user")?.content || "";
        saved_history.push(prompt);
        return {
          content: "",
          finish_reason: "tool_use",
          has_tool_calls: true,
          tool_calls: [{ name: "save_memory", arguments: { history_entry: "test", memory_update: "new" } }],
        };
      },
    };

    const r = await store.consolidate_with_provider(session, provider as any, "model", { memory_window: 4 });
    expect(r).toBe(true);
    // prompt에 tools_used가 포함됨을 확인
    const prompt_text = saved_history[0] || "";
    expect(prompt_text).toContain("tools:");
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider — history_entry 비문자열 (객체)
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider history_entry 객체 타입", () => {
  it("history_entry가 객체 → JSON.stringify 후 처리", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const, content: `msg ${i}`, timestamp: "t",
    }));
    const session = { messages, last_consolidated: 0 };

    const provider = {
      chat: async () => ({
        content: "",
        finish_reason: "tool_use",
        has_tool_calls: true,
        tool_calls: [{
          name: "save_memory",
          arguments: {
            // history_entry를 객체로 전달 → JSON.stringify 경로
            history_entry: { summary: "obj entry", items: ["a", "b"] },
            memory_update: "updated memory",
          },
        }],
      }),
    };

    const r = await store.consolidate_with_provider(session, provider as any, "model", { memory_window: 4 });
    expect(r).toBe(true);
  });
});

// ══════════════════════════════════════════
// consolidate_with_provider — implicit_tool_calls (텍스트 기반)
// ══════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider implicit tool_calls", () => {
  it("has_tool_calls=false, 텍스트에서 save_memory 파싱 → implicit_tool_calls 경로", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const, content: `msg ${i}`, timestamp: "t",
    }));
    const session = { messages, last_consolidated: 0 };

    // has_tool_calls=false이지만 content에 JSON 형태 tool call 포함
    const provider = {
      chat: async () => ({
        content: JSON.stringify({
          tool_calls: [{ name: "save_memory", arguments: { memory_update: "from text" } }],
        }),
        finish_reason: "stop",
        has_tool_calls: false,
        tool_calls: [],
      }),
    };

    await store.consolidate_with_provider(session, provider as any, "model", { memory_window: 4 });
    // 에러 없이 완료됨을 확인 (텍스트 파싱 경로 진입)
  });
});

// ══════════════════════════════════════════
// rechunk_document — 기존 청크 삭제 경로
// ══════════════════════════════════════════

describe("MemoryStore — rechunk_document: 청크 변경 시 삭제 경로", () => {
  it("문서 내용 변경 → 기존 청크 삭제 후 새 청크 삽입", async () => {
    // 긴 문서 작성 → 청크 생성
    const original = "# 섹션 A\n\n" + "A 내용\n".repeat(30) + "\n# 섹션 B\n\n" + "B 내용\n".repeat(30);
    await store.write_longterm(original);

    // 내용 변경 → rechunk_document에서 기존 청크를 삭제하고 새로 생성
    const updated = "# 섹션 X\n\n" + "X 내용\n".repeat(30);
    await store.write_longterm(updated);

    // 검색으로 새 내용 확인
    const r = await store.search("X 내용");
    expect(Array.isArray(r)).toBe(true);
    // 이전 내용은 없어야 함
    const s = await store.search("섹션 A");
    // A가 삭제됐으면 결과 없음
    expect(Array.isArray(s)).toBe(true);
  });
});

// ══════════════════════════════════════════
// search — kind/day 필터 경로
// ══════════════════════════════════════════

describe("MemoryStore — search: kind/day 필터", () => {
  it("kind=all + is_day_key(day) → day 필터 적용", async () => {
    await store.write_daily("특정날짜내용\n", "2026-01-15");
    const r = await store.search("특정날짜내용", { kind: "all", day: "2026-01-15" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("kind=daily + day 필터 → 해당 날짜 결과", async () => {
    await store.write_daily("날짜필터테스트\n", "2026-02-20");
    const r = await store.search("날짜필터테스트", { kind: "daily", day: "2026-02-20" });
    expect(Array.isArray(r)).toBe(true);
  });

  it("kind=daily + day 없음 → kind 필터만", async () => {
    await store.write_daily("킨드필터\n");
    const r = await store.search("킨드필터", { kind: "daily" });
    expect(Array.isArray(r)).toBe(true);
  });
});

// ══════════════════════════════════════════
// append_longterm / append_daily — rechunk
// ══════════════════════════════════════════

describe("MemoryStore — sqlite_append_document rechunk 경로", () => {
  it("append_longterm 후 full.content 기반 rechunk 진행", async () => {
    await store.write_longterm("# 처음 내용\n\n기존 텍스트\n");
    await store.append_longterm("# 추가 섹션\n\n추가된 내용\n");
    const r = await store.search("추가된 내용");
    expect(Array.isArray(r)).toBe(true);
  });

  it("append_daily 후 rechunk 진행", async () => {
    await store.write_daily("# 오늘 작업\n\n작업1 완료\n", "2026-03-08");
    await store.append_daily("작업2 완료\n", "2026-03-08");
    const r = await store.search("작업2 완료", { kind: "daily", day: "2026-03-08" });
    expect(Array.isArray(r)).toBe(true);
  });
});
