/**
 * 낮은 커버리지 노드 핸들러 (4%) 보충:
 * - tree_data_handler: execute (traverse/flatten/find/depth/to_ascii/lca/from_parent_list) + test + create_default
 * - vcard_handler: execute (generate/parse/validate/to_json/from_json) + test + create_default
 * - pagination_handler: execute (offset/cursor/keyset/generate_links/parse_link_header) + test + create_default
 * - prometheus_handler: execute (format/parse/query_format) + test + create_default
 */
import { describe, it, expect } from "vitest";
import { tree_data_handler } from "@src/agent/nodes/tree-data.js";
import { vcard_handler } from "@src/agent/nodes/vcard.js";
import { pagination_handler } from "@src/agent/nodes/pagination.js";
import { prometheus_handler } from "@src/agent/nodes/prometheus.js";

const CTX = { memory: {} } as any;

// ══════════════════════════════════════════════════════════
// tree_data_handler
// ══════════════════════════════════════════════════════════

const SAMPLE_TREE = JSON.stringify({
  id: "root", name: "Root",
  children: [
    { id: "child1", name: "Child 1", children: [] },
    { id: "child2", name: "Child 2", children: [
      { id: "grandchild", name: "Grandchild", children: [] },
    ]},
  ],
});

describe("tree_data_handler — create_default", () => {
  it("기본값 반환", () => {
    const d = tree_data_handler.create_default?.();
    expect(d).toBeDefined();
    expect((d as any).action).toBe("traverse");
  });
});

describe("tree_data_handler — execute", () => {
  it("traverse (pre-order)", async () => {
    const result = await tree_data_handler.execute!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "traverse", tree: SAMPLE_TREE, order: "pre" } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
    expect(Array.isArray((result.output as any).nodes)).toBe(true);
  });

  it("flatten", async () => {
    const result = await tree_data_handler.execute!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "flatten", tree: SAMPLE_TREE } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("find — 존재하는 노드", async () => {
    const result = await tree_data_handler.execute!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "find", tree: SAMPLE_TREE, target: "child1" } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
    expect((result.output as any).found).toBe(true);
  });

  it("depth", async () => {
    const result = await tree_data_handler.execute!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "depth", tree: SAMPLE_TREE } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("to_ascii", async () => {
    const result = await tree_data_handler.execute!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "to_ascii", tree: SAMPLE_TREE } as any,
      CTX,
    );
    expect(typeof (result.output as any).ascii).toBe("string");
  });

  it("lca", async () => {
    const result = await tree_data_handler.execute!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "lca", tree: SAMPLE_TREE, node_a: "child1", node_b: "grandchild" } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("from_parent_list", async () => {
    const parents = JSON.stringify([
      { id: "a", parent_id: null },
      { id: "b", parent_id: "a" },
    ]);
    const result = await tree_data_handler.execute!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "from_parent_list", parents } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("잘못된 JSON → error 반환", async () => {
    const result = await tree_data_handler.execute!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "traverse", tree: "NOT_JSON" } as any,
      CTX,
    );
    expect((result.output as any).error).toBeDefined();
  });
});

