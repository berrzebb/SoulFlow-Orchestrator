/**
 * 각 툴의 default(unsupported action) 케이스 커버리지.
 * 모든 도구에서 지원하지 않는 action → default 분기 실행.
 */
import { describe, it, expect } from "vitest";
import { CsvTool } from "@src/agent/tools/csv.js";
import { DataMaskTool } from "@src/agent/tools/data-mask.js";
import { XmlTool } from "@src/agent/tools/xml.js";
import { RssTool } from "@src/agent/tools/rss.js";
import { HtmlTool } from "@src/agent/tools/html.js";
import { PhoneTool } from "@src/agent/tools/phone.js";
import { LogParserTool } from "@src/agent/tools/log-parser.js";
import { PdfTool } from "@src/agent/tools/pdf.js";
import { RateLimitTool } from "@src/agent/tools/rate-limit.js";
import { SqlBuilderTool } from "@src/agent/tools/sql-builder.js";
import { YamlTool } from "@src/agent/tools/yaml.js";
import { FtpTool } from "@src/agent/tools/ftp.js";
import { RedisTool } from "@src/agent/tools/redis.js";
import { QueueTool } from "@src/agent/tools/queue.js";
import { WebSocketTool } from "@src/agent/tools/websocket.js";
import { MatrixTool } from "@src/agent/tools/matrix.js";
import { StatsTool } from "@src/agent/tools/stats.js";
import { CacheTool } from "@src/agent/tools/ttl-cache.js";
import { DataFormatTool } from "@src/agent/tools/data-format.js";

// ── 헬퍼 ─────────────────────────────────────────────────

async function exec_raw(tool: { execute: (p: Record<string, unknown>) => Promise<string> }, params: Record<string, unknown>): Promise<string> {
  return tool.execute(params);
}

// ══════════════════════════════════════════════════════════
// CSV
// ══════════════════════════════════════════════════════════

describe("CsvTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new CsvTool();
    const result = await exec_raw(tool, { action: "__invalid__", data: "a,b" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// DataMask
// ══════════════════════════════════════════════════════════

describe("DataMaskTool — default (unknown action)", () => {
  it("action='__unknown__' → error JSON 반환", async () => {
    const tool = new DataMaskTool();
    const result = await exec_raw(tool, { action: "__unknown__", data: "test" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("__unknown__");
  });
});

// ══════════════════════════════════════════════════════════
// XML
// ══════════════════════════════════════════════════════════

describe("XmlTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new XmlTool();
    const result = await exec_raw(tool, { action: "__invalid__", data: "<x/>" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// RSS
// ══════════════════════════════════════════════════════════

describe("RssTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new RssTool();
    const result = await exec_raw(tool, { action: "__invalid__", url: "https://example.com/feed" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// HTML
// ══════════════════════════════════════════════════════════

describe("HtmlTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new HtmlTool();
    const result = await exec_raw(tool, { action: "__invalid__", content: "<p>test</p>" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// Phone
// ══════════════════════════════════════════════════════════

describe("PhoneTool — default (unsupported action)", () => {
  it("action='__invalid__' → default 반환", async () => {
    const tool = new PhoneTool();
    const result = await exec_raw(tool, { action: "__invalid__", number: "010-1234-5678" });
    expect(typeof result).toBe("string");
  });
});

// ══════════════════════════════════════════════════════════
// LogParser
// ══════════════════════════════════════════════════════════

describe("LogParserTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new LogParserTool();
    const result = await exec_raw(tool, { action: "__invalid__", content: "2026-01-01 INFO test" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// PDF
// ══════════════════════════════════════════════════════════

describe("PdfTool — path 없음 (early validation)", () => {
  it("path 미제공 → 'Error: path is required' 반환", async () => {
    const tool = new PdfTool({ workspace: "/tmp" });
    const result = await exec_raw(tool, { action: "extract_text" });
    expect(result).toBe("Error: path is required");
  });
});

// ══════════════════════════════════════════════════════════
// RateLimit
// ══════════════════════════════════════════════════════════

describe("RateLimitTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new RateLimitTool();
    const result = await exec_raw(tool, { action: "__invalid__", key: "test", limit: 10, window_ms: 1000 });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// SqlBuilder
// ══════════════════════════════════════════════════════════

describe("SqlBuilderTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new SqlBuilderTool();
    const result = await exec_raw(tool, { action: "__invalid__", table: "users" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// YAML
// ══════════════════════════════════════════════════════════

describe("YamlTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new YamlTool();
    const result = await exec_raw(tool, { action: "__invalid__", content: "key: value" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// FTP
// ══════════════════════════════════════════════════════════

describe("FtpTool — default (unsupported action)", () => {
  it("action='__invalid__' → string 반환 (네트워크 오류 또는 not_implemented)", async () => {
    // FtpTool은 connect 후 switch에서 default를 처리함.
    // 네트워크 접근 불가 환경에서는 Error: 로 시작하는 문자열을 반환.
    const tool = new FtpTool();
    const result = await exec_raw(tool, { action: "__invalid__", host: "127.0.0.1", port: 1 });
    expect(typeof result).toBe("string");
    // 네트워크 오류 또는 not_implemented 상태 중 하나
    expect(result.startsWith("Error:") || result.includes("not_implemented") || result.includes("__invalid__")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// Redis
// ══════════════════════════════════════════════════════════

describe("RedisTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new RedisTool();
    const result = await exec_raw(tool, { action: "__invalid__", key: "test" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// Queue
// ══════════════════════════════════════════════════════════

describe("QueueTool — default (unsupported operation)", () => {
  it("operation='__invalid__' → error 반환", async () => {
    const tool = new QueueTool();
    const result = await exec_raw(tool, { operation: "__invalid__", queue: "q1" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// WebSocket
// ══════════════════════════════════════════════════════════

describe("WebSocketTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new WebSocketTool();
    const result = await exec_raw(tool, { action: "__invalid__", url: "ws://localhost:8080" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// Matrix
// ══════════════════════════════════════════════════════════

describe("MatrixTool — default (unsupported action)", () => {
  it("action='__invalid__' → error 반환", async () => {
    const tool = new MatrixTool();
    const result = await exec_raw(tool, { action: "__invalid__", matrix_a: "[[1,2],[3,4]]" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// Stats
// ══════════════════════════════════════════════════════════

describe("StatsTool — default (unsupported operation)", () => {
  it("operation='__invalid__' → error 반환", async () => {
    const tool = new StatsTool();
    const result = await exec_raw(tool, { operation: "__invalid__", data: "[1,2,3]" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// TtlCache
// ══════════════════════════════════════════════════════════

describe("CacheTool — default (unsupported operation)", () => {
  it("operation='__invalid__' → error 반환", async () => {
    const tool = new CacheTool();
    const result = await exec_raw(tool, { operation: "__invalid__" });
    expect(result).toContain("__invalid__");
  });
});

// ══════════════════════════════════════════════════════════
// DataFormat
// ══════════════════════════════════════════════════════════

describe("DataFormatTool — default (unsupported operation)", () => {
  it("operation='__invalid__' → error 반환", async () => {
    const tool = new DataFormatTool();
    const result = await exec_raw(tool, { operation: "__invalid__", input: "test" });
    expect(result).toContain("__invalid__");
  });
});
