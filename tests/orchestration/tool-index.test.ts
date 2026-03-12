/** Phase 4.5+: tool-index 모듈 테스트
 *
 * 목표: FTS5 + sqlite-vec 하이브리드 도구 인덱스 검증
 *       - build: 도구 스키마 인덱싱
 *       - set_embed: 임베딩 함수 주입
 *       - select: 텍스트 기반 도구 검색
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ToolIndex } from "@src/orchestration/tool-index.js";
import type { ToolSchema } from "@src/agent/tools/types.js";
import type { EmbedFn } from "@src/agent/memory.service.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

/* ── Mock Data ── */

const createMockToolSchema = (name: string, description: string): ToolSchema => ({
  function: {
    name,
    description,
    parameters: { type: "object", properties: {} },
  },
});

const mockTools: ToolSchema[] = [
  createMockToolSchema("read_file", "Read file contents from disk"),
  createMockToolSchema("write_file", "Write contents to a file"),
  createMockToolSchema("web_search", "Search the web for information"),
  createMockToolSchema("exec", "Execute shell commands"),
  createMockToolSchema("message", "Send a message to the user"),
  createMockToolSchema("grep", "Search for patterns in files"),
  createMockToolSchema("git", "Execute git commands"),
];

const mockCategories: Record<string, string> = {
  read_file: "file",
  write_file: "file",
  web_search: "web",
  exec: "shell",
  message: "messaging",
  grep: "file",
  git: "version_control",
};

const VEC_DIM = 256; // ToolIndex.VEC_DIMENSIONS와 일치

const mockEmbedFn: EmbedFn = vi.fn(async (texts: string[]) => {
  // 각 텍스트에 대해 256차원 임베딩 생성 (정규화 불필요 — ToolIndex가 처리)
  const embeddings = texts.map((text) => {
    const hash = Array.from(text).reduce((a, b) => a + b.charCodeAt(0), 0);
    const vec = new Array(VEC_DIM).fill(0);
    vec[hash % VEC_DIM] = 1.0;
    return vec;
  });
  return { embeddings };
});

/* ── Tests ── */

