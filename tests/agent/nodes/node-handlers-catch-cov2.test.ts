/**
 * 노드 핸들러 catch 분기 커버리지 보충 (cov2).
 * 각 핸들러의 execute() 내 catch 블록 커버 — dynamic import를 사용하는 30개 핸들러.
 */
import { describe, it, expect, vi } from "vitest";

// ── tool mocks (vi.mock 호이스팅) ─────────────────────────────────

const csv_execute = vi.fn();
vi.mock("@src/agent/tools/csv.js", () => ({ CsvTool: class { execute = csv_execute; } }));

const data_mask_execute = vi.fn();
vi.mock("@src/agent/tools/data-mask.js", () => ({ DataMaskTool: class { execute = data_mask_execute; } }));

const duration_execute = vi.fn();
vi.mock("@src/agent/tools/duration.js", () => ({ DurationTool: class { execute = duration_execute; } }));

const ftp_execute = vi.fn();
vi.mock("@src/agent/tools/ftp.js", () => ({ FtpTool: class { execute = ftp_execute; } }));

const graph_execute = vi.fn();
vi.mock("@src/agent/tools/graph.js", () => ({ GraphTool: class { execute = graph_execute; } }));

const json_schema_execute = vi.fn();
vi.mock("@src/agent/tools/json-schema.js", () => ({ JsonSchemaTool: class { execute = json_schema_execute; } }));

const ldap_execute = vi.fn();
vi.mock("@src/agent/tools/ldap.js", () => ({ LdapTool: class { execute = ldap_execute; } }));

const log_parser_execute = vi.fn();
vi.mock("@src/agent/tools/log-parser.js", () => ({ LogParserTool: class { execute = log_parser_execute; } }));

const math_execute = vi.fn();
vi.mock("@src/agent/tools/math.js", () => ({ MathTool: class { execute = math_execute; } }));

const openapi_execute = vi.fn();
vi.mock("@src/agent/tools/openapi.js", () => ({ OpenApiTool: class { execute = openapi_execute; } }));

const pdf_execute = vi.fn();
vi.mock("@src/agent/tools/pdf.js", () => ({ PdfTool: class { execute = pdf_execute; } }));

const qr_execute = vi.fn();
vi.mock("@src/agent/tools/qr.js", () => ({ QrTool: class { execute = qr_execute; } }));

const queue_execute = vi.fn();
vi.mock("@src/agent/tools/queue.js", () => ({ QueueTool: class { execute = queue_execute; } }));

const rate_limit_execute = vi.fn();
vi.mock("@src/agent/tools/rate-limit.js", () => ({ RateLimitTool: class { execute = rate_limit_execute; } }));

const redis_execute = vi.fn();
vi.mock("@src/agent/tools/redis.js", () => ({ RedisTool: class { execute = redis_execute; } }));

const rss_execute = vi.fn();
vi.mock("@src/agent/tools/rss.js", () => ({ RssTool: class { execute = rss_execute; } }));

const s3_execute = vi.fn();
vi.mock("@src/agent/tools/s3.js", () => ({ S3Tool: class { execute = s3_execute; } }));

const set_execute = vi.fn();
vi.mock("@src/agent/tools/set.js", () => ({ SetTool: class { execute = set_execute; } }));

const sql_builder_execute = vi.fn();
vi.mock("@src/agent/tools/sql-builder.js", () => ({ SqlBuilderTool: class { execute = sql_builder_execute; } }));

const state_machine_execute = vi.fn();
vi.mock("@src/agent/tools/state-machine.js", () => ({ StateMachineTool: class { execute = state_machine_execute; } }));

const stats_execute = vi.fn();
vi.mock("@src/agent/tools/stats.js", () => ({ StatsTool: class { execute = stats_execute; } }));

const websocket_execute = vi.fn();
vi.mock("@src/agent/tools/websocket.js", () => ({ WebSocketTool: class { execute = websocket_execute; } }));

const xml_execute = vi.fn();
vi.mock("@src/agent/tools/xml.js", () => ({ XmlTool: class { execute = xml_execute; } }));

const yaml_execute = vi.fn();
vi.mock("@src/agent/tools/yaml.js", () => ({ YamlTool: class { execute = yaml_execute; } }));

const eval_execute = vi.fn();
vi.mock("@src/agent/tools/eval.js", () => ({ EvalTool: class { execute = eval_execute; } }));

