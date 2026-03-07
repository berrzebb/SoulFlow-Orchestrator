import { describe, it, expect } from "vitest";
import { TreeTool } from "../../src/agent/tools/tree.js";

function make_tool() {
  return new TreeTool({ secret_vault: undefined as never });
}

const sample_tree = JSON.stringify({
  id: "A",
  children: [
    { id: "B", children: [{ id: "D" }, { id: "E" }] },
    { id: "C", children: [{ id: "F" }] },
  ],
});

describe("TreeTool", () => {
  describe("traverse", () => {
    it("pre-order", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "traverse", tree: sample_tree, order: "pre" }));
      expect(r.nodes).toEqual(["A", "B", "D", "E", "C", "F"]);
    });

    it("post-order", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "traverse", tree: sample_tree, order: "post" }));
      expect(r.nodes).toEqual(["D", "E", "B", "F", "C", "A"]);
    });

    it("level-order (BFS)", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "traverse", tree: sample_tree, order: "level" }));
      expect(r.nodes).toEqual(["A", "B", "C", "D", "E", "F"]);
    });

    it("기본 순서는 pre", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "traverse", tree: sample_tree }));
      expect(r.order).toBe("pre");
    });
  });

  describe("flatten", () => {
    it("트리를 평탄화 + depth 포함", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "flatten", tree: sample_tree }));
      expect(r.count).toBe(6);
      const a = r.nodes.find((n: { id: string }) => n.id === "A");
      expect(a.depth).toBe(0);
      const d = r.nodes.find((n: { id: string }) => n.id === "D");
      expect(d.depth).toBe(2);
      expect(d.parent).toBe("B");
    });
  });

  describe("find", () => {
    it("노드 찾기 + 경로", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "find", tree: sample_tree, target: "E" }));
      expect(r.found).toBe(true);
      expect(r.path).toEqual(["A", "B", "E"]);
      expect(r.depth).toBe(2);
    });

    it("없는 노드 → found=false", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "find", tree: sample_tree, target: "Z" }));
      expect(r.found).toBe(false);
    });
  });

  describe("depth", () => {
    it("트리 깊이/노드/리프 통계", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "depth", tree: sample_tree }));
      expect(r.max_depth).toBe(2);
      expect(r.node_count).toBe(6);
      expect(r.leaf_count).toBe(3); // D, E, F
    });
  });

  describe("to_ascii", () => {
    it("ASCII 트리 생성", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "to_ascii", tree: sample_tree }));
      expect(r.ascii).toContain("A");
      expect(r.line_count).toBe(6);
    });
  });

  describe("from_parent_list", () => {
    it("부모 목록에서 트리 구성", async () => {
      const parents = JSON.stringify([
        { id: "root", parent: null },
        { id: "child1", parent: "root" },
        { id: "child2", parent: "root" },
        { id: "grandchild", parent: "child1" },
      ]);
      const r = JSON.parse(await make_tool().execute({ action: "from_parent_list", parents }));
      expect(r.tree.id).toBe("root");
      expect(r.tree.children).toHaveLength(2);
    });
  });

  describe("lca", () => {
    it("최소 공통 조상", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "lca", tree: sample_tree, node_a: "D", node_b: "E" }));
      expect(r.lca).toBe("B");
    });

    it("서로 다른 서브트리 → 루트가 LCA", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "lca", tree: sample_tree, node_a: "D", node_b: "F" }));
      expect(r.lca).toBe("A");
    });

    it("없는 노드 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "lca", tree: sample_tree, node_a: "D", node_b: "Z" }));
      expect(r.error).toContain("not found");
    });
  });

  it("잘못된 트리 JSON → 에러", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "traverse", tree: "invalid" }));
    expect(r.error).toBeDefined();
  });
});
