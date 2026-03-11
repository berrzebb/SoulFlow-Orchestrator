/**
 * ToolIndex — 미커버 분기 (cov3):
 * - L245: build() 같은 스키마 두 번 호출 → hash 캐시 → early return
 * - L349: KO_KEYWORD_MAP 한국어 키워드 포함 도구 → en_tags 추가
 * - L439, L442: category 폴백 루프 — max 도달 시 inner/outer break
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolIndex } from "@src/orchestration/tool-index.js";
import type { ToolSchema } from "@src/agent/tools/types.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

function make_tool(name: string, description: string): ToolSchema {
  return {
    function: { name, description, parameters: { type: "object", properties: {} } },
  };
}

let testDbPath: string;
let index: ToolIndex;

beforeEach(() => {
  testDbPath = join(tmpdir(), `tool-index-cov3-${Date.now()}.db`);
  index = new ToolIndex();
});

afterEach(() => {
  if (existsSync(testDbPath)) rmSync(testDbPath);
});

// ── L245: 동일 스키마로 build() 두 번 → hash 캐시 적중 → early return ────────

describe("ToolIndex.build — L245: 동일 스키마 두 번 → hash 캐시 → early return", () => {
  it("두 번째 build() 호출은 hash 동일 시 조기 반환 (L245)", async () => {
    const tools = [
      make_tool("read_file", "Read file"),
      make_tool("write_file", "Write file"),
    ];
    const cats = { read_file: "file", write_file: "file" };

    // 첫 번째 build — DB 구축
    index.build(tools, cats, testDbPath);

    // 두 번째 build — 동일한 스키마 → L245: hash 일치 → early return
    // 오류 없이 완료되면 성공 (early return이 조용히 실행됨)
    index.build(tools, cats, testDbPath);

    // 빌드 후 select 정상 작동 확인
    const result = await index.select("read file contents");
    expect(result.has("read_file")).toBe(true);
  });
});

// ── L349: 한국어 키워드 포함 도구 → KO_KEYWORD_MAP en_tags 추가 ─────────────

describe("ToolIndex.build — L349: 한국어 키워드 도구 → KO_KEYWORD_MAP 매핑", () => {
  it("도구 description에 '파일' 포함 → en_tags 추가됨 (L349)", async () => {
    const tools = [
      // "파일" 키워드 → ["file", "filesystem", "read_file", "write_file"] 태그 추가
      make_tool("my_custom_tool", "파일 시스템 도구 - 파일 읽기 쓰기 관리"),
      make_tool("other_tool", "Some other utility"),
    ];
    const cats = { my_custom_tool: "file", other_tool: "util" };

    index.build(tools, cats, testDbPath);

    // "파일" 키워드로 검색 → my_custom_tool이 포함됨 (KO_KEYWORD_MAP 태그 매핑)
    const result = await index.select("파일 관리");
    expect(result.has("my_custom_tool")).toBe(true);
  });

  it("'검색' 키워드 도구 → web_search/grep 태그 매핑 (L349)", async () => {
    const tools = [
      make_tool("search_helper", "검색 도구 — 데이터 검색 및 필터링"),
    ];
    const cats = { search_helper: "search" };

    index.build(tools, cats, testDbPath);

    const result = await index.select("검색해줘");
    expect(result.has("search_helper")).toBe(true);
  });
});

// ── L439, L442: category 폴백 루프 — max 도달 시 inner/outer break ─────────

describe("ToolIndex.select — L439/L442: category 폴백 루프 max 도달 break", () => {
  it("max_tools=2 + category에 4개 도구 → L439 inner break + L442 outer break 실행", async () => {
    // 핵심 도구(CORE_TOOLS)가 아닌 도구들만 사용
    const tools = [
      make_tool("custom_a", "custom tool alpha"),
      make_tool("custom_b", "custom tool beta"),
      make_tool("custom_c", "custom tool gamma"),
      make_tool("custom_d", "custom tool delta"),
    ];
    const cats = {
      custom_a: "custom",
      custom_b: "custom",
      custom_c: "custom",
      custom_d: "custom",
    };

    index.build(tools, cats, testDbPath);

    // max_tools=2, classifier_categories=["custom"] → category 루프에서 2개만 선택
    // CORE_TOOLS가 없는 도구들이므로 step 1에서 0개 선택
    // step 3 (mem_search): "xyz123" 쿼리는 매칭 없음 → 0개 선택
    // step 4 (category): custom_a, custom_b 추가 → selected.size=2=max → L439 break
    // → L442 outer break
    const result = await index.select("xyz123 unique query", {
      max_tools: 2,
      mode: "agent",
      classifier_categories: ["custom"],
    });

    // max_tools=2이므로 최대 2개만 선택됨 (L439/L442 break으로 인해)
    expect(result.size).toBeLessThanOrEqual(2);
  });
});
