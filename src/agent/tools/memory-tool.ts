import type { MemoryStoreLike } from "../memory.js";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

/** 오케스트레이터가 메모리를 직접 조회·검색·추가할 수 있는 도구. */
export class MemoryTool extends Tool {
  readonly name = "memory";
  readonly description = "메모리 조회·검색·추가. action=search|read_longterm|read_daily|list_daily|append_daily";
  readonly parameters: JsonSchema = {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["search", "read_longterm", "read_daily", "list_daily", "append_daily"] },
      query: { type: "string", description: "search 시 검색어" },
      day: { type: "string", description: "YYYY-MM-DD 형식 날짜 (read_daily/append_daily)" },
      content: { type: "string", description: "append_daily 시 추가할 내용" },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "search 결과 최대 수 (기본 20)" },
    },
  };

  private readonly store: MemoryStoreLike;

  constructor(store: MemoryStoreLike) {
    super();
    this.store = store;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "").trim();

    if (action === "search") {
      const query = String(params.query || "").trim();
      if (!query) return "Error: query is required for search";
      const limit = Math.min(200, Math.max(1, Number(params.limit) || 20));
      const results = await this.store.search(query, { limit });
      if (results.length === 0) return `검색 결과 없음: "${query}"`;
      return results.map((r) => `[${r.file}:${r.line}] ${r.text}`).join("\n");
    }

    if (action === "read_longterm") {
      const content = await this.store.read_longterm();
      return content || "(장기 메모리 비어 있음)";
    }

    if (action === "read_daily") {
      const day = String(params.day || "").trim() || undefined;
      const content = await this.store.read_daily(day);
      return content || `(일별 메모리 비어 있음${day ? `: ${day}` : ""})`;
    }

    if (action === "list_daily") {
      const days = await this.store.list_daily();
      if (days.length === 0) return "(일별 메모리 없음)";
      return days.join("\n");
    }

    if (action === "append_daily") {
      const content = String(params.content || "").trim();
      if (!content) return "Error: content is required for append_daily";
      const day = String(params.day || "").trim() || undefined;
      await this.store.append_daily(content, day);
      return "일별 메모리에 추가 완료.";
    }

    return `Error: unknown action "${action}"`;
  }
}
