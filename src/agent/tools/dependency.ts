/** Dependency 도구 — 패키지 의존성 파싱/분석/순환 감지. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class DependencyTool extends Tool {
  readonly name = "dependency";
  readonly category = "data" as const;
  readonly description = "Dependency analysis: parse_package_json, parse_requirements, tree, circular, outdated_check, stats.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse_package_json", "parse_requirements", "tree", "circular", "stats", "compare"], description: "Operation" },
      input: { type: "string", description: "File content (package.json or requirements.txt)" },
      input2: { type: "string", description: "Second file for compare" },
      graph: { type: "string", description: "JSON adjacency list {pkg: [deps]}" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse_package_json");

    switch (action) {
      case "parse_package_json": {
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(String(params.input || "{}")); } catch { return JSON.stringify({ error: "invalid JSON" }); }
        const deps = Object.entries((pkg.dependencies || {}) as Record<string, string>).map(([name, version]) => ({ name, version, type: "prod" }));
        const dev_deps = Object.entries((pkg.devDependencies || {}) as Record<string, string>).map(([name, version]) => ({ name, version, type: "dev" }));
        const peer_deps = Object.entries((pkg.peerDependencies || {}) as Record<string, string>).map(([name, version]) => ({ name, version, type: "peer" }));
        const all = [...deps, ...dev_deps, ...peer_deps];
        return JSON.stringify({
          name: pkg.name, version: pkg.version,
          prod_count: deps.length, dev_count: dev_deps.length, peer_count: peer_deps.length,
          total: all.length, dependencies: all,
        });
      }
      case "parse_requirements": {
        const input = String(params.input || "");
        const deps: { name: string; version: string; extras?: string }[] = [];
        for (const line of input.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
          const m = /^([a-zA-Z0-9._-]+)(?:\[([^\]]+)\])?\s*([<>=!~]+.+)?$/.exec(trimmed);
          if (m) deps.push({ name: m[1], version: m[3] || "*", extras: m[2] || undefined });
        }
        return JSON.stringify({ count: deps.length, dependencies: deps });
      }
      case "tree": {
        let graph: Record<string, string[]>;
        try { graph = JSON.parse(String(params.graph || "{}")); } catch { return JSON.stringify({ error: "invalid graph JSON" }); }
        const tree = this.build_tree(graph);
        return JSON.stringify(tree);
      }
      case "circular": {
        let graph: Record<string, string[]>;
        try { graph = JSON.parse(String(params.graph || "{}")); } catch { return JSON.stringify({ error: "invalid graph JSON" }); }
        const cycles = this.find_cycles(graph);
        return JSON.stringify({ has_cycles: cycles.length > 0, cycle_count: cycles.length, cycles });
      }
      case "stats": {
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(String(params.input || "{}")); } catch { return JSON.stringify({ error: "invalid JSON" }); }
        const deps = (pkg.dependencies || {}) as Record<string, string>;
        const dev = (pkg.devDependencies || {}) as Record<string, string>;
        const all_versions = [...Object.values(deps), ...Object.values(dev)];
        const pinned = all_versions.filter((v) => /^\d/.test(v)).length;
        const ranged = all_versions.filter((v) => /^[~^>=<]/.test(v)).length;
        const wildcard = all_versions.filter((v) => v === "*" || v === "latest").length;
        return JSON.stringify({
          total: all_versions.length, pinned, ranged, wildcard,
          prod: Object.keys(deps).length, dev: Object.keys(dev).length,
        });
      }
      case "compare": {
        let pkg1: Record<string, unknown>, pkg2: Record<string, unknown>;
        try { pkg1 = JSON.parse(String(params.input || "{}")); } catch { return JSON.stringify({ error: "invalid input JSON" }); }
        try { pkg2 = JSON.parse(String(params.input2 || "{}")); } catch { return JSON.stringify({ error: "invalid input2 JSON" }); }
        const d1 = { ...(pkg1.dependencies || {}), ...(pkg1.devDependencies || {}) } as Record<string, string>;
        const d2 = { ...(pkg2.dependencies || {}), ...(pkg2.devDependencies || {}) } as Record<string, string>;
        const added = Object.keys(d2).filter((k) => !(k in d1));
        const removed = Object.keys(d1).filter((k) => !(k in d2));
        const changed = Object.keys(d1).filter((k) => k in d2 && d1[k] !== d2[k]).map((k) => ({ name: k, from: d1[k], to: d2[k] }));
        return JSON.stringify({ added, removed, changed, unchanged: Object.keys(d1).length - removed.length - changed.length });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private build_tree(graph: Record<string, string[]>): Record<string, unknown> {
    const roots = Object.keys(graph).filter((k) => !Object.values(graph).some((deps) => deps.includes(k)));
    const visited = new Set<string>();
    const build = (node: string): Record<string, unknown> => {
      if (visited.has(node)) return { name: node, circular: true };
      visited.add(node);
      const children = (graph[node] || []).map(build);
      visited.delete(node);
      return { name: node, dependencies: children };
    };
    return { roots: (roots.length > 0 ? roots : Object.keys(graph).slice(0, 1)).map(build) };
  }

  private find_cycles(graph: Record<string, string[]>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      if (stack.has(node)) {
        const idx = path.indexOf(node);
        if (idx >= 0) cycles.push(path.slice(idx).concat(node));
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      stack.add(node);
      path.push(node);
      for (const dep of graph[node] || []) dfs(dep);
      path.pop();
      stack.delete(node);
    };

    for (const node of Object.keys(graph)) dfs(node);
    return cycles;
  }
}