const format_execute = vi.fn();
vi.mock("@src/agent/tools/format.js", () => ({ FormatTool: class { execute = format_execute; } }));

const image_execute = vi.fn();
vi.mock("@src/agent/tools/image.js", () => ({ ImageTool: class { execute = image_execute; } }));

const lookup_execute = vi.fn();
vi.mock("@src/agent/tools/lookup.js", () => ({ LookupTool: class { execute = lookup_execute; } }));

const password_execute = vi.fn();
vi.mock("@src/agent/tools/password.js", () => ({ PasswordTool: class { execute = password_execute; } }));

const table_execute = vi.fn();
vi.mock("@src/agent/tools/table.js", () => ({ TableTool: class { execute = table_execute; } }));

const template_execute = vi.fn();
vi.mock("@src/agent/tools/template-engine.js", () => ({ TemplateTool: class { execute = template_execute; } }));

const text_execute = vi.fn();
vi.mock("@src/agent/tools/text.js", () => ({ TextTool: class { execute = text_execute; } }));

const tokenizer_execute = vi.fn();
vi.mock("@src/agent/tools/tokenizer.js", () => ({ TokenizerTool: class { execute = tokenizer_execute; } }));

const crypto_execute = vi.fn();
vi.mock("@src/agent/tools/crypto.js", () => ({ CryptoTool: class { execute = crypto_execute; } }));

const datetime_execute = vi.fn();
vi.mock("@src/agent/tools/datetime.js", () => ({ DateTimeTool: class { execute = datetime_execute; } }));

const hash_execute = vi.fn();
vi.mock("@src/agent/tools/hash.js", () => ({ HashTool: class { execute = hash_execute; } }));

const markdown_execute = vi.fn();
vi.mock("@src/agent/tools/markdown.js", () => ({ MarkdownTool: class { execute = markdown_execute; } }));

const jwt_execute = vi.fn();
vi.mock("@src/agent/tools/jwt.js", () => ({ JwtTool: class { execute = jwt_execute; } }));

// ── handler imports ────────────────────────────────────────────────

import { csv_handler } from "@src/agent/nodes/csv.js";
import { data_mask_handler } from "@src/agent/nodes/data-mask.js";
import { duration_handler } from "@src/agent/nodes/duration.js";
import { ftp_handler } from "@src/agent/nodes/ftp.js";
import { graph_handler } from "@src/agent/nodes/graph.js";
import { json_schema_handler } from "@src/agent/nodes/json-schema.js";
import { ldap_handler } from "@src/agent/nodes/ldap.js";
import { log_parser_handler } from "@src/agent/nodes/log-parser.js";
import { math_handler } from "@src/agent/nodes/math.js";
import { openapi_handler } from "@src/agent/nodes/openapi.js";
import { pdf_handler } from "@src/agent/nodes/pdf.js";
import { qr_handler } from "@src/agent/nodes/qr.js";
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
import { eval_handler } from "@src/agent/nodes/eval.js";
import { format_handler } from "@src/agent/nodes/format.js";
import { image_handler } from "@src/agent/nodes/image.js";
import { lookup_handler } from "@src/agent/nodes/lookup.js";
import { password_handler } from "@src/agent/nodes/password.js";
import { table_handler } from "@src/agent/nodes/table.js";
import { template_engine_handler } from "@src/agent/nodes/template-engine.js";
import { text_handler } from "@src/agent/nodes/text.js";
import { tokenizer_handler } from "@src/agent/nodes/tokenizer.js";
import { crypto_handler } from "@src/agent/nodes/crypto.js";
import { date_calc_handler } from "@src/agent/nodes/date-calc.js";
import { hash_handler } from "@src/agent/nodes/hash.js";
import { markdown_handler } from "@src/agent/nodes/markdown.js";
import { jwt_handler } from "@src/agent/nodes/jwt.js";

// ── 공통 헬퍼 ─────────────────────────────────────────────────────

function node(params: Record<string, unknown> = {}) {
  return { node_type: "test", ...params } as any;
}
const ctx = () => ({ workspace: "/tmp/test", memory: {} } as any);

// ── 각 핸들러 catch 테스트 ─────────────────────────────────────────

