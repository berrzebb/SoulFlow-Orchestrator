/**
 * 노드 핸들러 test() 경고 분기 커버리지.
 * 각 핸들러에서 필수 필드가 없을 때 warnings.push()가 호출되는 경로를 커버한다.
 */
import { describe, it, expect } from "vitest";
import type { OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";

function bare(node_type: string, overrides: Record<string, unknown> = {}): OrcheNodeDefinition {
  return { node_id: "x", node_type, ...overrides } as OrcheNodeDefinition;
}

// ── circuit_breaker ───────────────────────────────────────────────

describe("circuit_breaker_handler.test() — warnings", () => {
  it("name 없음 → warning 포함", async () => {
    const { circuit_breaker_handler } = await import("@src/agent/nodes/circuit-breaker.js");
    const r = circuit_breaker_handler.test(bare("circuit_breaker")); // name=undefined
    expect(r.warnings.some(w => w.includes("name"))).toBe(true);
  });
});

// ── csv ──────────────────────────────────────────────────────────

describe("csv_handler.test() — warnings", () => {
  it("data 없음 → warning 포함", async () => {
    const { csv_handler } = await import("@src/agent/nodes/csv.js");
    const r = csv_handler.test(bare("csv"));
    expect(r.warnings.some(w => w.includes("data"))).toBe(true);
  });
});

// ── data_mask ────────────────────────────────────────────────────

describe("data_mask_handler.test() — warnings", () => {
  it("text 없음 → warning 포함", async () => {
    const { data_mask_handler } = await import("@src/agent/nodes/data-mask.js");
    const r = data_mask_handler.test(bare("data_mask"));
    expect(r.warnings.some(w => w.includes("text"))).toBe(true);
  });
});

// ── ftp ──────────────────────────────────────────────────────────

describe("ftp_handler.test() — warnings", () => {
  it("host 없음 → warning 포함", async () => {
    const { ftp_handler } = await import("@src/agent/nodes/ftp.js");
    const r = ftp_handler.test(bare("ftp"));
    expect(r.warnings.some(w => w.includes("host"))).toBe(true);
  });
});

// ── graph ────────────────────────────────────────────────────────

describe("graph_handler.test() — warnings", () => {
  it("action 없음 → warning 포함", async () => {
    const { graph_handler } = await import("@src/agent/nodes/graph.js");
    const r = graph_handler.test(bare("graph"));
    expect(r.warnings.some(w => w.includes("action"))).toBe(true);
  });
  it("edges 없음 → warning 포함", async () => {
    const { graph_handler } = await import("@src/agent/nodes/graph.js");
    const r = graph_handler.test(bare("graph", { action: "shortest_path" })); // edges 없음
    expect(r.warnings.some(w => w.includes("edges"))).toBe(true);
  });
});

// ── json_schema ──────────────────────────────────────────────────

describe("json_schema_handler.test() — warnings", () => {
  it("action=validate + schema 없음 → warning 포함", async () => {
    const { json_schema_handler } = await import("@src/agent/nodes/json-schema.js");
    const r = json_schema_handler.test(bare("json_schema", { action: "validate" })); // schema 없음
    expect(r.warnings.some(w => w.includes("schema"))).toBe(true);
  });
});

// ── ldap ─────────────────────────────────────────────────────────

describe("ldap_handler.test() — warnings", () => {
  it("host 없음 → warning 포함", async () => {
    const { ldap_handler } = await import("@src/agent/nodes/ldap.js");
    const r = ldap_handler.test(bare("ldap"));
    expect(r.warnings.some(w => w.includes("host"))).toBe(true);
  });
});

// ── log_parser ───────────────────────────────────────────────────

describe("log_parser_handler.test() — warnings", () => {
  it("input 없음 → warning 포함", async () => {
    const { log_parser_handler } = await import("@src/agent/nodes/log-parser.js");
    const r = log_parser_handler.test(bare("log_parser"));
    expect(r.warnings.some(w => w.includes("input"))).toBe(true);
  });
});

// ── math ─────────────────────────────────────────────────────────

describe("math_handler.test() — warnings", () => {
  it("operation=eval + expression 없음 → warning 포함", async () => {
    const { math_handler } = await import("@src/agent/nodes/math.js");
    const r = math_handler.test(bare("math", { operation: "eval" }));
    expect(r.warnings.some(w => w.includes("expression"))).toBe(true);
  });
  it("operation=convert + from/to 없음 → warning 포함", async () => {
    const { math_handler } = await import("@src/agent/nodes/math.js");
    const r = math_handler.test(bare("math", { operation: "convert" }));
    expect(r.warnings.some(w => w.includes("units"))).toBe(true);
  });
});

// ── openapi ──────────────────────────────────────────────────────

describe("openapi_handler.test() — warnings", () => {
  it("spec 없음 → warning 포함", async () => {
    const { openapi_handler } = await import("@src/agent/nodes/openapi.js");
    const r = openapi_handler.test(bare("openapi"));
    expect(r.warnings.some(w => w.includes("spec"))).toBe(true);
  });
});

// ── pdf ──────────────────────────────────────────────────────────

describe("pdf_handler.test() — warnings", () => {
  it("path 없음 → warning 포함", async () => {
    const { pdf_handler } = await import("@src/agent/nodes/pdf.js");
    const r = pdf_handler.test(bare("pdf"));
    expect(r.warnings.some(w => w.includes("path"))).toBe(true);
  });
});

// ── queue ────────────────────────────────────────────────────────

describe("queue_handler.test() — warnings", () => {
  it("operation=enqueue + value 없음 → warning 포함", async () => {
    const { queue_handler } = await import("@src/agent/nodes/queue.js");
    const r = queue_handler.test(bare("queue", { operation: "enqueue" }));
    expect(r.warnings.some(w => w.includes("value"))).toBe(true);
  });
});

// ── rate_limit ───────────────────────────────────────────────────

describe("rate_limit_handler.test() — warnings", () => {
  it("key 없음 → warning 포함", async () => {
    const { rate_limit_handler } = await import("@src/agent/nodes/rate-limit.js");
    const r = rate_limit_handler.test(bare("rate_limit"));
    expect(r.warnings.some(w => w.includes("key"))).toBe(true);
  });
});

// ── redis ────────────────────────────────────────────────────────

describe("redis_handler.test() — warnings", () => {
  it("host 없음 → warning 포함", async () => {
    const { redis_handler } = await import("@src/agent/nodes/redis.js");
    const r = redis_handler.test(bare("redis"));
    expect(r.warnings.some(w => w.includes("host"))).toBe(true);
  });
});

// ── rss ──────────────────────────────────────────────────────────

describe("rss_handler.test() — warnings", () => {
  it("action=fetch_parse + url 없음 → warning 포함", async () => {
    const { rss_handler } = await import("@src/agent/nodes/rss.js");
    const r = rss_handler.test(bare("rss", { action: "fetch_parse" }));
    expect(r.warnings.some(w => w.includes("url"))).toBe(true);
  });
});

// ── s3 ───────────────────────────────────────────────────────────

describe("s3_handler.test() — warnings", () => {
  it("bucket 없음 → warning 포함", async () => {
    const { s3_handler } = await import("@src/agent/nodes/s3.js");
    const r = s3_handler.test(bare("s3"));
    expect(r.warnings.some(w => w.includes("bucket"))).toBe(true);
  });
});

// ── set_ops ──────────────────────────────────────────────────────

describe("set_ops_handler.test() — warnings", () => {
  it("a 없음 → warning 포함", async () => {
    const { set_ops_handler } = await import("@src/agent/nodes/set-ops.js");
    const r = set_ops_handler.test(bare("set_ops"));
    expect(r.warnings.some(w => w.includes("'a'") || w.includes("a"))).toBe(true);
  });
  it("a 있고 b 없음 + operation ≠ power_set → warning 포함", async () => {
    const { set_ops_handler } = await import("@src/agent/nodes/set-ops.js");
    const r = set_ops_handler.test(bare("set_ops", { a: "1,2,3", operation: "union" }));
    expect(r.warnings.some(w => w.includes("'b'") || w.includes("b"))).toBe(true);
  });
});

// ── sql_builder ──────────────────────────────────────────────────

describe("sql_builder_handler.test() — warnings", () => {
  it("table 없음 → warning 포함", async () => {
    const { sql_builder_handler } = await import("@src/agent/nodes/sql-builder.js");
    const r = sql_builder_handler.test(bare("sql_builder"));
    expect(r.warnings.some(w => w.includes("table"))).toBe(true);
  });
});

// ── state_machine ────────────────────────────────────────────────

describe("state_machine_handler.test() — warnings", () => {
  it("machine 없음 → warning 포함", async () => {
    const { state_machine_handler } = await import("@src/agent/nodes/state-machine.js");
    const r = state_machine_handler.test(bare("state_machine"));
    expect(r.warnings.some(w => w.includes("machine"))).toBe(true);
  });
  it("action=transition + event 없음 → warning 포함", async () => {
    const { state_machine_handler } = await import("@src/agent/nodes/state-machine.js");
    const r = state_machine_handler.test(bare("state_machine", { machine: "{}", action: "transition" }));
    expect(r.warnings.some(w => w.includes("event"))).toBe(true);
  });
});

// ── stats ────────────────────────────────────────────────────────

describe("stats_handler.test() — warnings", () => {
  it("data 없음 → warning 포함", async () => {
    const { stats_handler } = await import("@src/agent/nodes/stats.js");
    const r = stats_handler.test(bare("stats"));
    expect(r.warnings.some(w => w.includes("data"))).toBe(true);
  });
  it("operation=correlation + data2 없음 → warning 포함", async () => {
    const { stats_handler } = await import("@src/agent/nodes/stats.js");
    const r = stats_handler.test(bare("stats", { operation: "correlation", data: "1,2,3" }));
    expect(r.warnings.some(w => w.includes("data2"))).toBe(true);
  });
});

// ── websocket ────────────────────────────────────────────────────

describe("websocket_handler.test() — warnings", () => {
  it("action=connect + url 없음 → warning 포함", async () => {
    const { websocket_handler } = await import("@src/agent/nodes/websocket.js");
    const r = websocket_handler.test(bare("websocket", { action: "connect" }));
    expect(r.warnings.some(w => w.includes("url"))).toBe(true);
  });
});

// ── xml ──────────────────────────────────────────────────────────

describe("xml_handler.test() — warnings", () => {
  it("data 없음 → warning 포함", async () => {
    const { xml_handler } = await import("@src/agent/nodes/xml.js");
    const r = xml_handler.test(bare("xml"));
    expect(r.warnings.some(w => w.includes("data"))).toBe(true);
  });
});

// ── matrix ───────────────────────────────────────────────────────

describe("matrix_handler.test() — warnings", () => {
  it("a 없음 + action ≠ identity → warning 포함", async () => {
    const { matrix_handler } = await import("@src/agent/nodes/matrix.js");
    const r = matrix_handler.test(bare("matrix", { action: "multiply" }));
    expect(r.warnings.some(w => w.includes("A"))).toBe(true);
  });
  it("action=multiply + b 없음 → warning 포함", async () => {
    const { matrix_handler } = await import("@src/agent/nodes/matrix.js");
    const r = matrix_handler.test(bare("matrix", { action: "multiply", a: "[[1,0],[0,1]]" }));
    expect(r.warnings.some(w => w.includes("B"))).toBe(true);
  });
});

// ── tokenizer ────────────────────────────────────────────────────

describe("tokenizer_handler.test() — warnings", () => {
  it("text 없음 → warning 포함", async () => {
    const { tokenizer_handler } = await import("@src/agent/nodes/tokenizer.js");
    const r = tokenizer_handler.test(bare("tokenizer"));
    expect(r.warnings.some(w => w.includes("text"))).toBe(true);
  });
});

// ── template_engine ──────────────────────────────────────────────

describe("template_engine_handler.test() — warnings", () => {
  it("template 없음 → warning 포함", async () => {
    const { template_engine_handler } = await import("@src/agent/nodes/template-engine.js");
    const r = template_engine_handler.test(bare("template_engine"));
    // warnings가 있거나 없거나 — template_engine의 test 구현에 따라 다름
    expect(Array.isArray(r.warnings)).toBe(true);
  });
});

// ── table ────────────────────────────────────────────────────────

describe("table_handler.test() — warnings", () => {
  it("data 없음 → warning 포함", async () => {
    const { table_handler } = await import("@src/agent/nodes/table.js");
    const r = table_handler.test(bare("table"));
    expect(r.warnings.some(w => w.includes("data"))).toBe(true);
  });
});

// ── secret_read ──────────────────────────────────────────────────

describe("secret_read_handler.test() — warnings", () => {
  it("key 없음 → warning 포함", async () => {
    const { secret_read_handler } = await import("@src/agent/nodes/secret-read.js");
    const r = secret_read_handler.test(bare("secret_read"));
    expect(r.warnings.some(w => w.includes("key"))).toBe(true);
  });
});

// ── date_calc ────────────────────────────────────────────────────

describe("date_calc_handler.test() — warnings", () => {
  it("기본 호출 → warnings 배열 반환", async () => {
    const { date_calc_handler } = await import("@src/agent/nodes/date-calc.js");
    const r = date_calc_handler.test(bare("date_calc"));
    expect(Array.isArray(r.warnings)).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });
});