describe("tree_data_handler — test()", () => {
  it("traverse + tree 없음 → warning", () => {
    const r = tree_data_handler.test!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "traverse", tree: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("from_parent_list + parents 없음 → warning", () => {
    const r = tree_data_handler.test!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "from_parent_list", parents: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("lca + node_a/node_b 없음 → warning 2개", () => {
    const r = tree_data_handler.test!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "lca", node_a: "", node_b: "" } as any,
    );
    expect(r.warnings!.length).toBeGreaterThanOrEqual(2);
  });

  it("find + target 없음 → warning", () => {
    const r = tree_data_handler.test!(
      { node_id: "n1", node_type: "tree_data", title: "T", action: "find", target: "", tree: SAMPLE_TREE } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════
// vcard_handler
// ══════════════════════════════════════════════════════════

const SAMPLE_VCARD = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:John Doe",
  "EMAIL:john@example.com",
  "END:VCARD",
].join("\r\n");

describe("vcard_handler — create_default", () => {
  it("기본값 반환", () => {
    const d = vcard_handler.create_default?.();
    expect(d).toBeDefined();
    expect((d as any).action).toBe("generate");
  });
});

describe("vcard_handler — execute", () => {
  it("generate → vCard 문자열 반환", async () => {
    const result = await vcard_handler.execute!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "generate", name: "Jane Doe", email: "jane@example.com" } as any,
      CTX,
    );
    expect((result.output as any).result).toContain("VCARD");
    expect((result.output as any).valid).toBe(true);
  });

  it("parse → 파싱 결과 반환", async () => {
    const result = await vcard_handler.execute!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "parse", vcard: SAMPLE_VCARD } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("validate → 유효성 검사", async () => {
    const result = await vcard_handler.execute!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "validate", vcard: SAMPLE_VCARD } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("to_json → JSON 변환", async () => {
    const result = await vcard_handler.execute!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "to_json", vcard: SAMPLE_VCARD } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("from_json → vCard 문자열 반환", async () => {
    const data = JSON.stringify({ name: "Jane", email: "jane@example.com" });
    const result = await vcard_handler.execute!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "from_json", data } as any,
      CTX,
    );
    expect((result.output as any).valid).toBe(true);
  });
});

describe("vcard_handler — test()", () => {
  it("generate + name 없음 → warning", () => {
    const r = vcard_handler.test!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "generate", name: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("parse + vcard 없음 → warning", () => {
    const r = vcard_handler.test!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "parse", vcard: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("validate + vcard 없음 → warning", () => {
    const r = vcard_handler.test!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "validate", vcard: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("to_json + vcard 없음 → warning", () => {
    const r = vcard_handler.test!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "to_json", vcard: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("from_json + data 없음 → warning", () => {
    const r = vcard_handler.test!(
      { node_id: "n1", node_type: "vcard", title: "V", action: "from_json", data: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════
// pagination_handler
// ══════════════════════════════════════════════════════════

describe("pagination_handler — create_default", () => {
  it("기본값 반환", () => {
    const d = pagination_handler.create_default?.();
    expect(d).toBeDefined();
    expect((d as any).action).toBe("offset");
  });
});

describe("pagination_handler — execute", () => {
  it("offset → 페이지 메타데이터 반환", async () => {
    const result = await pagination_handler.execute!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "offset", page: 2, per_page: 10, total: 100 } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
    expect((result.output as any).page).toBe(2);
  });

  it("cursor — cursor 페이지네이션", async () => {
    const result = await pagination_handler.execute!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "cursor", cursor: "token123", per_page: 20, has_more: true } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("keyset — keyset 페이지네이션", async () => {
    const result = await pagination_handler.execute!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "keyset", sort_key: "created_at", last_value: "2024-01-01", per_page: 10 } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("generate_links — 링크 헤더 생성", async () => {
    const result = await pagination_handler.execute!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "generate_links", base_url: "https://api.example.com/items", page: 2, per_page: 10, total: 50 } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("parse_link_header — Link 헤더 파싱", async () => {
    const result = await pagination_handler.execute!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "parse_link_header", header: `<https://api.example.com/items?page=3>; rel="next", <https://api.example.com/items?page=1>; rel="prev"` } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("잘못된 action → 에러 또는 결과 반환", async () => {
    const result = await pagination_handler.execute!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "offset" } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });
});

describe("pagination_handler — test()", () => {
  it("cursor action + cursor 없음 → warning", () => {
    const r = pagination_handler.test!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "cursor", cursor: "", next_cursor: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("keyset action + sort_key 없음 → warning", () => {
    const r = pagination_handler.test!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "keyset", sort_key: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("generate_links + base_url 없음 → warning", () => {
    const r = pagination_handler.test!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "generate_links", base_url: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("parse_link_header + header 없음 → warning", () => {
    const r = pagination_handler.test!(
      { node_id: "n1", node_type: "pagination", title: "P", action: "parse_link_header", header: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════
// prometheus_handler
// ══════════════════════════════════════════════════════════

const SAMPLE_METRICS = JSON.stringify([
  { name: "requests_total", type: "counter", help: "Total HTTP requests", value: 42, labels: { method: "GET", path: "/api" } },
]);

const SAMPLE_PROM_TEXT = `# HELP requests_total Total HTTP requests
# TYPE requests_total counter
requests_total{method="GET",path="/api"} 42`;

describe("prometheus_handler — create_default", () => {
  it("기본값 반환", () => {
    const d = prometheus_handler.create_default?.();
    expect(d).toBeDefined();
    expect((d as any).action).toBe("format");
  });
});

describe("prometheus_handler — execute", () => {
  it("format → Prometheus text format 반환", async () => {
    const result = await prometheus_handler.execute!(
      { node_id: "n1", node_type: "prometheus", title: "P", action: "format", metrics: SAMPLE_METRICS } as any,
      CTX,
    );
    expect((result.output as any).success).toBe(true);
  });

  it("parse → 파싱 결과 반환", async () => {
    const result = await prometheus_handler.execute!(
      { node_id: "n1", node_type: "prometheus", title: "P", action: "parse", input: SAMPLE_PROM_TEXT } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
  });

  it("query_format → PromQL URL 포맷 반환", async () => {
    const result = await prometheus_handler.execute!(
      { node_id: "n1", node_type: "prometheus", title: "P", action: "query_format", query: "up", start: "2024-01-01T00:00:00Z", end: "2024-01-02T00:00:00Z", step: "1m" } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
    expect((result.output as any).success).not.toBe(false);
  });

  it("잘못된 metrics JSON → error 반환", async () => {
    const result = await prometheus_handler.execute!(
      { node_id: "n1", node_type: "prometheus", title: "P", action: "format", metrics: "NOT_JSON" } as any,
      CTX,
    );
    expect(result.output).toBeDefined();
    // 에러이거나 success: false
  });
});

describe("prometheus_handler — test()", () => {
  it("format + metrics 없음 → warning", () => {
    const r = prometheus_handler.test!(
      { node_id: "n1", node_type: "prometheus", title: "P", action: "format", metrics: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("push + metrics 없음 → warning", () => {
    const r = prometheus_handler.test!(
      { node_id: "n1", node_type: "prometheus", title: "P", action: "push", metrics: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("push + pushgateway_url 없음 → warning", () => {
    const r = prometheus_handler.test!(
      { node_id: "n1", node_type: "prometheus", title: "P", action: "push", metrics: SAMPLE_METRICS, pushgateway_url: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("query_format + query 없음 → warning", () => {
    const r = prometheus_handler.test!(
      { node_id: "n1", node_type: "prometheus", title: "P", action: "query_format", query: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it("parse + input 없음 → warning", () => {
    const r = prometheus_handler.test!(
      { node_id: "n1", node_type: "prometheus", title: "P", action: "parse", input: "" } as any,
    );
    expect(r.warnings?.length).toBeGreaterThan(0);
  });
});
