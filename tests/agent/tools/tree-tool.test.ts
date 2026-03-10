/**
 * TreeTool — traverse/flatten/find/depth/to_ascii/from_parent_list/lca 테스트.
 * L126: in-order 순회에서 자식이 없는 리프 노드 분기 커버.
 */
import { describe, it, expect } from "vitest";
import { TreeTool } from "../../../src/agent/tools/tree.js";

const tool = new TreeTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

// 단순 트리: root → [child1, child2]
const TREE = JSON.stringify({
  id: "root",
  children: [
    { id: "child1", children: [{ id: "leaf1" }] },
    { id: "child2" },
  ],
});

// ══════════════════════════════════════════
// traverse — pre/in/post/level 순서
// ══════════════════════════════════════════

describe("TreeTool — traverse pre-order", () => {
  it("pre-order 순회 결과 확인", async () => {
    const r = await exec({ action: "traverse", tree: TREE, order: "pre" }) as Record<string, unknown>;
    const ids = r.nodes as string[];
    expect(ids[0]).toBe("root");
    expect(ids).toContain("child1");
    expect(ids).toContain("child2");
  });
});

describe("TreeTool — traverse in-order (L126: 리프 노드)", () => {
  it("in-order: child2(리프) → L126 else 분기 실행", async () => {
    // child2는 children 없음 → dfs에서 order==="in" && no children → L126 result.push(node.id)
    const r = await exec({ action: "traverse", tree: TREE, order: "in" }) as Record<string, unknown>;
    const ids = r.nodes as string[];
    expect(ids).toContain("child2");
    expect(ids).toContain("root");
  });

  it("in-order: 단일 리프 트리", async () => {
    // 자식 없는 노드만 있는 트리 → 모두 L126 분기
    const single = JSON.stringify({ id: "lone" });
    const r = await exec({ action: "traverse", tree: single, order: "in" }) as Record<string, unknown>;
    expect((r.nodes as string[])[0]).toBe("lone");
  });
});

describe("TreeTool — traverse post-order", () => {
  it("post-order: root가 마지막", async () => {
    const r = await exec({ action: "traverse", tree: TREE, order: "post" }) as Record<string, unknown>;
    const ids = r.nodes as string[];
    expect(ids[ids.length - 1]).toBe("root");
  });
});

describe("TreeTool — traverse level-order", () => {
  it("level-order: root가 첫 번째", async () => {
    const r = await exec({ action: "traverse", tree: TREE, order: "level" }) as Record<string, unknown>;
    const ids = r.nodes as string[];
    expect(ids[0]).toBe("root");
  });
});

// ══════════════════════════════════════════
// flatten
// ══════════════════════════════════════════

describe("TreeTool — flatten", () => {
  it("모든 노드 {id, depth} 객체 반환", async () => {
    const r = await exec({ action: "flatten", tree: TREE }) as Record<string, unknown>;
    const nodes = r.nodes as Array<{ id: string; depth: number }>;
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("root");
    expect(ids).toContain("child1");
    expect(ids).toContain("child2");
    expect(ids).toContain("leaf1");
    expect(nodes.find((n) => n.id === "root")?.depth).toBe(0);
  });
});

// ══════════════════════════════════════════
// find
// ══════════════════════════════════════════

describe("TreeTool — find", () => {
  it("leaf1 찾기 → 경로 반환", async () => {
    const r = await exec({ action: "find", tree: TREE, target: "leaf1" }) as Record<string, unknown>;
    expect(r.found).toBe(true);
    expect(Array.isArray(r.path)).toBe(true);
  });

  it("존재하지 않는 노드 → found: false", async () => {
    const r = await exec({ action: "find", tree: TREE, target: "nonexistent" }) as Record<string, unknown>;
    expect(r.found).toBe(false);
  });
});

// ══════════════════════════════════════════
// depth
// ══════════════════════════════════════════

describe("TreeTool — depth", () => {
  it("트리 최대 깊이 반환", async () => {
    const r = await exec({ action: "depth", tree: TREE }) as Record<string, unknown>;
    expect(Number(r.max_depth)).toBeGreaterThanOrEqual(2);
  });
});

// ══════════════════════════════════════════
// to_ascii
// ══════════════════════════════════════════

describe("TreeTool — to_ascii", () => {
  it("ASCII 트리 문자열 반환", async () => {
    const r = await exec({ action: "to_ascii", tree: TREE }) as Record<string, unknown>;
    expect(String(r.ascii)).toContain("root");
    expect(String(r.ascii)).toContain("child1");
  });
});

// ══════════════════════════════════════════
// from_parent_list
// ══════════════════════════════════════════

describe("TreeTool — from_parent_list", () => {
  it("parent 목록으로 트리 구성", async () => {
    const parents = JSON.stringify([
      { id: "r", parent: null },
      { id: "c1", parent: "r" },
      { id: "c2", parent: "r" },
    ]);
    const r = await exec({ action: "from_parent_list", parents }) as Record<string, unknown>;
    expect((r.tree as { id: string }).id).toBe("r");
  });

  it("root 없으면 error", async () => {
    const parents = JSON.stringify([{ id: "c1", parent: "r" }]);
    const r = await exec({ action: "from_parent_list", parents }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "from_parent_list", parents: "bad{json" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// lca (최소 공통 조상)
// ══════════════════════════════════════════

describe("TreeTool — lca", () => {
  it("leaf1과 child2의 LCA → root", async () => {
    const r = await exec({ action: "lca", tree: TREE, node_a: "leaf1", node_b: "child2" }) as Record<string, unknown>;
    expect(r.lca).toBe("root");
  });

  it("존재하지 않는 노드 → error 반환", async () => {
    const r = await exec({ action: "lca", tree: TREE, node_a: "leaf1", node_b: "ghost" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// 에러 케이스
// ══════════════════════════════════════════

describe("TreeTool — 에러 케이스", () => {
  it("잘못된 tree JSON → error", async () => {
    const r = await exec({ action: "traverse", tree: "bad{json" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("TreeTool — 미커버 분기", () => {
  it("parse_tree: id 없는 JSON → L113 return null → error", async () => {
    // parse_tree({}) → !t.id → return null → action finds null tree
    const r = await exec({ action: "traverse", tree: '{"noId": true}' }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("TreeTool — lca: node_a 없음 → L96 error", () => {
  it("node_a가 존재하지 않음 → L96 path_a null → error", async () => {
    const r = await exec({ action: "lca", tree: TREE, node_a: "ghost", node_b: "leaf1" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
    expect(String(r.error)).toContain("ghost");
  });
});
