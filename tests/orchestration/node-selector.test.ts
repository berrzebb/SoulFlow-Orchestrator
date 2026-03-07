import { describe, it, expect } from "vitest";
import { select_nodes_for_request, NODE_CATEGORY_MAP, type NodeCategory } from "@src/orchestration/node-selector.js";
import type { NodeHandler } from "@src/agent/node-registry.js";

function stub_handler(node_type: string): NodeHandler {
  return {
    node_type,
    icon: "",
    color: "",
    shape: "rect",
    output_schema: [],
    input_schema: [],
    create_default: () => ({}),
    execute: async () => ({ output: {} }),
    test: () => ({ preview: {}, warnings: [] }),
  } as NodeHandler;
}

const ALL_HANDLERS: NodeHandler[] = [
  // flow
  stub_handler("if"),
  stub_handler("switch"),
  stub_handler("merge"),
  stub_handler("wait"),
  // data
  stub_handler("set"),
  stub_handler("template"),
  stub_handler("code"),
  stub_handler("aggregate"),
  // ai
  stub_handler("llm"),
  stub_handler("ai_agent"),
  // integration
  stub_handler("http"),
  stub_handler("oauth"),
  stub_handler("notify"),
  // advanced
  stub_handler("task"),
  stub_handler("decision"),
  // unknown (not in map)
  stub_handler("custom_xyz"),
];

function types(result: { handlers: NodeHandler[] }): string[] {
  return result.handlers.map((h) => h.node_type).sort();
}

describe("select_nodes_for_request", () => {
  it("카테고리 미지정 시 모든 노드 반환", () => {
    const result = select_nodes_for_request(ALL_HANDLERS);
    expect(result.handlers).toHaveLength(ALL_HANDLERS.length);
    expect(result.categories.sort()).toEqual(["advanced", "ai", "data", "flow", "integration"]);
  });

  it("카테고리 미지정 시 (빈 배열) 모든 노드 반환", () => {
    const result = select_nodes_for_request(ALL_HANDLERS, []);
    expect(result.handlers).toHaveLength(ALL_HANDLERS.length);
  });

  it("flow는 항상 포함", () => {
    const result = select_nodes_for_request(ALL_HANDLERS, ["data"]);
    const t = types(result);
    expect(t).toContain("if");
    expect(t).toContain("switch");
    expect(t).toContain("merge");
    expect(t).toContain("wait");
    expect(t).toContain("set");
    expect(t).toContain("template");
    expect(t).toContain("code");
    expect(t).toContain("aggregate");
    expect(t).not.toContain("llm");
    expect(t).not.toContain("http");
  });

  it("ai 카테고리만 선택하면 flow + ai만 반환", () => {
    const result = select_nodes_for_request(ALL_HANDLERS, ["ai"]);
    const t = types(result);
    expect(t).toContain("llm");
    expect(t).toContain("ai_agent");
    expect(t).toContain("if"); // flow always included
    expect(t).not.toContain("set"); // data excluded
    expect(t).not.toContain("http"); // integration excluded
  });

  it("integration 카테고리 선택", () => {
    const result = select_nodes_for_request(ALL_HANDLERS, ["integration"]);
    const t = types(result);
    expect(t).toContain("http");
    expect(t).toContain("oauth");
    expect(t).toContain("notify");
    expect(t).not.toContain("llm");
  });

  it("NODE_CATEGORY_MAP에 없는 노드는 advanced로 분류", () => {
    const result = select_nodes_for_request(ALL_HANDLERS, ["advanced"]);
    const t = types(result);
    expect(t).toContain("task");
    expect(t).toContain("decision");
    expect(t).toContain("custom_xyz"); // unknown → advanced fallback
  });

  it("유효하지 않은 카테고리 문자열은 무시", () => {
    const result = select_nodes_for_request(ALL_HANDLERS, ["invalid_cat", "data"]);
    expect(result.categories).toContain("flow");
    expect(result.categories).toContain("data");
    expect(result.categories).not.toContain("invalid_cat");
  });

  it("여러 카테고리 동시 선택", () => {
    const result = select_nodes_for_request(ALL_HANDLERS, ["data", "ai", "integration"]);
    const t = types(result);
    expect(t).toContain("set");
    expect(t).toContain("llm");
    expect(t).toContain("http");
    expect(t).not.toContain("task"); // advanced excluded
  });

  it("빈 handlers 배열 → 빈 결과", () => {
    const result = select_nodes_for_request([], ["data"]);
    expect(result.handlers).toHaveLength(0);
    expect(result.categories).toContain("flow");
    expect(result.categories).toContain("data");
  });
});

describe("NODE_CATEGORY_MAP", () => {
  it("주요 노드 타입이 올바른 카테고리에 매핑", () => {
    expect(NODE_CATEGORY_MAP["if"]).toBe("flow");
    expect(NODE_CATEGORY_MAP["llm"]).toBe("ai");
    expect(NODE_CATEGORY_MAP["http"]).toBe("integration");
    expect(NODE_CATEGORY_MAP["set"]).toBe("data");
    expect(NODE_CATEGORY_MAP["task"]).toBe("advanced");
  });

  it("aggregate는 data 카테고리", () => {
    expect(NODE_CATEGORY_MAP["aggregate"]).toBe("data");
  });

  it("webhook, notify, send_file은 integration", () => {
    expect(NODE_CATEGORY_MAP["webhook"]).toBe("integration");
    expect(NODE_CATEGORY_MAP["notify"]).toBe("integration");
    expect(NODE_CATEGORY_MAP["send_file"]).toBe("integration");
  });
});