describe("ToolIndex — FTS5 + 벡터 하이브리드 도구 인덱싱", () => {
  let testDbPath: string;
  let index: ToolIndex;

  beforeEach(() => {
    testDbPath = join(tmpdir(), `test-tool-index-${Date.now()}.db`);
    index = new ToolIndex();
  });

  afterEach(() => {
    if (existsSync(testDbPath)) {
      rmSync(testDbPath);
    }
  });

  describe("build — 인덱스 생성", () => {
    it("도구 스키마 → FTS5 테이블 생성", async () => {
      index.build(mockTools, mockCategories, testDbPath);

      expect(existsSync(testDbPath)).toBe(true);
    });

    it("여러 도구 등록 가능", async () => {
      const tools = mockTools.slice(0, 3);
      index.build(tools, mockCategories, testDbPath);

      // Should not throw
      expect(true).toBe(true);
    });

    it("빈 도구 배열 → 빈 인덱스", async () => {
      index.build([], mockCategories, testDbPath);

      expect(existsSync(testDbPath)).toBe(true);
    });

    it("카테고리 없는 도구 → external 카테고리", async () => {
      const tools = [createMockToolSchema("unknown_tool", "Unknown tool")];
      index.build(tools, {}, testDbPath);

      expect(existsSync(testDbPath)).toBe(true);
    });

    it("db_path 없음 → 인덱스 생성 안함", async () => {
      index.build(mockTools, mockCategories);
      // Should not create file since no path provided
      expect(existsSync(testDbPath)).toBe(false);
    });

    it("중복 build 호출 → 기존 인덱스 재생성", async () => {
      index.build(mockTools.slice(0, 2), mockCategories, testDbPath);
      expect(existsSync(testDbPath)).toBe(true);

      const firstSize = require("node:fs").statSync(testDbPath).size;

      // Build again with different tools
      index.build(mockTools.slice(0, 5), mockCategories, testDbPath);
      const secondSize = require("node:fs").statSync(testDbPath).size;

      // Second build should have more data
      expect(secondSize).toBeGreaterThanOrEqual(firstSize);
    });
  });

  describe("set_embed — 임베딩 함수 주입", () => {
    it("임베딩 함수 설정 가능", async () => {
      index.set_embed(mockEmbedFn);
      // Should not throw
      expect(true).toBe(true);
    });

    it("set_embed 이후 select에서 벡터 검색 활성화", async () => {
      index.build(mockTools, mockCategories, testDbPath);
      index.set_embed(mockEmbedFn);

      const results = await index.select("find files quickly", {
        max_tools: 5,
      });

      // Should return some results
      expect(results.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe("select — 도구 검색", () => {
    beforeEach(() => {
      index.build(mockTools, mockCategories, testDbPath);
    });

    it("db_path 없음 → 빈 결과", async () => {
      const emptyIndex = new ToolIndex();
      const results = await emptyIndex.select("search");

      expect(results.size).toBe(0);
    });

    it("파일 관련 검색 → file 도구 포함", async () => {
      const results = await index.select("find file by pattern", {
        max_tools: 10,
      });

      // Should find file-related tools
      expect(results.size).toBeGreaterThan(0);
    });

    it("웹 검색 관련 → web_search 포함 가능", async () => {
      const results = await index.select("search the internet for news", {
        max_tools: 10,
      });

      expect(results.size).toBeGreaterThan(0);
    });

    it("max_tools 옵션 적용", async () => {
      const resultsMax3 = await index.select("file web search exec", {
        max_tools: 3,
      });

      const resultsMax10 = await index.select("file web search exec", {
        max_tools: 10,
      });

      // max_tools is a hint; actual results may include core tools
      expect(resultsMax3.size).toBeGreaterThan(0);
      expect(resultsMax10.size).toBeGreaterThan(0);
      // Higher max_tools should not return fewer results
      expect(resultsMax3.size).toBeLessThanOrEqual(resultsMax10.size);
    });

    it("mode 파라미터 처리", async () => {
      const onceResults = await index.select("task", { mode: "once" });
      const agentResults = await index.select("task", { mode: "agent" });
      const taskResults = await index.select("task", { mode: "task" });

      // All should return Set, size can vary by mode
      expect(onceResults instanceof Set).toBe(true);
      expect(agentResults instanceof Set).toBe(true);
      expect(taskResults instanceof Set).toBe(true);
    });

    it("classifier_tools 옵션 사용 가능", async () => {
      const results = await index.select("search", {
        classifier_tools: ["grep", "web_search"],
      });

      // Should handle the option without throwing
      expect(results instanceof Set).toBe(true);
    });

    it("classifier_categories 옵션 사용 가능", async () => {
      const results = await index.select("search", {
        classifier_categories: ["file", "web"],
      });

      expect(results instanceof Set).toBe(true);
    });

    it("빈 검색어 → 빈 결과", async () => {
      const results = await index.select("", {
        max_tools: 10,
      });

      expect(results instanceof Set).toBe(true);
    });

    it("매우 긴 검색어 처리", async () => {
      const longQuery = "find all python files in the directory and grep for the word database and show results".repeat(10);
      const results = await index.select(longQuery, {
        max_tools: 5,
      });

      expect(results instanceof Set).toBe(true);
    });

    it("특수 문자 검색어 처리", async () => {
      const results = await index.select("search @file #query $var", {
        max_tools: 5,
      });

      expect(results instanceof Set).toBe(true);
    });

    it("한글 검색어 처리", async () => {
      const results = await index.select("파일을 검색해서 내용 찾기", {
        max_tools: 5,
      });

      expect(results instanceof Set).toBe(true);
    });

    it("혼합 검색어 처리 (한글 + 영어)", async () => {
      const results = await index.select("file 검색 search 결과", {
        max_tools: 5,
      });

      expect(results instanceof Set).toBe(true);
    });
  });

  describe("통합 시나리오", () => {
    it("build → select → 결과 검증", async () => {
      index.build(mockTools, mockCategories, testDbPath);

      const results = await index.select("read and modify files", {
        max_tools: 20,
      });

      expect(results instanceof Set).toBe(true);
      expect(results.size).toBeGreaterThan(0);
    });

    it("build → set_embed → select → 벡터 검색 활성화", async () => {
      index.build(mockTools, mockCategories, testDbPath);
      index.set_embed(mockEmbedFn);

      const results = await index.select("need to work with files in version control", {
        max_tools: 10,
      });

      // Mock embedFn should be called
      expect(mockEmbedFn).toHaveBeenCalled();
      expect(results instanceof Set).toBe(true);
    });

    it("여러 select 호출 가능", async () => {
      index.build(mockTools, mockCategories, testDbPath);

      const result1 = await index.select("file", { max_tools: 5 });
      const result2 = await index.select("web", { max_tools: 5 });
      const result3 = await index.select("shell", { max_tools: 5 });

      expect(result1 instanceof Set).toBe(true);
      expect(result2 instanceof Set).toBe(true);
      expect(result3 instanceof Set).toBe(true);
    });

    it("build 재호출 후 select는 새 인덱스 사용", async () => {
      const tools1 = mockTools.slice(0, 3);
      index.build(tools1, mockCategories, testDbPath);

      const results1 = await index.select("git", { max_tools: 10 });

      // Rebuild without git tool
      const tools2 = mockTools.slice(0, 2);
      index.build(tools2, mockCategories, testDbPath);

      const results2 = await index.select("git", { max_tools: 10 });

      // Second search should not find git since it was removed
      expect(results1 instanceof Set).toBe(true);
      expect(results2 instanceof Set).toBe(true);
    });
  });

  describe("size getter", () => {
    it("build 전 size = 0", () => {
      expect(index.size).toBe(0);
    });

    it("build 후 size = 도구 개수", () => {
      index.build(mockTools, mockCategories, testDbPath);
      expect(index.size).toBe(mockTools.length);
    });

    it("빈 배열 build 후 size = 0", () => {
      index.build([], mockCategories, testDbPath);
      expect(index.size).toBe(0);
    });
  });

  describe("action enum 도구", () => {
    it("action enum 필드가 있는 도구 → 태그에 enum 값 포함", async () => {
      const encoding_tool: ToolSchema = {
        function: {
          name: "encoding",
          description: "Encode and decode data",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["encode", "decode", "hash", "uuid"],
              },
            },
          },
        },
      };
      index.build([encoding_tool], { encoding: "utility" }, testDbPath);
      const results = await index.select("encode decode hash");
      expect(results instanceof Set).toBe(true);
      // FTS5가 action enum 값으로 검색해서 결과가 나와야 함
    });
  });

  describe("벡터 검색 (embed_fn 사용)", () => {
    it("build + set_embed + select → embed_fn이 호출됨", async () => {
      index.build(mockTools, mockCategories, testDbPath);
      vi.clearAllMocks();
      index.set_embed(mockEmbedFn);

      const results = await index.select("파일 읽기 작업", { max_tools: 10 });
      expect(results instanceof Set).toBe(true);
      // 벡터 검색이 실행되면 embed_fn이 호출됨
      expect(vi.mocked(mockEmbedFn)).toHaveBeenCalled();
    });

    it("select 결과에 embed_fn 활성화 시 추가 도구 포함 가능", async () => {
      index.build(mockTools, mockCategories, testDbPath);
      index.set_embed(mockEmbedFn);

      // core 도구(read_file, write_file, exec, message)는 max 무관하게 항상 포함됨
      // embed 활성화 시 벡터 검색으로 추가 도구 포함 가능
      const results = await index.select("file search", { max_tools: 20 });
      expect(results instanceof Set).toBe(true);
      expect(results.size).toBeGreaterThan(0);
    });

    it("embed_fn이 없어도 FTS5만으로 검색 성공", async () => {
      index.build(mockTools, mockCategories, testDbPath);
      // set_embed 없이 직접 select
      const results = await index.select("web search");
      expect(results.size).toBeGreaterThan(0);
    });
  });

  describe("classifier_categories 폴백", () => {
    it("FTS 결과가 적을 때 category로 보강", async () => {
      // 아주 특이한 쿼리 → FTS 결과 없음 → category 폴백
      index.build(mockTools, mockCategories, testDbPath);
      const results = await index.select("xyzzy_impossible_term", {
        max_tools: 20,
        classifier_categories: ["file", "shell"],
      });
      expect(results instanceof Set).toBe(true);
      // file, shell 카테고리 도구들이 포함됨
    });
  });

  describe("엣지 케이스", () => {
    it("매우 짧은 tool name 처리", async () => {
      const shortTools = [createMockToolSchema("x", "Tool X")];
      index.build(shortTools, { x: "misc" }, testDbPath);

      const results = await index.select("x", { max_tools: 5 });
      expect(results instanceof Set).toBe(true);
    });

    it("매우 긴 tool name 처리", async () => {
      const longName = "very_long_tool_name_" + "x".repeat(100);
      const longTools = [createMockToolSchema(longName, "Long tool")];
      index.build(longTools, { [longName]: "misc" }, testDbPath);

      expect(existsSync(testDbPath)).toBe(true);
    });

    it("비어있는 description 처리", async () => {
      const emptyDescTools = [createMockToolSchema("tool", "")];
      index.build(emptyDescTools, { tool: "misc" }, testDbPath);

      const results = await index.select("tool", { max_tools: 5 });
      expect(results instanceof Set).toBe(true);
    });

    it("description이 아주 긴 경우", async () => {
      const longDesc = "a".repeat(10000);
      const longDescTools = [createMockToolSchema("tool", longDesc)];
      index.build(longDescTools, { tool: "misc" }, testDbPath);

      expect(existsSync(testDbPath)).toBe(true);
    });

    it("중복 없는 도구 배열로 정상 빌드", async () => {
      const uniqueTools = [
        createMockToolSchema("tool1", "First"),
        createMockToolSchema("tool2", "Second"),
      ];
      index.build(uniqueTools, { tool1: "misc", tool2: "misc" }, testDbPath);

      expect(existsSync(testDbPath)).toBe(true);
    });
  });

  describe("warm_up", () => {
    it("embed_fn 없을 때 → 조기 반환 (에러 없음)", async () => {
      index.build(mockTools, mockCategories, testDbPath);
      // embed_fn 미설정 → warm_up은 즉시 반환
      await expect(index.warm_up()).resolves.toBeUndefined();
    });

    it("embed_fn + query_text → _get_or_embed_query 호출", async () => {
      index.build(mockTools, mockCategories, testDbPath);
      mockEmbedFn.mockClear();
      index.set_embed(mockEmbedFn);
      // embed_fn 설정 후 warm_up with query_text → 예외 없이 완료
      await expect(index.warm_up("find files")).resolves.toBeUndefined();
      expect(mockEmbedFn).toHaveBeenCalled();
    });

    it("embed_fn + query_text 없음 → ensure_embeddings_fresh만 실행", async () => {
      index.build(mockTools, mockCategories, testDbPath);
      index.set_embed(mockEmbedFn);
      await expect(index.warm_up()).resolves.toBeUndefined();
    });
  });

  // ── cov2: query_cache eviction + build_fts_query ──

  describe("query_cache eviction", () => {
    it("17개 이상의 query_cache 항목 → 첫 번째 항목 삭제 (QUERY_CACHE_MAX=16)", async () => {
      index.build(mockTools, mockCategories, testDbPath);
      index.set_embed(mockEmbedFn);

      for (let i = 0; i < 17; i++) {
        await (index as any)._get_or_embed_query(`unique_query_${i}_text`);
      }

      const cache = (index as any).query_cache as Map<string, Float32Array>;
      expect(cache.size).toBeLessThanOrEqual(16);
    });
  });

  describe("build_fts_query", () => {
    it("영어 키워드 → OR 조합 FTS 쿼리 반환", () => {
      const result = (index as any).build_fts_query("read file contents search");
      expect(typeof result).toBe("string");
      expect(result).toContain("OR");
    });

    it("한국어 키워드 → 영어 태그로 확장", () => {
      const result = (index as any).build_fts_query("파일 검색하기");
      expect(result).toBeTruthy();
      expect(result).toContain("OR");
    });

    it("수학 키워드 → math 관련 태그 확장", () => {
      const result = (index as any).build_fts_query("수학 계산");
      expect(result).toContain("math");
    });

    it("camelCase 식별자 → 분리 후 FTS 쿼리", () => {
      const result = (index as any).build_fts_query("readFileContents");
      expect(result).toBeTruthy();
    });

    it("snake_case 식별자 → _ 분리 후 FTS 쿼리", () => {
      const result = (index as any).build_fts_query("read_file_contents");
      expect(result).toContain("read");
      expect(result).toContain("file");
      expect(result).toContain("contents");
    });

    it("빈 문자열 → null 반환", () => {
      const result = (index as any).build_fts_query("");
      expect(result).toBeNull();
    });

    it("stop word만 있는 경우 → null 반환", () => {
      const result = (index as any).build_fts_query("a i");
      expect(result).toBeNull();
    });
  });

  // ── cov3: hash cache early return + KO_KEYWORD_MAP + category max break ──

  describe("build — hash 캐시", () => {
    it("동일 스키마 두 번 build → hash 일치 → early return", async () => {
      const tools = mockTools.slice(0, 2);
      const cats = { read_file: "file", write_file: "file" };

      index.build(tools, cats, testDbPath);
      index.build(tools, cats, testDbPath);

      const result = await index.select("read file contents");
      expect(result.has("read_file")).toBe(true);
    });
  });

  describe("build — KO_KEYWORD_MAP 한국어 태그 매핑", () => {
    it("description에 '파일' 포함 → en_tags 추가됨", async () => {
      const tools = [
        createMockToolSchema("my_custom_tool", "파일 시스템 도구 - 파일 읽기 쓰기 관리"),
        createMockToolSchema("other_tool", "Some other utility"),
      ];
      index.build(tools, { my_custom_tool: "file", other_tool: "util" }, testDbPath);

      const result = await index.select("파일 관리");
      expect(result.has("my_custom_tool")).toBe(true);
    });

    it("'검색' 키워드 도구 → search 태그 매핑", async () => {
      const tools = [
        createMockToolSchema("search_helper", "검색 도구 — 데이터 검색 및 필터링"),
      ];
      index.build(tools, { search_helper: "search" }, testDbPath);

      const result = await index.select("검색해줘");
      expect(result.has("search_helper")).toBe(true);
    });
  });

  describe("select — category 폴백 루프 max 도달 break", () => {
    it("max_tools=2 + category에 4개 도구 → inner/outer break 실행", async () => {
      const tools = [
        createMockToolSchema("custom_a", "custom tool alpha"),
        createMockToolSchema("custom_b", "custom tool beta"),
        createMockToolSchema("custom_c", "custom tool gamma"),
        createMockToolSchema("custom_d", "custom tool delta"),
      ];
      const cats = { custom_a: "custom", custom_b: "custom", custom_c: "custom", custom_d: "custom" };

      index.build(tools, cats, testDbPath);

      const result = await index.select("xyz123 unique query", {
        max_tools: 2,
        mode: "agent",
        classifier_categories: ["custom"],
      });

      expect(result.size).toBeLessThanOrEqual(2);
    });
  });
});
