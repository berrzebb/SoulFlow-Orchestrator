/** Graph 도구 — 그래프 알고리즘 (BFS/DFS/Dijkstra/토폴로지 정렬/MST). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface Edge { from: string; to: string; weight?: number; }
interface GraphInput { nodes: string[]; edges: Edge[]; directed?: boolean; }

export class GraphTool extends Tool {
  readonly name = "graph";
  readonly category = "data" as const;
  readonly description = "Graph algorithms: bfs, dfs, shortest_path, topological_sort, connected_components, cycle_detect, mst.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["bfs", "dfs", "shortest_path", "topological_sort", "connected_components", "cycle_detect", "mst"], description: "Operation" },
      graph: { type: "string", description: "Graph JSON: {nodes, edges, directed?}" },
      start: { type: "string", description: "Start node" },
      end: { type: "string", description: "End node (shortest_path)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "bfs");
    const g = this.parse_graph(params.graph);
    if (!g) return JSON.stringify({ error: "invalid graph JSON" });
    const adj = this.build_adj(g);

    switch (action) {
      case "bfs": {
        const start = String(params.start || g.nodes[0]);
        const visited: string[] = [];
        const queue = [start];
        const seen = new Set([start]);
        while (queue.length > 0) {
          const node = queue.shift()!;
          visited.push(node);
          for (const [neighbor] of adj.get(node) || []) {
            if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
          }
        }
        return JSON.stringify({ start, order: visited, visited_count: visited.length });
      }
      case "dfs": {
        const start = String(params.start || g.nodes[0]);
        const visited: string[] = [];
        const seen = new Set<string>();
        const stack = [start];
        while (stack.length > 0) {
          const node = stack.pop()!;
          if (seen.has(node)) continue;
          seen.add(node);
          visited.push(node);
          const neighbors = adj.get(node) || [];
          for (let i = neighbors.length - 1; i >= 0; i--) {
            if (!seen.has(neighbors[i][0])) stack.push(neighbors[i][0]);
          }
        }
        return JSON.stringify({ start, order: visited, visited_count: visited.length });
      }
      case "shortest_path": {
        const start = String(params.start || g.nodes[0]);
        const end = String(params.end || g.nodes[g.nodes.length - 1]);
        const dist = new Map<string, number>();
        const prev = new Map<string, string | null>();
        for (const n of g.nodes) { dist.set(n, Infinity); prev.set(n, null); }
        dist.set(start, 0);
        const unvisited = new Set(g.nodes);
        while (unvisited.size > 0) {
          let current: string | null = null;
          let min_dist = Infinity;
          for (const n of unvisited) {
            if ((dist.get(n) ?? Infinity) < min_dist) { min_dist = dist.get(n)!; current = n; }
          }
          if (!current || min_dist === Infinity) break;
          if (current === end) break;
          unvisited.delete(current);
          for (const [neighbor, weight] of adj.get(current) || []) {
            const alt = min_dist + weight;
            if (alt < (dist.get(neighbor) ?? Infinity)) { dist.set(neighbor, alt); prev.set(neighbor, current); }
          }
        }
        const path: string[] = [];
        let cur: string | null = end;
        while (cur) { path.unshift(cur); cur = prev.get(cur) ?? null; }
        if (path[0] !== start) return JSON.stringify({ error: `no path from ${start} to ${end}` });
        return JSON.stringify({ start, end, distance: dist.get(end), path });
      }
      case "topological_sort": {
        if (!g.directed) return JSON.stringify({ error: "topological sort requires directed graph" });
        const in_deg = new Map<string, number>();
        for (const n of g.nodes) in_deg.set(n, 0);
        for (const e of g.edges) in_deg.set(e.to, (in_deg.get(e.to) ?? 0) + 1);
        const queue = g.nodes.filter((n) => (in_deg.get(n) ?? 0) === 0);
        const sorted: string[] = [];
        while (queue.length > 0) {
          const node = queue.shift()!;
          sorted.push(node);
          for (const [neighbor] of adj.get(node) || []) {
            const d = (in_deg.get(neighbor) ?? 1) - 1;
            in_deg.set(neighbor, d);
            if (d === 0) queue.push(neighbor);
          }
        }
        if (sorted.length < g.nodes.length) return JSON.stringify({ error: "cycle detected, topological sort impossible", partial_order: sorted });
        return JSON.stringify({ order: sorted });
      }
      case "connected_components": {
        const visited = new Set<string>();
        const components: string[][] = [];
        for (const node of g.nodes) {
          if (visited.has(node)) continue;
          const component: string[] = [];
          const queue = [node];
          while (queue.length > 0) {
            const n = queue.shift()!;
            if (visited.has(n)) continue;
            visited.add(n);
            component.push(n);
            for (const [neighbor] of adj.get(n) || []) {
              if (!visited.has(neighbor)) queue.push(neighbor);
            }
            if (!g.directed) {
              for (const other of g.nodes) {
                if (visited.has(other)) continue;
                for (const [neighbor] of adj.get(other) || []) {
                  if (neighbor === n) { queue.push(other); break; }
                }
              }
            }
          }
          components.push(component);
        }
        return JSON.stringify({ count: components.length, components });
      }
      case "cycle_detect": {
        if (g.directed) {
          const white = new Set(g.nodes);
          const gray = new Set<string>();
          let has_cycle = false;
          const cycle_path: string[] = [];
          const dfs = (node: string): boolean => {
            white.delete(node);
            gray.add(node);
            for (const [neighbor] of adj.get(node) || []) {
              if (gray.has(neighbor)) { cycle_path.push(node, neighbor); return true; }
              if (white.has(neighbor) && dfs(neighbor)) return true;
            }
            gray.delete(node);
            return false;
          };
          for (const n of g.nodes) {
            if (white.has(n) && dfs(n)) { has_cycle = true; break; }
          }
          return JSON.stringify({ has_cycle, cycle_hint: has_cycle ? cycle_path : [] });
        }
        // 무방향 — union-find
        const parent = new Map<string, string>();
        for (const n of g.nodes) parent.set(n, n);
        const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
        let has_cycle = false;
        for (const e of g.edges) {
          const ra = find(e.from), rb = find(e.to);
          if (ra === rb) { has_cycle = true; break; }
          parent.set(ra, rb);
        }
        return JSON.stringify({ has_cycle });
      }
      case "mst": {
        if (g.directed) return JSON.stringify({ error: "MST requires undirected graph" });
        const sorted_edges = [...g.edges].sort((a, b) => (a.weight ?? 1) - (b.weight ?? 1));
        const parent = new Map<string, string>();
        for (const n of g.nodes) parent.set(n, n);
        const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
        const mst_edges: Edge[] = [];
        let total_weight = 0;
        for (const e of sorted_edges) {
          const ra = find(e.from), rb = find(e.to);
          if (ra !== rb) { parent.set(ra, rb); mst_edges.push(e); total_weight += e.weight ?? 1; }
        }
        return JSON.stringify({ edge_count: mst_edges.length, total_weight, edges: mst_edges });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_graph(val: unknown): GraphInput | null {
    try {
      const g = JSON.parse(String(val || "{}"));
      if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
      return g as GraphInput;
    } catch { return null; }
  }

  private build_adj(g: GraphInput): Map<string, [string, number][]> {
    const adj = new Map<string, [string, number][]>();
    for (const n of g.nodes) adj.set(n, []);
    for (const e of g.edges) {
      adj.get(e.from)?.push([e.to, e.weight ?? 1]);
      if (!g.directed) adj.get(e.to)?.push([e.from, e.weight ?? 1]);
    }
    return adj;
  }
}
