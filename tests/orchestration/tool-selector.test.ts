import { describe, it, expect, vi } from "vitest";
import { select_tools_for_request, TOOL_CATEGORIES } from "@src/orchestration/tool-selector.js";

/** 도구 정의 헬퍼. */
function tool_def(name: string): Record<string, unknown> {
  return { function: { name, description: `tool ${name}`, parameters: {} } };
}

const SAMPLE_TOOLS = [
  tool_def("read_file"),
  tool_def("write_file"),
  tool_def("exec"),
  tool_def("web_search"),
  tool_def("web_fetch"),
  tool_def("message"),
  tool_def("cron"),
  tool_def("memory"),
  tool_def("decision"),
  tool_def("promise"),
  tool_def("secret"),
  tool_def("diagram"),
  tool_def("spawn"),
  tool_def("runtime_admin"),
  tool_def("http_request"),
  tool_def("send_file"),
  tool_def("request_file"),
  tool_def("task_query"),
  tool_def("custom_tool"),
];

describe("TOOL_CATEGORIES", () => {
  it("maps known tools to categories", () => {
    expect(TOOL_CATEGORIES.read_file).toBe("filesystem");
    expect(TOOL_CATEGORIES.exec).toBe("shell");
    expect(TOOL_CATEGORIES.web_search).toBe("web");
    expect(TOOL_CATEGORIES.message).toBe("messaging");
    expect(TOOL_CATEGORIES.cron).toBe("scheduling");
  });
});

describe("select_tools_for_request (category fallback)", () => {
  // tool-index is not built so falls back to category-based selection

  it("once mode includes web, scheduling, messaging but excludes shell/filesystem", async () => {
    const result = await select_tools_for_request(SAMPLE_TOOLS, "search something", "once");
    const names = result.tools.map((t) => (t.function as any).name);
    expect(names).toContain("web_search");
    expect(names).toContain("message");
    expect(names).toContain("cron");
    expect(names).not.toContain("exec");
    expect(names).not.toContain("read_file");
  });

  it("agent mode includes filesystem and shell", async () => {
    const result = await select_tools_for_request(SAMPLE_TOOLS, "edit files", "agent");
    const names = result.tools.map((t) => (t.function as any).name);
    expect(names).toContain("read_file");
    expect(names).toContain("exec");
    expect(names).toContain("web_search");
  });

  it("task mode includes admin tools", async () => {
    const result = await select_tools_for_request(SAMPLE_TOOLS, "manage tasks", "task");
    const names = result.tools.map((t) => (t.function as any).name);
    expect(names).toContain("runtime_admin");
    expect(names).toContain("task_query");
  });

  it("always includes messaging and file_transfer categories", async () => {
    const result = await select_tools_for_request(SAMPLE_TOOLS, "something", "once");
    const names = result.tools.map((t) => (t.function as any).name);
    expect(names).toContain("message");
    expect(names).toContain("send_file");
    expect(names).toContain("request_file");
  });

  it("skill_tool_names adds their categories", async () => {
    const result = await select_tools_for_request(
      SAMPLE_TOOLS, "run skill", "once",
      ["exec"], // exec is shell category, not in once defaults
    );
    const names = result.tools.map((t) => (t.function as any).name);
    expect(names).toContain("exec");
  });

  it("classifier_categories override mode defaults", async () => {
    const result = await select_tools_for_request(
      SAMPLE_TOOLS, "query", "once",
      [], // no skill tools
      ["filesystem"], // classifier says filesystem needed
    );
    const names = result.tools.map((t) => (t.function as any).name);
    expect(names).toContain("read_file");
    // messaging always included
    expect(names).toContain("message");
  });
});

describe("select_tools_for_request — keyword index 경로", () => {
  // KEYWORD_SELECTION_THRESHOLD = 30 이상의 tool_index.size와 all_tools.length 필요

  function make_large_tools(count: number) {
    return Array.from({ length: count }, (_, i) => tool_def(`tool_${i}`));
  }

  it("tool_index.size >= 30 + all_tools >= 30 → 키워드 인덱스 선택 경로", async () => {
    const selected_names = new Set(["tool_0", "tool_1", "web_search"]);

    const mock_index = {
      size: 35, // >= 30
      select: vi.fn(async () => selected_names),
    } as any;

    const large_tools = [
      ...make_large_tools(30),
      tool_def("web_search"),
    ];

    const result = await select_tools_for_request(
      large_tools,
      "search for something",
      "once",
      [],
      undefined,
      undefined,
      undefined,
      mock_index,
    );

    expect(mock_index.select).toHaveBeenCalledOnce();
    // 선택된 도구만 반환
    const names = result.tools.map((t) => (t.function as any).name);
    expect(names).toContain("web_search");
    expect(result.keyword_matched).toBeGreaterThan(0);
  });

  it("tool_index.size < 30 → category fallback (keyword path 미사용)", async () => {
    const mock_index = {
      size: 5, // < 30
      select: vi.fn(async () => new Set(["tool_0"])),
    } as any;

    const result = await select_tools_for_request(
      SAMPLE_TOOLS, // 19개 < 30
      "search",
      "once",
      [],
      undefined,
      undefined,
      undefined,
      mock_index,
    );

    expect(mock_index.select).not.toHaveBeenCalled();
    expect(result.keyword_matched).toBeUndefined();
  });
});
