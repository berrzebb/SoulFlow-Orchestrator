/**
 * MemoryTool 커버리지 — search/read_longterm/write_longterm/append_longterm/daily 작업.
 */
import { describe, it, expect, vi } from "vitest";
import { MemoryTool } from "@src/agent/tools/memory-tool.js";
import type { MemoryStoreLike } from "@src/agent/memory.types.js";

function make_store(): MemoryStoreLike & {
  _longterm: string;
  _daily: Map<string, string>;
} {
  const _longterm = { value: "" };
  const _daily = new Map<string, string>();

  return {
    _longterm: _longterm as unknown as string,
    _daily,
    async list_daily() { return [..._daily.keys()]; },
    async read_longterm() { return _longterm.value; },
    async write_longterm(content: string) { _longterm.value = content; },
    async append_longterm(content: string) { _longterm.value += content; },
    async read_daily(day?: string) { return _daily.get(day || "today") || ""; },
    async write_daily(content: string, day?: string) { _daily.set(day || "today", content); },
    async append_daily(content: string, day?: string) {
      const key = day || "today";
      _daily.set(key, (_daily.get(key) || "") + content);
    },
    async search(query: string, args?: { limit?: number }) {
      if (query === "empty_result") return [];
      const limit = args?.limit || 20;
      return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
        file: `memory://longterm.md`,
        line: i + 1,
        text: `Result ${i + 1} for: ${query}`,
      }));
    },
  };
}

describe("MemoryTool — 메타데이터", () => {
  it("name = memory", () => {
    expect(new MemoryTool(make_store()).name).toBe("memory");
  });

  it("category = memory", () => {
    expect(new MemoryTool(make_store()).category).toBe("memory");
  });

  it("to_schema: function 형식", () => {
    expect(new MemoryTool(make_store()).to_schema().type).toBe("function");
  });
});

describe("MemoryTool — search", () => {
  it("결과 있음 → 결과 텍스트 반환", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "search", query: "테스트" });
    expect(result).toContain("Result 1 for: 테스트");
  });

  it("결과 없음 → '검색 결과 없음' 반환", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "search", query: "empty_result" });
    expect(result).toContain("검색 결과 없음");
  });

  it("query 없음 → Error 반환", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "search", query: "" });
    expect(result).toContain("Error");
    expect(result).toContain("query");
  });

  it("limit 파라미터 적용", async () => {
    const store = make_store();
    const tool = new MemoryTool(store);
    // limit=1 → 최대 1개 반환
    const result = await tool.execute({ action: "search", query: "test", limit: 1 });
    expect(result.split("\n").length).toBe(1);
  });
});

describe("MemoryTool — read_longterm", () => {
  it("내용 있음 → 반환", async () => {
    const store = make_store();
    await store.write_longterm("테스트 장기 메모리");
    const tool = new MemoryTool(store);
    const result = await tool.execute({ action: "read_longterm" });
    expect(result).toContain("테스트 장기 메모리");
  });

  it("내용 없음 → 비어있음 메시지", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "read_longterm" });
    expect(result).toContain("비어 있음");
  });
});

describe("MemoryTool — append_longterm", () => {
  it("내용 추가 성공", async () => {
    const store = make_store();
    await store.write_longterm("기존\n");
    const tool = new MemoryTool(store);
    const result = await tool.execute({ action: "append_longterm", content: "추가됨" });
    expect(result).toContain("추가 완료");
  });

  it("content 없음 → Error", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "append_longterm", content: "" });
    expect(result).toContain("Error");
  });
});

describe("MemoryTool — read_daily", () => {
  it("특정 날짜 조회", async () => {
    const store = make_store();
    await store.write_daily("오늘 메모", "2024-01-01");
    const tool = new MemoryTool(store);
    const result = await tool.execute({ action: "read_daily", day: "2024-01-01" });
    expect(result).toContain("오늘 메모");
  });

  it("내용 없음 → 비어있음 메시지", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "read_daily", day: "2099-01-01" });
    expect(result).toContain("비어 있음");
    expect(result).toContain("2099-01-01");
  });

  it("day 없이 호출", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "read_daily" });
    expect(typeof result).toBe("string");
  });
});

describe("MemoryTool — list_daily", () => {
  it("목록 없음 → 없음 메시지", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "list_daily" });
    expect(result).toContain("없음");
  });

  it("목록 있음 → 날짜 목록 반환", async () => {
    const store = make_store();
    await store.write_daily("기록", "2024-01-01");
    await store.write_daily("기록", "2024-01-02");
    const tool = new MemoryTool(store);
    const result = await tool.execute({ action: "list_daily" });
    expect(result).toContain("2024-01-01");
    expect(result).toContain("2024-01-02");
  });
});

describe("MemoryTool — append_daily", () => {
  it("일별 메모리에 추가", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "append_daily", content: "오늘 기록", day: "2024-01-01" });
    expect(result).toContain("추가 완료");
  });

  it("content 없음 → Error", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "append_daily", content: "" });
    expect(result).toContain("Error");
  });

  it("day 없이 추가", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "append_daily", content: "메모" });
    expect(result).toContain("추가 완료");
  });
});

describe("MemoryTool — 알 수 없는 액션", () => {
  it("unknown action → Error 반환", async () => {
    const tool = new MemoryTool(make_store());
    const result = await tool.execute({ action: "unknown_action" });
    expect(result).toContain("Error");
    expect(result).toContain("unknown action");
  });
});

describe("MemoryTool — validate_params", () => {
  it("action 없으면 에러", () => {
    const tool = new MemoryTool(make_store());
    const errors = tool.validate_params({});
    expect(errors.some((e) => e.includes("action"))).toBe(true);
  });

  it("action 있으면 에러 없음", () => {
    const tool = new MemoryTool(make_store());
    const errors = tool.validate_params({ action: "search" });
    expect(errors).toHaveLength(0);
  });
});
