/**
 * 노드 핸들러 create_default() 커버리지.
 * 각 핸들러의 create_default()를 호출하여 기본값 객체 반환 확인.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { circuit_breaker_handler } from "@src/agent/nodes/circuit-breaker.js";
import { csv_handler } from "@src/agent/nodes/csv.js";
import { data_mask_handler } from "@src/agent/nodes/data-mask.js";
import { ftp_handler } from "@src/agent/nodes/ftp.js";
import { graph_handler } from "@src/agent/nodes/graph.js";
import { json_schema_handler } from "@src/agent/nodes/json-schema.js";
import { ldap_handler } from "@src/agent/nodes/ldap.js";
import { log_parser_handler } from "@src/agent/nodes/log-parser.js";
import { math_handler } from "@src/agent/nodes/math.js";
import { openapi_handler } from "@src/agent/nodes/openapi.js";
import { pdf_handler } from "@src/agent/nodes/pdf.js";
import { queue_handler } from "@src/agent/nodes/queue.js";
import { rate_limit_handler } from "@src/agent/nodes/rate-limit.js";
import { redis_handler } from "@src/agent/nodes/redis.js";
import { rss_handler } from "@src/agent/nodes/rss.js";
import { s3_handler } from "@src/agent/nodes/s3.js";
import { set_ops_handler } from "@src/agent/nodes/set-ops.js";
import { sql_builder_handler } from "@src/agent/nodes/sql-builder.js";
import { state_machine_handler } from "@src/agent/nodes/state-machine.js";
import { stats_handler } from "@src/agent/nodes/stats.js";
import { websocket_handler } from "@src/agent/nodes/websocket.js";
import { xml_handler } from "@src/agent/nodes/xml.js";
import { yaml_handler } from "@src/agent/nodes/yaml.js";
import { date_calc_handler } from "@src/agent/nodes/date-calc.js";
import { secret_read_handler } from "@src/agent/nodes/secret-read.js";
import { table_handler } from "@src/agent/nodes/table.js";
import { template_engine_handler } from "@src/agent/nodes/template-engine.js";
import { tokenizer_handler } from "@src/agent/nodes/tokenizer.js";
import { matrix_handler } from "@src/agent/nodes/matrix.js";
import { code_diagram_handler } from "@src/agent/nodes/code-diagram.js";
import { document_docx_handler, document_pdf_handler, document_pptx_handler, document_xlsx_handler } from "@src/agent/nodes/document.js";
import { email_handler } from "@src/agent/nodes/email.js";
import { graphql_handler } from "@src/agent/nodes/graphql.js";
import { mqtt_handler } from "@src/agent/nodes/mqtt.js";
import { ttl_cache_handler } from "@src/agent/nodes/ttl-cache.js";
import { barcode_handler } from "@src/agent/nodes/barcode.js";
import { data_format_handler } from "@src/agent/nodes/data-format.js";
import { database_handler } from "@src/agent/nodes/database.js";
import { retriever_handler } from "@src/agent/nodes/retriever.js";
import { ssh_handler } from "@src/agent/nodes/ssh.js";
import { validator_handler } from "@src/agent/nodes/validator.js";
import { web_search_handler } from "@src/agent/nodes/web-search.js";
import { http_handler } from "@src/agent/nodes/http.js";

describe("NodeHandlers — create_default()", () => {
  it("circuit_breaker create_default", () => {
    expect(circuit_breaker_handler.create_default?.()).toBeDefined();
  });
  it("csv create_default", () => {
    expect(csv_handler.create_default?.()).toBeDefined();
  });
  it("data_mask create_default", () => {
    expect(data_mask_handler.create_default?.()).toBeDefined();
  });
  it("ftp create_default", () => {
    expect(ftp_handler.create_default?.()).toBeDefined();
  });
  it("graph create_default", () => {
    expect(graph_handler.create_default?.()).toBeDefined();
  });
  it("json_schema create_default", () => {
    expect(json_schema_handler.create_default?.()).toBeDefined();
  });
  it("ldap create_default", () => {
    expect(ldap_handler.create_default?.()).toBeDefined();
  });
  it("log_parser create_default", () => {
    expect(log_parser_handler.create_default?.()).toBeDefined();
  });
  it("math create_default", () => {
    expect(math_handler.create_default?.()).toBeDefined();
  });
  it("openapi create_default", () => {
    expect(openapi_handler.create_default?.()).toBeDefined();
  });
  it("pdf create_default", () => {
    expect(pdf_handler.create_default?.()).toBeDefined();
  });
  it("queue create_default", () => {
    expect(queue_handler.create_default?.()).toBeDefined();
  });
  it("rate_limit create_default", () => {
    expect(rate_limit_handler.create_default?.()).toBeDefined();
  });
  it("redis create_default", () => {
    expect(redis_handler.create_default?.()).toBeDefined();
  });
  it("rss create_default", () => {
    expect(rss_handler.create_default?.()).toBeDefined();
  });
  it("s3 create_default", () => {
    expect(s3_handler.create_default?.()).toBeDefined();
  });
  it("set_ops create_default", () => {
    expect(set_ops_handler.create_default?.()).toBeDefined();
  });
  it("sql_builder create_default", () => {
    expect(sql_builder_handler.create_default?.()).toBeDefined();
  });
  it("state_machine create_default", () => {
    expect(state_machine_handler.create_default?.()).toBeDefined();
  });
  it("stats create_default", () => {
    expect(stats_handler.create_default?.()).toBeDefined();
  });
  it("websocket create_default", () => {
    expect(websocket_handler.create_default?.()).toBeDefined();
  });
  it("xml create_default", () => {
    expect(xml_handler.create_default?.()).toBeDefined();
  });
  it("yaml create_default", () => {
    expect(yaml_handler.create_default?.()).toBeDefined();
  });
  it("date_calc create_default", () => {
    expect(date_calc_handler.create_default?.()).toBeDefined();
  });
  it("secret_read create_default", () => {
    expect(secret_read_handler.create_default?.()).toBeDefined();
  });
  it("table create_default", () => {
    expect(table_handler.create_default?.()).toBeDefined();
  });
  it("template_engine create_default", () => {
    expect(template_engine_handler.create_default?.()).toBeDefined();
  });
  it("tokenizer create_default", () => {
    expect(tokenizer_handler.create_default?.()).toBeDefined();
  });
  it("matrix create_default", () => {
    expect(matrix_handler.create_default?.()).toBeDefined();
  });
  it("code_diagram create_default", () => {
    expect(code_diagram_handler.create_default?.()).toBeDefined();
  });
  it("document_docx create_default", () => {
    expect(document_docx_handler.create_default?.()).toBeDefined();
  });
  it("document_pdf create_default", () => {
    expect(document_pdf_handler.create_default?.()).toBeDefined();
  });
  it("document_pptx create_default", () => {
    expect(document_pptx_handler.create_default?.()).toBeDefined();
  });
  it("document_xlsx create_default", () => {
    expect(document_xlsx_handler.create_default?.()).toBeDefined();
  });
  it("email create_default", () => {
    expect(email_handler.create_default?.()).toBeDefined();
  });
  it("graphql create_default", () => {
    expect(graphql_handler.create_default?.()).toBeDefined();
  });
  it("mqtt create_default", () => {
    expect(mqtt_handler.create_default?.()).toBeDefined();
  });
  it("ttl_cache create_default", () => {
    expect(ttl_cache_handler.create_default?.()).toBeDefined();
  });
  it("barcode create_default", () => {
    expect(barcode_handler.create_default?.()).toBeDefined();
  });
  it("data_format create_default", () => {
    expect(data_format_handler.create_default?.()).toBeDefined();
  });
  it("database create_default", () => {
    expect(database_handler.create_default?.()).toBeDefined();
  });
});

// ══════════════════════════════════════════
// create_default() 미커버 4종
// ══════════════════════════════════════════

describe("NodeHandlers — create_default() 미커버 4종", () => {
  it("retriever create_default → source/query/url/top_k 필드 (L27)", () => {
    const d = retriever_handler.create_default!();
    expect(d).toBeDefined();
    expect(d.source).toBe("http");
    expect(d.top_k).toBe(5);
  });

  it("ssh create_default → action/host/command/port 필드 (L22)", () => {
    const d = ssh_handler.create_default!();
    expect(d).toBeDefined();
    expect(d.action).toBe("exec");
    expect(d.port).toBe(22);
  });

  it("validator create_default → operation/input/format/schema/rules 필드 (L23)", () => {
    const d = validator_handler.create_default!();
    expect(d).toBeDefined();
    expect(d.operation).toBe("format");
    expect(d.format).toBe("json");
  });

  it("web_search create_default → query/max_results/search_engine 필드 (L23)", () => {
    const d = web_search_handler.create_default!();
    expect(d).toBeDefined();
    expect(d.max_results).toBe(5);
    expect(d.search_engine).toBe("google");
  });
});

// ══════════════════════════════════════════
// http.ts L58: 비문자열 body → JSON.stringify 분기
// ══════════════════════════════════════════

describe("http_handler — 비문자열 body → JSON.stringify (L58)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("object body → JSON.stringify 후 Content-Type 자동 설정", async () => {
    const mock_fetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ ok: true }),
    });
    vi.stubGlobal("fetch", mock_fetch);

    const node = {
      node_id: "h1",
      node_type: "http",
      url: "https://api.example.com/data",
      method: "POST",
      body: { key: "value", count: 42 }, // 객체 → L58: JSON.stringify
    } as any;

    const result = await http_handler.execute(node, { memory: {} } as any);
    expect(result.output.status).toBe(200);

    // fetch 호출 시 body가 JSON 문자열로 전달됐는지 확인
    const call_args = mock_fetch.mock.calls[0];
    const init = call_args[1];
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body)).toEqual({ key: "value", count: 42 });
    // Content-Type 헤더가 자동 추가됨
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("number body → JSON.stringify (L58)", async () => {
    const mock_fetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: { get: () => "text/plain" },
      text: async () => "ok",
    });
    vi.stubGlobal("fetch", mock_fetch);

    const node = {
      node_id: "h2",
      node_type: "http",
      url: "https://api.example.com/num",
      method: "POST",
      body: 99, // 숫자 → L58: JSON.stringify
    } as any;

    const result = await http_handler.execute(node, { memory: {} } as any);
    expect(result.output.status).toBe(200);

    const init = mock_fetch.mock.calls[0][1];
    expect(init.body).toBe("99");
  });
});
