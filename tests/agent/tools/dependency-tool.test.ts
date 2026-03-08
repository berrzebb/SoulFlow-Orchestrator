/**
 * DependencyTool — 의존성 파싱/분석/순환 감지 커버리지.
 */
import { describe, it, expect } from "vitest";
import { DependencyTool } from "@src/agent/tools/dependency.js";

const tool = new DependencyTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const PKG_JSON = JSON.stringify({
  name: "my-app",
  version: "1.0.0",
  dependencies: { express: "^4.18.0", lodash: "4.17.21" },
  devDependencies: { vitest: "^4.0.0", typescript: "~5.0.0" },
  peerDependencies: { react: ">=18.0.0" },
});

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("DependencyTool — 메타데이터", () => {
  it("name = dependency", () => expect(tool.name).toBe("dependency"));
  it("category = data", () => expect(tool.category).toBe("data"));
  it("to_schema type = function", () => expect(tool.to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// parse_package_json
// ══════════════════════════════════════════

describe("DependencyTool — parse_package_json", () => {
  it("전체 의존성 파싱 (prod/dev/peer)", async () => {
    const r = await exec({ action: "parse_package_json", input: PKG_JSON }) as Record<string, unknown>;
    expect(r.name).toBe("my-app");
    expect(r.prod_count).toBe(2);
    expect(r.dev_count).toBe(2);
    expect(r.peer_count).toBe(1);
    expect(r.total).toBe(5);
  });

  it("dependencies 없음 → 빈 배열", async () => {
    const r = await exec({ action: "parse_package_json", input: JSON.stringify({ name: "empty" }) }) as Record<string, unknown>;
    expect(r.total).toBe(0);
    expect(r.prod_count).toBe(0);
  });

  it("잘못된 JSON → error 반환", async () => {
    const r = await exec({ action: "parse_package_json", input: "not-json" }) as Record<string, unknown>;
    expect(r.error).toBe("invalid JSON");
  });

  it("input 없음 → 빈 객체 처리 (total=0)", async () => {
    const r = await exec({ action: "parse_package_json" }) as Record<string, unknown>;
    expect(r.total).toBe(0);
  });

  it("의존성 타입 확인 (prod/dev/peer)", async () => {
    const r = await exec({ action: "parse_package_json", input: PKG_JSON }) as Record<string, unknown>;
    const deps = r.dependencies as Array<{ name: string; type: string }>;
    const prod = deps.filter((d) => d.type === "prod");
    const dev = deps.filter((d) => d.type === "dev");
    const peer = deps.filter((d) => d.type === "peer");
    expect(prod.length).toBe(2);
    expect(dev.length).toBe(2);
    expect(peer.length).toBe(1);
  });
});

// ══════════════════════════════════════════
// parse_requirements
// ══════════════════════════════════════════

describe("DependencyTool — parse_requirements", () => {
  const REQS = [
    "# comment",
    "requests>=2.28.0",
    "flask[async]~=2.0",
    "-r other-requirements.txt",
    "   ",
    "numpy==1.26.0",
  ].join("\n");

  it("requirements.txt 파싱", async () => {
    const r = await exec({ action: "parse_requirements", input: REQS }) as Record<string, unknown>;
    expect(r.count).toBe(3);
    const deps = r.dependencies as Array<{ name: string; version: string; extras?: string }>;
    expect(deps.map((d) => d.name)).toContain("requests");
    expect(deps.map((d) => d.name)).toContain("flask");
    expect(deps.map((d) => d.name)).toContain("numpy");
  });

  it("extras 파싱 (flask[async])", async () => {
    const r = await exec({ action: "parse_requirements", input: "flask[async]~=2.0" }) as Record<string, unknown>;
    const deps = r.dependencies as Array<{ name: string; extras?: string }>;
    expect(deps[0]?.extras).toBe("async");
  });

  it("버전 없음 → *", async () => {
    const r = await exec({ action: "parse_requirements", input: "requests" }) as Record<string, unknown>;
    const deps = r.dependencies as Array<{ version: string }>;
    expect(deps[0]?.version).toBe("*");
  });

  it("빈 입력 → 0개", async () => {
    const r = await exec({ action: "parse_requirements", input: "" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });

  it("# 주석 라인 스킵", async () => {
    const r = await exec({ action: "parse_requirements", input: "# comment\nrequests>=2.0" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
  });

  it("- 로 시작하는 라인 스킵 (-r, --index-url)", async () => {
    const r = await exec({ action: "parse_requirements", input: "-r other.txt\n--index-url http://...\nrequests" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
  });
});

// ══════════════════════════════════════════
// tree
// ══════════════════════════════════════════

describe("DependencyTool — tree", () => {
  it("의존성 트리 생성", async () => {
    const graph = { a: ["b", "c"], b: ["d"], c: [], d: [] };
    const r = await exec({ action: "tree", graph: JSON.stringify(graph) }) as Record<string, unknown>;
    const roots = r.roots as Array<{ name: string; dependencies: unknown[] }>;
    expect(roots[0]?.name).toBe("a");
    expect(roots[0]?.dependencies).toHaveLength(2);
  });

  it("루트 없음 → 첫 번째 노드를 루트로", async () => {
    // 순환이면 모든 노드가 다른 노드에 의존
    const graph = { a: ["b"], b: ["a"] };
    const r = await exec({ action: "tree", graph: JSON.stringify(graph) }) as Record<string, unknown>;
    expect(r.roots).toBeDefined();
  });

  it("순환 노드 → circular: true (루트 없을 때 첫 노드에서 감지)", async () => {
    // 모든 노드가 서로를 참조 → roots=[], fallback으로 a부터 순회 → b→a 순환 감지
    const graph = { a: ["b"], b: ["a"] };
    const r = await exec({ action: "tree", graph: JSON.stringify(graph) }) as Record<string, unknown>;
    const json = JSON.stringify(r);
    expect(json).toContain("circular");
  });

  it("잘못된 graph JSON → error", async () => {
    const r = await exec({ action: "tree", graph: "not-json" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// circular
// ══════════════════════════════════════════

describe("DependencyTool — circular", () => {
  it("순환 없음 → has_cycles: false", async () => {
    const graph = { a: ["b"], b: ["c"], c: [] };
    const r = await exec({ action: "circular", graph: JSON.stringify(graph) }) as Record<string, unknown>;
    expect(r.has_cycles).toBe(false);
    expect(r.cycle_count).toBe(0);
  });

  it("순환 있음 → has_cycles: true + cycles 배열", async () => {
    const graph = { a: ["b"], b: ["c"], c: ["a"] };
    const r = await exec({ action: "circular", graph: JSON.stringify(graph) }) as Record<string, unknown>;
    expect(r.has_cycles).toBe(true);
    expect(r.cycle_count).toBeGreaterThan(0);
    const cycles = r.cycles as string[][];
    expect(cycles[0]).toContain("a");
  });

  it("빈 그래프 → 순환 없음", async () => {
    const r = await exec({ action: "circular", graph: "{}" }) as Record<string, unknown>;
    expect(r.has_cycles).toBe(false);
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "circular", graph: "bad" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// stats
// ══════════════════════════════════════════

describe("DependencyTool — stats", () => {
  it("버전 타입별 분류", async () => {
    const r = await exec({ action: "stats", input: PKG_JSON }) as Record<string, unknown>;
    expect(typeof r.total).toBe("number");
    expect(typeof r.pinned).toBe("number"); // "4.17.21" → pinned
    expect(typeof r.ranged).toBe("number"); // "^4.18.0" → ranged
  });

  it("pinned 버전 (숫자 시작)", async () => {
    const pkg = JSON.stringify({ dependencies: { a: "1.0.0", b: "2.3.4" } });
    const r = await exec({ action: "stats", input: pkg }) as Record<string, unknown>;
    expect(r.pinned).toBe(2);
    expect(r.ranged).toBe(0);
  });

  it("ranged 버전 (^/~/>=/<)", async () => {
    const pkg = JSON.stringify({ dependencies: { a: "^1.0", b: "~2.0", c: ">=3.0", d: "<4.0" } });
    const r = await exec({ action: "stats", input: pkg }) as Record<string, unknown>;
    expect(r.ranged).toBe(4);
    expect(r.pinned).toBe(0);
  });

  it("wildcard (*、latest)", async () => {
    const pkg = JSON.stringify({ dependencies: { a: "*", b: "latest" } });
    const r = await exec({ action: "stats", input: pkg }) as Record<string, unknown>;
    expect(r.wildcard).toBe(2);
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "stats", input: "bad" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// compare
// ══════════════════════════════════════════

describe("DependencyTool — compare", () => {
  it("added/removed/changed 감지", async () => {
    const pkg1 = JSON.stringify({ dependencies: { a: "1.0.0", b: "2.0.0" } });
    const pkg2 = JSON.stringify({ dependencies: { b: "3.0.0", c: "1.0.0" } });
    const r = await exec({ action: "compare", input: pkg1, input2: pkg2 }) as Record<string, unknown>;
    expect((r.added as string[])).toContain("c");
    expect((r.removed as string[])).toContain("a");
    const changed = r.changed as Array<{ name: string; from: string; to: string }>;
    expect(changed[0]?.name).toBe("b");
    expect(changed[0]?.from).toBe("2.0.0");
    expect(changed[0]?.to).toBe("3.0.0");
  });

  it("동일한 패키지 → unchanged 카운트", async () => {
    const pkg = JSON.stringify({ dependencies: { a: "1.0.0" } });
    const r = await exec({ action: "compare", input: pkg, input2: pkg }) as Record<string, unknown>;
    expect(r.unchanged).toBe(1);
    expect((r.changed as unknown[]).length).toBe(0);
  });

  it("devDependencies도 비교 대상", async () => {
    const pkg1 = JSON.stringify({ devDependencies: { vitest: "^3.0.0" } });
    const pkg2 = JSON.stringify({ devDependencies: { vitest: "^4.0.0" } });
    const r = await exec({ action: "compare", input: pkg1, input2: pkg2 }) as Record<string, unknown>;
    const changed = r.changed as Array<{ name: string }>;
    expect(changed.some((c) => c.name === "vitest")).toBe(true);
  });

  it("input 잘못된 JSON → error", async () => {
    const r = await exec({ action: "compare", input: "bad", input2: "{}" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("input2 잘못된 JSON → error", async () => {
    const r = await exec({ action: "compare", input: "{}", input2: "bad" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("DependencyTool — unknown action", () => {
  it("bogus → error 반환", async () => {
    const r = await exec({ action: "bogus" }) as Record<string, unknown>;
    expect(r.error).toContain("bogus");
  });
});
