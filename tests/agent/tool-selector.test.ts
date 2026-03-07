import { describe, it, expect } from "vitest";
import { select_tools_for_request, type ToolDefinition } from "@src/orchestration/tool-selector.ts";

function tool(name: string): ToolDefinition {
  return { name };
}

function fn_tool(name: string): ToolDefinition {
  return { function: { name } };
}

const ALL_TOOLS: ToolDefinition[] = [
  tool("read_file"), tool("write_file"), tool("edit_file"), tool("list_dir"),
  tool("exec"),
  tool("web_search"), tool("web_fetch"), tool("web_browser"),
  tool("message"), tool("request_file"),
  tool("cron"),
  tool("memory"),
  tool("decision"),
  tool("promise"),
  tool("secret"),
  tool("diagram"), tool("diagram_render"),
  tool("runtime_admin"),
  tool("spawn"),
  tool("chain"),
  tool("custom_unknown"),
];

function names(result: { tools: ToolDefinition[] }): string[] {
  return result.tools.map((t) => String((t as Record<string, unknown>).name || ""));
}

describe("select_tools_for_request", () => {
  describe("모드 기본값 사용 — 키워드 정규식 없음", () => {
    it("once 모드: 모드 기본값 도구 포함 (scheduling, memory, decision, messaging 등)", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "안녕하세요", "once");
      const n = names(result);
      expect(n).toContain("cron");
      expect(n).toContain("memory");
      expect(n).toContain("decision");
      expect(n).toContain("secret");
      expect(n).toContain("message"); // once 모드에서도 messaging 포함
      expect(n).not.toContain("exec"); // once 기본에 shell 없음
    });

    it("agent 모드: admin 제외, 나머지 대부분 포함", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "안녕", "agent");
      const n = names(result);
      expect(n).toContain("read_file");
      expect(n).toContain("exec");
      expect(n).toContain("web_search");
      expect(n).toContain("spawn");
      expect(n).not.toContain("runtime_admin");
      expect(n).not.toContain("chain");
    });

    it("task 모드: admin 포함한 전체 도구", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "안녕", "task");
      const n = names(result);
      expect(n).toContain("runtime_admin");
      expect(n).toContain("chain");
      expect(n).toContain("spawn");
    });
  });

  describe("messaging 카테고리", () => {
    it("once 모드: messaging 포함", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "테스트", "once");
      expect(names(result)).toContain("message");
      expect(result.categories).toContain("messaging");
    });

    it("agent 모드: messaging 포함", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "테스트", "agent");
      expect(names(result)).toContain("message");
      expect(result.categories).toContain("messaging");
    });

    it("task 모드: messaging 포함", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "테스트", "task");
      expect(names(result)).toContain("message");
      expect(result.categories).toContain("messaging");
    });
  });

  describe("카테고리 미등록 도구는 거부", () => {
    it("TOOL_CATEGORIES에 없는 도구는 필터링됨", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "테스트", "once");
      expect(names(result)).not.toContain("custom_unknown");
    });
  });

  describe("function 형식 도구 정의 지원", () => {
    it("{ function: { name } } 형식에서 이름 추출", async () => {
      const tools = [fn_tool("exec"), fn_tool("message"), fn_tool("cron")];
      const result = await select_tools_for_request(tools, "테스트", "agent");
      const n = result.tools.map((t) => {
        const fn = (t as Record<string, unknown>).function as Record<string, unknown>;
        return String(fn?.name || "");
      });
      expect(n).toContain("exec");
      expect(n).toContain("message");
      expect(n).toContain("cron");
    });

    it("{ function: { name } } 형식의 미등록 도구는 external 카테고리로 포함 (agent/task 모드)", async () => {
      const tools = [fn_tool("exec"), fn_tool("custom_xyz")];
      const result = await select_tools_for_request(tools, "테스트", "agent");
      const n = result.tools.map((t: ToolDefinition) => {
        const fn = (t as Record<string, unknown>).function as Record<string, unknown>;
        return String(fn?.name || "");
      });
      expect(n).toContain("exec");
      expect(n).toContain("custom_xyz");
      expect(result.categories).toContain("external");
    });

    it("once 모드에서는 external 카테고리 미포함", async () => {
      const tools = [fn_tool("cron"), fn_tool("custom_xyz")];
      const result = await select_tools_for_request(tools, "테스트", "once");
      const n = result.tools.map((t: ToolDefinition) => {
        const fn = (t as Record<string, unknown>).function as Record<string, unknown>;
        return String(fn?.name || "");
      });
      expect(n).toContain("cron");
      expect(n).not.toContain("custom_xyz");
    });
  });

  describe("빈 입력 처리", () => {
    it("빈 도구 목록 → 빈 결과", async () => {
      const result = await select_tools_for_request([], "테스트", "agent");
      expect(result.tools).toHaveLength(0);
    });

    it("빈 요청 텍스트 → 모드 기본값 사용", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "", "agent");
      expect(names(result)).toContain("read_file");
      expect(names(result)).toContain("exec");
    });
  });

  describe("skill_tool_names — 스킬 요구 도구 자동 포함", () => {
    it("once 모드 + skill_tool_names=[exec] → shell 카테고리 추가 포함", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "드래곤 나이트를 재생해줘", "once", ["exec"]);
      const n = names(result);
      expect(n).toContain("exec");
      expect(result.categories).toContain("shell");
    });

    it("once 모드 + skill_tool_names → messaging 포함", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "재생해줘", "once", ["exec"]);
      expect(names(result)).toContain("message");
      expect(result.categories).toContain("messaging");
    });

    it("여러 스킬 도구 → 여러 카테고리 포함", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "해줘", "once", ["exec", "web_search"]);
      const n = names(result);
      expect(n).toContain("exec");
      expect(n).toContain("web_search");
      expect(result.categories).toContain("shell");
      expect(result.categories).toContain("web");
    });

    it("TOOL_CATEGORIES에 없는 스킬 도구명 → external 카테고리로 매핑", async () => {
      const result = await select_tools_for_request(ALL_TOOLS, "해줘", "once", ["nonexistent_tool"]);
      expect(result.tools.length).toBeGreaterThan(0);
      expect(result.categories).toContain("external");
    });
  });
});
