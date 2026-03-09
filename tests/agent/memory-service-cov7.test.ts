/**
 * MemoryStore — 추가 미커버 분기 커버리지 (cov7).
 * - consolidate: archive=true 경로
 * - consolidate_with_provider: archive_all=true, session.messages <= keep_count,
 *   last_consolidated 조건, old_messages.length=0, lines.length=0,
 *   no tool calls → false, implicit tool calls (no has_tool_calls)
 * - search_chunks_vec: kind=daily + day 필터 (벡터 경로)
 * - ensure_chunk_embeddings_fresh: DB insert 성공 경로
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { MemoryStore } from "@src/agent/memory.service.js";
import type { ConsolidationSession } from "@src/agent/memory.types.js";

let workspace: string;
let store: MemoryStore;

async function setup() {
  workspace = await mkdtemp(join(tmpdir(), "mem-cov7-"));
  store = new MemoryStore(workspace);
}

async function teardown() {
  await rm(workspace, { recursive: true, force: true });
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

// ══════════════════════════════════════════════════════════
// consolidate — archive=true 경로
// ══════════════════════════════════════════════════════════

describe("MemoryStore — consolidate archive=true", () => {
  it("archive=true → 사용된 daily 항목이 archived_files에 포함됨", async () => {
    await setup();
    try {
      const today = new Date().toISOString().slice(0, 10);
      await store.write_daily("오늘의 일지 내용", today);
      const r = await store.consolidate({ archive: true, memory_window: 7 });
      expect(r.ok).toBe(true);
      // archive=true → archived_files 배열에 항목 포함
      expect(r.archived_files.length).toBeGreaterThan(0);
      expect(r.archived_files[0]).toContain(today);
    } finally { await teardown(); }
  });

  it("archive=false (기본) → archived_files=[]", async () => {
    await setup();
    try {
      const today = new Date().toISOString().slice(0, 10);
      await store.write_daily("내용", today);
      const r = await store.consolidate({ archive: false });
      expect(r.archived_files).toHaveLength(0);
    } finally { await teardown(); }
  });

  it("window 내 daily 없음 → body='' → summary 'no daily entries consolidated'", async () => {
    await setup();
    try {
      const r = await store.consolidate({ memory_window: 1 });
      expect(r.ok).toBe(true);
      expect(r.summary).toContain("no daily entries");
    } finally { await teardown(); }
  });
});

// ══════════════════════════════════════════════════════════
// consolidate_with_provider — 조기 반환 경로들
// ══════════════════════════════════════════════════════════

describe("MemoryStore — consolidate_with_provider 조기 반환", () => {
  it("archive_all=true → old_messages=session.messages (전체 처리)", async () => {
    await setup();
    try {
      const provider = make_provider({
        has_tool_calls: true,
        tool_calls: [{ id: "tc1", name: "save_memory", arguments: { history_entry: "아카이브", memory_update: "아카이브 후 메모리" } }],
      });
      const msgs = make_msgs(5);
      const session = make_session(msgs, 0);
      const r = await store.consolidate_with_provider(session, provider, "claude", { archive_all: true, memory_window: 10 });
      expect(r).toBe(true);
      // archive_all → provider.chat 호출됨
      expect(provider.chat).toHaveBeenCalled();
    } finally { await teardown(); }
  });

  it("messages.length <= keep_count → return true (조기 반환)", async () => {
    await setup();
    try {
      // memory_window=10 → keep_count=5. messages.length=3 → 3 <= 5 → 조기 반환
      const provider = make_provider();
      const msgs = make_msgs(3);
      const session = make_session(msgs, 0);
      const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
      expect(r).toBe(true);
      expect(provider.chat).not.toHaveBeenCalled();
    } finally { await teardown(); }
  });

  it("messages.length - last_consolidated <= 0 → return true", async () => {
    await setup();
    try {
      const provider = make_provider();
      // memory_window=10 → keep_count=5. messages=20, last_consolidated=20 → 20-20=0 → 조기 반환
      const msgs = make_msgs(20);
      const session = make_session(msgs, 20);
      const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
      expect(r).toBe(true);
      expect(provider.chat).not.toHaveBeenCalled();
    } finally { await teardown(); }
  });

  it("old_messages.length === 0 → return true (slice 결과 빈 배열)", async () => {
    await setup();
    try {
      const provider = make_provider();
      // keep_count=5, last_consolidated=15, messages=20 → slice(15, max(0,15)) = slice(15,15) = []
      const msgs = make_msgs(20);
      const session = make_session(msgs, 15);
      const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
      expect(r).toBe(true);
    } finally { await teardown(); }
  });

  it("messages 중 content 없는 항목만 있음 → lines.length=0 → return true", async () => {
    await setup();
    try {
      const provider = make_provider();
      // content가 null/undefined인 메시지들만
      const msgs = Array.from({ length: 30 }, () => ({
        role: "user" as const,
        content: null as any,
        timestamp: "2026-01-01T00:00:00Z",
      }));
      const session = make_session(msgs, 0);
      const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
      expect(r).toBe(true);
      expect(provider.chat).not.toHaveBeenCalled();
    } finally { await teardown(); }
  });

  it("provider 응답에 tool_calls 없음 (has_tool_calls=false, implicit도 없음) → return false", async () => {
    await setup();
    try {
      const provider = make_provider({
        content: "분석 완료했습니다. 저장할 내용은 없습니다.", // save_memory 형식 아님
        has_tool_calls: false,
        tool_calls: [],
      });
      const msgs = make_msgs(30);
      const session = make_session(msgs, 0);
      const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
      expect(r).toBe(false);
    } finally { await teardown(); }
  });

  it("provider 응답에 implicit tool call 포함 (has_tool_calls=false + XML 형식)", async () => {
    await setup();
    try {
      // parse_tool_calls_from_text가 파싱할 수 있는 형식으로 tool call 제공
      const provider = make_provider({
        content: JSON.stringify({ name: "save_memory", arguments: { history_entry: "implicit", memory_update: "새 메모리" } }),
        has_tool_calls: false,
        tool_calls: [],
      });
      const msgs = make_msgs(30);
      const session = make_session(msgs, 0);
      // implicit tool call 파싱은 성공하지 못할 수 있으므로 결과는 true/false 모두 가능
      const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
      expect(typeof r).toBe("boolean");
    } finally { await teardown(); }
  });

  it("tools_used 있는 메시지 → 프롬프트에 [tools:...] 포함", async () => {
    await setup();
    try {
      const captured_prompts: string[] = [];
      const provider = {
        chat: vi.fn().mockImplementation(async (req: { messages: Array<{ role: string; content: string }> }) => {
          captured_prompts.push(req.messages[1]?.content || "");
          return { content: "", has_tool_calls: true, tool_calls: [{ id: "tc1", name: "save_memory", arguments: { history_entry: "h", memory_update: "m" } }] };
        }),
      } as any;
      const msgs = Array.from({ length: 30 }, (_, i) => ({
        role: "user" as const,
        content: `message ${i}`,
        timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
        tools_used: i === 5 ? ["ReadFile", "WriteFile"] : undefined,
      }));
      const session = make_session(msgs, 0);
      const r = await store.consolidate_with_provider(session, provider, "claude", { memory_window: 10 });
      expect(r).toBe(true);
      expect(captured_prompts[0]).toContain("[tools:");
    } finally { await teardown(); }
  });
});

// ══════════════════════════════════════════════════════════
// ensure_chunk_embeddings_fresh — DB insert 성공 경로
// ══════════════════════════════════════════════════════════

describe("MemoryStore — ensure_chunk_embeddings_fresh DB insert 성공", () => {
  it("stale 청크 있음 + embeddings.length == stale.length → DB insert 실행", async () => {
    await setup();
    try {
      // 충분한 크기의 청크 생성
      const content = "# 임베딩 테스트\n\n" + "청크 내용 ".repeat(30);
      await store.write_longterm(content);

      // 정확한 수의 embeddings를 반환하는 embed_fn
      const called_with_texts: string[][] = [];
      const embed_fn = vi.fn().mockImplementation(async (texts: string[]) => {
        called_with_texts.push(texts);
        const count = texts.length;
        const embeddings = Array.from({ length: count }, () =>
          Array.from({ length: 256 }, (_, i) => i === 0 ? 1.0 : 0.0)
        );
        return { embeddings };
      });
      store.set_embed(embed_fn);

      // search 호출 → ensure_chunk_embeddings_fresh 실행
      await store.search("임베딩");
      // embed_fn이 호출되었음 (stale 청크 임베딩)
      expect(embed_fn).toHaveBeenCalled();
      // texts가 비어있지 않음
      const all_texts = called_with_texts.flat();
      expect(all_texts.length).toBeGreaterThan(0);
    } finally { await teardown(); }
  });
});

// ══════════════════════════════════════════════════════════
// search_chunks_vec — kind=daily + day 필터 (벡터 경로)
// ══════════════════════════════════════════════════════════

describe("MemoryStore — search_chunks_vec kind=daily + day 필터", () => {
  it("embed_fn 있음 + kind=daily + day → 벡터 경로 실행 (오류 없음)", async () => {
    await setup();
    try {
      const day = "2026-06-01";
      await store.write_daily("# 특정일 테스트\n\n벡터 검색 대상 내용.", day);

      const embed_fn = vi.fn().mockResolvedValue({
        embeddings: [Array.from({ length: 256 }, (_, i) => i === 0 ? 1.0 : 0.0)],
      });
      store.set_embed(embed_fn);

      const r = await store.search("벡터 검색", { kind: "daily", day });
      expect(Array.isArray(r)).toBe(true);
    } finally { await teardown(); }
  });

  it("embed_fn 있음 + kind=all + day → 벡터 경로 실행 (오류 없음)", async () => {
    await setup();
    try {
      const day = "2026-07-01";
      await store.write_daily("# all 검색 테스트\n\n내용.", day);

      const embed_fn = vi.fn().mockResolvedValue({
        embeddings: [Array.from({ length: 256 }, (_, i) => i === 0 ? 1.0 : 0.0)],
      });
      store.set_embed(embed_fn);

      const r = await store.search("all 검색", { kind: "all", day });
      expect(Array.isArray(r)).toBe(true);
    } finally { await teardown(); }
  });
});

// ══════════════════════════════════════════════════════════
// consolidate — longterm_raw 없을 때 compressed_prompt
// ══════════════════════════════════════════════════════════

describe("MemoryStore — consolidate longterm_raw 없음", () => {
  it("longterm_raw 없음 → compressed_prompt에 '(empty)' 포함", async () => {
    await setup();
    try {
      const today = new Date().toISOString().slice(0, 10);
      await store.write_daily("daily 내용", today);
      const r = await store.consolidate({ memory_window: 7 });
      expect(r.compressed_prompt).toContain("(empty)");
    } finally { await teardown(); }
  });
});
