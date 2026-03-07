/** Tree 도구 — 트리 자료구조 탐색/시각화. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface TreeNode { id: string; children?: TreeNode[]; label?: string; }

export class TreeTool extends Tool {
  readonly name = "tree";
  readonly category = "data" as const;
  readonly description = "Tree data structure: traverse, flatten, find, depth, to_ascii, from_parent_list, lca.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["traverse", "flatten", "find", "depth", "to_ascii", "from_parent_list", "lca"], description: "Operation" },
      tree: { type: "string", description: "Tree JSON: {id, children?, label?}" },
      order: { type: "string", enum: ["pre", "in", "post", "level"], description: "Traversal order (default: pre)" },
      target: { type: "string", description: "Target node ID (find)" },
      node_a: { type: "string", description: "First node ID (lca)" },
      node_b: { type: "string", description: "Second node ID (lca)" },
      parents: { type: "string", description: "JSON array of {id, parent} (from_parent_list)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "traverse");

    if (action === "from_parent_list") {
      let items: { id: string; parent: string | null; label?: string }[];
      try { items = JSON.parse(String(params.parents || "[]")); } catch { return JSON.stringify({ error: "invalid parents JSON" }); }
      const nodes = new Map<string, TreeNode>();
      for (const item of items) nodes.set(item.id, { id: item.id, children: [], label: item.label });
      let root: TreeNode | null = null;
      for (const item of items) {
        if (!item.parent) { root = nodes.get(item.id)!; continue; }
        const parent = nodes.get(item.parent);
        if (parent) parent.children!.push(nodes.get(item.id)!);
      }
      if (!root) return JSON.stringify({ error: "no root node found (parent=null)" });
      return JSON.stringify({ tree: root });
    }

    const tree = this.parse_tree(params.tree);
    if (!tree) return JSON.stringify({ error: "invalid tree JSON" });

    switch (action) {
      case "traverse": {
        const order = String(params.order || "pre");
        const result: string[] = [];
        if (order === "level") {
          const queue: TreeNode[] = [tree];
          while (queue.length > 0) {
            const node = queue.shift()!;
            result.push(node.id);
            if (node.children) queue.push(...node.children);
          }
        } else {
          this.dfs(tree, order, result);
        }
        return JSON.stringify({ order, nodes: result, count: result.length });
      }
      case "flatten": {
        const flat: { id: string; depth: number; label?: string; parent?: string }[] = [];
        const walk = (node: TreeNode, depth: number, parent?: string) => {
          flat.push({ id: node.id, depth, label: node.label, parent });
          if (node.children) for (const c of node.children) walk(c, depth + 1, node.id);
        };
        walk(tree, 0);
        return JSON.stringify({ nodes: flat, count: flat.length });
      }
      case "find": {
        const target = String(params.target || "");
        const path = this.find_path(tree, target);
        if (!path) return JSON.stringify({ found: false, target });
        const node = path[path.length - 1];
        return JSON.stringify({ found: true, target, path: path.map((n) => n.id), depth: path.length - 1, node: { id: node.id, label: node.label, child_count: node.children?.length ?? 0 } });
      }
      case "depth": {
        const max_depth = this.calc_depth(tree);
        const node_count = this.count_nodes(tree);
        const leaf_count = this.count_leaves(tree);
        return JSON.stringify({ max_depth, node_count, leaf_count, branching_factor: node_count > 1 ? Math.round(((node_count - 1) / (node_count - leaf_count || 1)) * 100) / 100 : 0 });
      }
      case "to_ascii": {
        const lines: string[] = [];
        this.ascii_tree(tree, "", true, lines);
        return JSON.stringify({ ascii: lines.join("\n"), line_count: lines.length });
      }
      case "lca": {
        const a = String(params.node_a || "");
        const b = String(params.node_b || "");
        const path_a = this.find_path(tree, a);
        const path_b = this.find_path(tree, b);
        if (!path_a) return JSON.stringify({ error: `node '${a}' not found` });
        if (!path_b) return JSON.stringify({ error: `node '${b}' not found` });
        let lca: TreeNode = tree;
        for (let i = 0; i < Math.min(path_a.length, path_b.length); i++) {
          if (path_a[i].id === path_b[i].id) lca = path_a[i];
          else break;
        }
        return JSON.stringify({ node_a: a, node_b: b, lca: lca.id, depth: this.find_path(tree, lca.id)!.length - 1 });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private parse_tree(val: unknown): TreeNode | null {
    try {
      const t = JSON.parse(String(val || "{}"));
      if (!t.id) return null;
      return t as TreeNode;
    } catch { return null; }
  }

  private dfs(node: TreeNode, order: string, result: string[]): void {
    if (order === "pre") result.push(node.id);
    const children = node.children || [];
    if (children.length > 0) {
      this.dfs(children[0], order, result);
      if (order === "in") result.push(node.id);
      for (let i = 1; i < children.length; i++) this.dfs(children[i], order, result);
    } else if (order === "in") {
      result.push(node.id);
    }
    if (order === "post") result.push(node.id);
  }

  private find_path(node: TreeNode, target: string, path: TreeNode[] = []): TreeNode[] | null {
    path.push(node);
    if (node.id === target) return [...path];
    for (const child of node.children || []) {
      const result = this.find_path(child, target, path);
      if (result) return result;
    }
    path.pop();
    return null;
  }

  private calc_depth(node: TreeNode): number {
    if (!node.children?.length) return 0;
    return 1 + Math.max(...node.children.map((c) => this.calc_depth(c)));
  }

  private count_nodes(node: TreeNode): number {
    return 1 + (node.children || []).reduce((sum, c) => sum + this.count_nodes(c), 0);
  }

  private count_leaves(node: TreeNode): number {
    if (!node.children?.length) return 1;
    return node.children.reduce((sum, c) => sum + this.count_leaves(c), 0);
  }

  private ascii_tree(node: TreeNode, prefix: string, is_last: boolean, lines: string[]): void {
    const connector = is_last ? "└── " : "├── ";
    const label = node.label ? `${node.id} (${node.label})` : node.id;
    lines.push(prefix + (lines.length === 0 ? "" : connector) + label);
    const children = node.children || [];
    const child_prefix = prefix + (lines.length <= 1 ? "" : is_last ? "    " : "│   ");
    for (let i = 0; i < children.length; i++) {
      this.ascii_tree(children[i], child_prefix, i === children.length - 1, lines);
    }
  }
}