const cases: Array<{ name: string; execute_fn: ReturnType<typeof vi.fn>; handler: any; node_params?: Record<string, unknown>; catch_key: string }> = [
  { name: "csv",           execute_fn: csv_execute,          handler: csv_handler,          catch_key: "success" },
  { name: "data_mask",     execute_fn: data_mask_execute,    handler: data_mask_handler,    catch_key: "masked" },
  { name: "duration",      execute_fn: duration_execute,     handler: duration_handler,     catch_key: "result" },
  { name: "ftp",           execute_fn: ftp_execute,          handler: ftp_handler,          catch_key: "result" },
  { name: "graph",         execute_fn: graph_execute,        handler: graph_handler,        catch_key: "result" },
  { name: "json_schema",   execute_fn: json_schema_execute,  handler: json_schema_handler,  catch_key: "result" },
  { name: "ldap",          execute_fn: ldap_execute,         handler: ldap_handler,         catch_key: "result" },
  { name: "log_parser",    execute_fn: log_parser_execute,   handler: log_parser_handler,   catch_key: "records" },
  { name: "math",          execute_fn: math_execute,         handler: math_handler,         catch_key: "result" },
  { name: "openapi",       execute_fn: openapi_execute,      handler: openapi_handler,      catch_key: "result" },
  { name: "pdf",           execute_fn: pdf_execute,          handler: pdf_handler,          catch_key: "text" },
  { name: "qr",            execute_fn: qr_execute,           handler: qr_handler,           catch_key: "result" },
  { name: "queue",         execute_fn: queue_execute,        handler: queue_handler,        catch_key: "result" },
  { name: "rate_limit",    execute_fn: rate_limit_execute,   handler: rate_limit_handler,   catch_key: "allowed" },
  { name: "redis",         execute_fn: redis_execute,        handler: redis_handler,        catch_key: "result" },
  { name: "rss",           execute_fn: rss_execute,          handler: rss_handler,          catch_key: "result" },
  { name: "s3",            execute_fn: s3_execute,           handler: s3_handler,           catch_key: "result" },
  { name: "set_ops",       execute_fn: set_execute,          handler: set_ops_handler,      catch_key: "result" },
  { name: "sql_builder",   execute_fn: sql_builder_execute,  handler: sql_builder_handler,  catch_key: "sql" },
  { name: "state_machine", execute_fn: state_machine_execute,handler: state_machine_handler,catch_key: "result" },
  { name: "stats",         execute_fn: stats_execute,        handler: stats_handler,        catch_key: "result" },
  { name: "websocket",     execute_fn: websocket_execute,    handler: websocket_handler,    catch_key: "result" },
  { name: "xml",           execute_fn: xml_execute,          handler: xml_handler,          catch_key: "result" },
  { name: "yaml",          execute_fn: yaml_execute,         handler: yaml_handler,         catch_key: "result" },
  { name: "eval",          execute_fn: eval_execute,         handler: eval_handler,         catch_key: "result" },
  { name: "format",        execute_fn: format_execute,       handler: format_handler,       catch_key: "result" },
  { name: "image",         execute_fn: image_execute,        handler: image_handler,        catch_key: "result" },
  { name: "lookup",        execute_fn: lookup_execute,       handler: lookup_handler,       catch_key: "result" },
  { name: "password",      execute_fn: password_execute,     handler: password_handler,     catch_key: "result" },
  { name: "table",         execute_fn: table_execute,        handler: table_handler,        catch_key: "result" },
  { name: "template_engine",execute_fn: template_execute,   handler: template_engine_handler,catch_key: "result" },
  { name: "text",          execute_fn: text_execute,         handler: text_handler,         catch_key: "result" },
  { name: "tokenizer",     execute_fn: tokenizer_execute,    handler: tokenizer_handler,    catch_key: "result" },
  { name: "crypto",        execute_fn: crypto_execute,       handler: crypto_handler,       catch_key: "result" },
  { name: "date_calc",     execute_fn: datetime_execute,     handler: date_calc_handler,    catch_key: "result" },
  { name: "hash",          execute_fn: hash_execute,         handler: hash_handler,         catch_key: "digest" },
  { name: "markdown",      execute_fn: markdown_execute,     handler: markdown_handler,     catch_key: "result" },
  { name: "jwt",           execute_fn: jwt_execute,          handler: jwt_handler,          catch_key: "token" },
];

describe("node handlers — catch 분기 (cov2)", () => {
  for (const { name, execute_fn, handler, catch_key } of cases) {
    it(`${name}_handler — tool.execute throw → catch 반환`, async () => {
      execute_fn.mockRejectedValueOnce(new Error(`${name} tool error`));
      const result = await handler.execute(node(), ctx());
      expect(result.output).toHaveProperty(catch_key);
    });
  }
});
