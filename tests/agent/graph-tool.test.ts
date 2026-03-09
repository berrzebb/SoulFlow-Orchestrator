import { describe, it, expect } from "vitest";
import { GraphTool } from "../../src/agent/tools/graph.js";

function make_tool() {
  return new GraphTool({ secret_vault: undefined as never });
}

const simple_graph = JSON.stringify({
  nodes: ["A", "B", "C", "D"],
  edges: [
    { from: "A", to: "B", weight: 1 },
    { from: "B", to: "C", weight: 2 },
    { from: "A", to: "C", weight: 5 },
    { from: "C", to: "D", weight: 1 },
  ],
  directed: false,
});

const dag = JSON.stringify({
  nodes: ["A", "B", "C", "D"],
  edges: [
    { from: "A", to: "B" },
    { from: "A", to: "C" },
    { from: "B", to: "D" },
    { from: "C", to: "D" },
  ],
  directed: true,
});

describe("GraphTool", () => {
  describe("bfs", () => {
    it("시작 노드에서 모든 노드 방문", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "bfs", graph: simple_graph, start: "A" }));
      expect(r.start).toBe("A");
      expect(r.order[0]).toBe("A");
      expect(r.visited_count).toBe(4);
      expect(new Set(r.order)).toEqual(new Set(["A", "B", "C", "D"]));
    });
  });

  describe("dfs", () => {
    it("시작 노드에서 깊이 우선 탐색", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "dfs", graph: simple_graph, start: "A" }));
      expect(r.start).toBe("A");
      expect(r.order[0]).toBe("A");
      expect(r.visited_count).toBe(4);
    });
  });

  describe("shortest_path", () => {
    it("Dijkstra 최단 경로", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "shortest_path", graph: simple_graph, start: "A", end: "D" }));
      expect(r.start).toBe("A");
      expect(r.end).toBe("D");
      // A->B(1)->C(2)->D(1) = 4 < A->C(5)->D(1) = 6
      expect(r.distance).toBe(4);
      expect(r.path).toEqual(["A", "B", "C", "D"]);
    });

    it("경로 없음 → 에러", async () => {
      const disconnected = JSON.stringify({
        nodes: ["A", "B"],
        edges: [],
        directed: true,
      });
      const r = JSON.parse(await make_tool().execute({ action: "shortest_path", graph: disconnected, start: "A", end: "B" }));
      expect(r.error).toBeDefined();
    });
  });

  describe("topological_sort", () => {
    it("DAG 토폴로지 정렬", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "topological_sort", graph: dag }));
      expect(r.order).toBeDefined();
      // A는 D보다 앞에 와야 함
      expect(r.order.indexOf("A")).toBeLessThan(r.order.indexOf("D"));
      expect(r.order.indexOf("B")).toBeLessThan(r.order.indexOf("D"));
    });

    it("무방향 그래프 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "topological_sort", graph: simple_graph }));
      expect(r.error).toContain("directed");
    });

    it("사이클 있는 방향 그래프 → 에러", async () => {
      const cyclic = JSON.stringify({
        nodes: ["A", "B", "C"],
        edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "A" }],
        directed: true,
      });
      const r = JSON.parse(await make_tool().execute({ action: "topological_sort", graph: cyclic }));
      expect(r.error).toContain("cycle");
    });
  });

  describe("connected_components", () => {
    it("연결된 그래프 → 컴포넌트 1개", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "connected_components", graph: simple_graph }));
      expect(r.count).toBe(1);
    });

    it("분리된 그래프 → 컴포넌트 2개", async () => {
      const disconnected = JSON.stringify({
        nodes: ["A", "B", "C", "D"],
        edges: [{ from: "A", to: "B" }, { from: "C", to: "D" }],
        directed: false,
      });
      const r = JSON.parse(await make_tool().execute({ action: "connected_components", graph: disconnected }));
      expect(r.count).toBe(2);
    });
  });

  describe("cycle_detect", () => {
    it("DAG → 사이클 없음", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "cycle_detect", graph: dag }));
      expect(r.has_cycle).toBe(false);
    });

    it("사이클 있는 방향 그래프 탐지", async () => {
      const cyclic = JSON.stringify({
        nodes: ["A", "B", "C"],
        edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "A" }],
        directed: true,
      });
      const r = JSON.parse(await make_tool().execute({ action: "cycle_detect", graph: cyclic }));
      expect(r.has_cycle).toBe(true);
    });

    it("무방향 사이클 탐지 (union-find)", async () => {
      const cyclic_undirected = JSON.stringify({
        nodes: ["A", "B", "C"],
        edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "A" }],
        directed: false,
      });
      const r = JSON.parse(await make_tool().execute({ action: "cycle_detect", graph: cyclic_undirected }));
      expect(r.has_cycle).toBe(true);
    });
  });

  describe("mst", () => {
    it("Kruskal MST", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "mst", graph: simple_graph }));
      // 4 nodes → 3 edges in MST
      expect(r.edge_count).toBe(3);
      // A-B(1) + B-C(2) + C-D(1) = 4 (not A-C(5))
      expect(r.total_weight).toBe(4);
    });

    it("방향 그래프 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "mst", graph: dag }));
      expect(r.error).toContain("undirected");
    });
  });

  it("잘못된 그래프 JSON → 에러", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "bfs", graph: "invalid" }));
    expect(r.error).toBeDefined();
  });

  // L186: default branch — unknown action
  it("알 수 없는 action → error 반환 (L186)", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "unknown_action" as any, graph: simple_graph }));
    expect(r.error).toContain("unknown action");
  });
});
