/** 워크플로우 노드를 카테고리로 분류하여 요청에 필요한 서브셋만 선택. */

import type { NodeHandler } from "../agent/node-registry.js";

export type NodeCategory = "flow" | "data" | "ai" | "integration" | "advanced";

const ALL_NODE_CATEGORIES: readonly NodeCategory[] = ["flow", "data", "ai", "integration", "advanced"];

function is_node_category(v: string): v is NodeCategory {
  return (ALL_NODE_CATEGORIES as readonly string[]).includes(v);
}

export const NODE_CATEGORY_MAP: Record<string, NodeCategory> = {
  // Flow: 분기/반복/합류/대기
  if: "flow", switch: "flow", split: "flow", merge: "flow",
  loop: "flow", filter: "flow", wait: "flow", error_handler: "flow",
  // Data: 데이터 변환/저장
  set: "data", template: "data", transform: "data", code: "data",
  db: "data", file: "data", aggregate: "data",
  // AI: LLM/에이전트/분석
  llm: "ai", ai_agent: "ai", spawn_agent: "ai", analyzer: "ai",
  text_splitter: "ai", embedding: "ai", vector_store: "ai", retriever: "ai",
  // Integration: 외부 연동
  http: "integration", oauth: "integration", sub_workflow: "integration",
  notify: "integration", send_file: "integration", webhook: "integration",
  // Advanced
  task: "advanced", decision: "advanced", promise: "advanced",
};

/** 워크플로우의 기본 뼈대 — 항상 포함. */
const ALWAYS_INCLUDED: ReadonlySet<NodeCategory> = new Set(["flow"]);

export type NodeSelectionResult = {
  handlers: NodeHandler[];
  categories: NodeCategory[];
};

/** 분류기 추천 카테고리 기반으로 관련 노드만 선택. */
export function select_nodes_for_request(
  all_handlers: NodeHandler[],
  classifier_categories?: string[],
): NodeSelectionResult {
  const selected = new Set<NodeCategory>([...ALWAYS_INCLUDED]);

  if (classifier_categories?.length) {
    for (const c of classifier_categories) {
      if (is_node_category(c)) selected.add(c);
    }
  } else {
    for (const cat of ALL_NODE_CATEGORIES) selected.add(cat);
  }

  const handlers = all_handlers.filter((h) => {
    const cat = NODE_CATEGORY_MAP[h.node_type] ?? "advanced";
    return selected.has(cat);
  });

  return { handlers, categories: [...selected] };
}
