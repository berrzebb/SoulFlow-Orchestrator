/**
 * RssTool + DatabaseTool 커버리지.
 */
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RssTool } from "@src/agent/tools/rss.js";
import { DatabaseTool } from "@src/agent/tools/database.js";

afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════
// RssTool
// ══════════════════════════════════════════

const rss = new RssTool();

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>A test feed</description>
    <item>
      <title>Article 1</title>
      <link>https://example.com/1</link>
      <description>First article</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <guid>https://example.com/1</guid>
    </item>
    <item>
      <title>Article 2</title>
      <link>https://example.com/2</link>
    </item>
  </channel>
</rss>`;

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link href="https://atom.example.com" />
  <subtitle>A test atom feed</subtitle>
  <entry>
    <title>Entry 1</title>
    <link href="https://atom.example.com/1" />
    <summary>First entry</summary>
    <updated>2024-01-01T00:00:00Z</updated>
    <id>urn:1</id>
  </entry>
</feed>`;

describe("RssTool — 메타데이터", () => {
  it("name = rss", () => expect(rss.name).toBe("rss"));
  it("category = data", () => expect(rss.category).toBe("data"));
  it("to_schema: function 형식", () => expect(rss.to_schema().type).toBe("function"));
});

describe("RssTool — parse (RSS)", () => {
  it("RSS XML 파싱 → items 배열 반환", async () => {
    const r = await rss.execute({ action: "parse", input: SAMPLE_RSS });
    const parsed = JSON.parse(r);
    expect(parsed.type).toBe("rss");
    expect(parsed.title).toBe("Test Feed");
    expect(parsed.count).toBe(2);
    expect(parsed.items[0].title).toBe("Article 1");
    expect(parsed.items[0].link).toBe("https://example.com/1");
  });

  it("빈 RSS → 빈 items", async () => {
    const r = await rss.execute({ action: "parse", input: "" });
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(0);
  });
});

describe("RssTool — parse (Atom)", () => {
  it("Atom XML 파싱 → type=atom, entries 반환", async () => {
    const r = await rss.execute({ action: "parse", input: SAMPLE_ATOM });
    const parsed = JSON.parse(r);
    expect(parsed.type).toBe("atom");
    expect(parsed.title).toBe("Atom Feed");
    expect(parsed.count).toBe(1);
    expect(parsed.items[0].title).toBe("Entry 1");
  });
});

describe("RssTool — generate", () => {
  it("RSS 피드 생성 → XML 반환", async () => {
    const r = await rss.execute({
      action: "generate",
      title: "My Feed",
      link: "https://myfeed.com",
      description: "My test feed",
      items: JSON.stringify([{ title: "Post 1", link: "https://myfeed.com/1", description: "First post" }]),
    });
    expect(r).toContain("<?xml");
    expect(r).toContain("My Feed");
    expect(r).toContain("Post 1");
  });

  it("items가 잘못된 JSON → Error 반환", async () => {
    const r = await rss.execute({ action: "generate", title: "Feed", items: "not-json" });
    expect(r).toContain("Error");
    expect(r).toContain("JSON");
  });

  it("items 없음 → 빈 피드 생성", async () => {
    const r = await rss.execute({ action: "generate", title: "Empty Feed" });
    expect(r).toContain("<?xml");
    expect(r).toContain("Empty Feed");
  });
});

describe("RssTool — add_item", () => {
  it("아이템 추가 → </channel> 전에 삽입", async () => {
    const item = JSON.stringify({ title: "New Article", link: "https://example.com/new", description: "Added item" });
    const r = await rss.execute({ action: "add_item", input: SAMPLE_RSS, item });
    expect(r).toContain("New Article");
    expect(r).toContain("https://example.com/new");
    expect(r).toContain("</channel>");
    // 기존 항목도 유지
    expect(r).toContain("Article 1");
  });

  it("잘못된 item JSON → Error 반환", async () => {
    const r = await rss.execute({ action: "add_item", input: SAMPLE_RSS, item: "bad json{" });
    expect(r).toContain("Error");
    expect(r).toContain("valid JSON");
  });

  it("invalid RSS (no </channel>) → Error 반환", async () => {
    const r = await rss.execute({ action: "add_item", input: "<rss><bad/></rss>", item: JSON.stringify({ title: "x", link: "" }) });
    expect(r).toContain("Error");
    expect(r).toContain("</channel>");
  });
});

describe("RssTool — fetch_parse", () => {
  it("url 없음 → Error 반환", async () => {
    const r = await rss.execute({ action: "fetch_parse", url: "" });
    expect(r).toContain("Error");
    expect(r).toContain("url");
  });

  it("fetch 성공 → 파싱 결과 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => SAMPLE_RSS,
    }));
    const r = await rss.execute({ action: "fetch_parse", url: "https://example.com/rss" });
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(2);
  });

  it("HTTP 오류 → error 필드 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const r = await rss.execute({ action: "fetch_parse", url: "https://example.com/rss" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("404");
  });

  it("fetch 예외 → error 필드 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const r = await rss.execute({ action: "fetch_parse", url: "https://example.com/rss" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("network error");
  });
});

describe("RssTool — unsupported action", () => {
  it("unsupported → Error 반환", async () => {
    const r = await rss.execute({ action: "subscribe" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});

// ══════════════════════════════════════════
// DatabaseTool
// ══════════════════════════════════════════

const tmp_ws = mkdtempSync(join(tmpdir(), "db-tool-test-"));
const ds_dir = join(tmp_ws, "runtime", "datasources");
mkdirSync(ds_dir, { recursive: true });

afterAll(() => { rmSync(tmp_ws, { recursive: true, force: true }); });

// SQLite 데이터베이스 생성 (better-sqlite3 직접 사용)
import Database from "better-sqlite3";
const db_path = join(ds_dir, "testdb.db");
const test_db = new Database(db_path);
test_db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
  INSERT INTO users VALUES (1, 'Alice', 30);
  INSERT INTO users VALUES (2, 'Bob', 25);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL);
  INSERT INTO orders VALUES (1, 1, 100.50);
`);
test_db.close();

function make_db_tool() {
  return new DatabaseTool({ workspace: tmp_ws });
}

describe("DatabaseTool — 메타데이터", () => {
  it("name = database", () => expect(make_db_tool().name).toBe("database"));
  it("category = memory", () => expect(make_db_tool().category).toBe("memory"));
  it("policy_flags: write=true", () => expect(make_db_tool().policy_flags.write).toBe(true));
  it("to_schema: function 형식", () => expect(make_db_tool().to_schema().type).toBe("function"));
});

describe("DatabaseTool — 유효성 검사", () => {
  it("datasource 없음 → Error 반환", async () => {
    const r = await make_db_tool().execute({ operation: "query", datasource: "" });
    expect(r).toContain("Error");
    expect(r).toContain("datasource");
  });

  it("잘못된 datasource 이름 → Error 반환", async () => {
    const r = await make_db_tool().execute({ operation: "query", datasource: "bad name!" });
    expect(r).toContain("Error");
    expect(r).toContain("alphanumeric");
  });

  it("존재하지 않는 datasource → Error 반환", async () => {
    const r = await make_db_tool().execute({ operation: "query", datasource: "nonexistent_xyz" });
    expect(r).toContain("Error");
    expect(r).toContain("not found");
  });
});

describe("DatabaseTool — query", () => {
  it("SELECT 쿼리 → rows 반환", async () => {
    const r = await make_db_tool().execute({ operation: "query", datasource: "testdb", sql: "SELECT * FROM users ORDER BY id" });
    const parsed = JSON.parse(r);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].name).toBe("Alice");
    expect(parsed.total).toBe(2);
  });

  it("sql 없음 → Error 반환", async () => {
    const r = await make_db_tool().execute({ operation: "query", datasource: "testdb", sql: "" });
    expect(r).toContain("Error");
    expect(r).toContain("sql");
  });

  it("DML 쿼리 → affected_rows 반환", async () => {
    const r = await make_db_tool().execute({
      operation: "query",
      datasource: "testdb",
      sql: "INSERT INTO users VALUES (99, 'Temp', 20)",
    });
    const parsed = JSON.parse(r);
    expect(parsed.affected_rows).toBe(1);
    // cleanup
    await make_db_tool().execute({ operation: "query", datasource: "testdb", sql: "DELETE FROM users WHERE id=99" });
  });

  it("max_rows 적용 → 제한된 rows 반환 + truncated=true", async () => {
    const r = await make_db_tool().execute({
      operation: "query",
      datasource: "testdb",
      sql: "SELECT * FROM users",
      max_rows: 1,
    });
    const parsed = JSON.parse(r);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.truncated).toBe(true);
  });

  it("잘못된 SQL → Error 반환", async () => {
    const r = await make_db_tool().execute({ operation: "query", datasource: "testdb", sql: "SELECT * FROM nonexistent_table" });
    expect(r).toContain("Error");
  });
});

describe("DatabaseTool — tables", () => {
  it("테이블 목록 반환", async () => {
    const r = await make_db_tool().execute({ operation: "tables", datasource: "testdb" });
    const parsed = JSON.parse(r);
    expect(parsed.tables.some((t: Record<string, unknown>) => t["name"] === "users")).toBe(true);
    expect(parsed.tables.some((t: Record<string, unknown>) => t["name"] === "orders")).toBe(true);
  });
});

describe("DatabaseTool — schema", () => {
  it("테이블 스키마 반환", async () => {
    const r = await make_db_tool().execute({ operation: "schema", datasource: "testdb", table: "users" });
    const parsed = JSON.parse(r);
    expect(parsed.table).toBe("users");
    expect(parsed.columns.some((c: Record<string, unknown>) => c["name"] === "name")).toBe(true);
  });

  it("table 없음 → Error 반환", async () => {
    const r = await make_db_tool().execute({ operation: "schema", datasource: "testdb", table: "" });
    expect(r).toContain("Error");
    expect(r).toContain("table");
  });

  it("잘못된 table 이름 → Error 반환", async () => {
    const r = await make_db_tool().execute({ operation: "schema", datasource: "testdb", table: "bad name!" });
    expect(r).toContain("Error");
    expect(r).toContain("invalid table name");
  });
});

describe("DatabaseTool — explain", () => {
  it("쿼리 플랜 반환", async () => {
    const r = await make_db_tool().execute({ operation: "explain", datasource: "testdb", sql: "SELECT * FROM users WHERE id=1" });
    const parsed = JSON.parse(r);
    expect(parsed.query).toContain("SELECT");
    expect(Array.isArray(parsed.plan)).toBe(true);
  });

  it("sql 없음 → Error 반환", async () => {
    const r = await make_db_tool().execute({ operation: "explain", datasource: "testdb", sql: "" });
    expect(r).toContain("Error");
  });
});

describe("DatabaseTool — unsupported operation", () => {
  it("unsupported → Error 반환", async () => {
    const r = await make_db_tool().execute({ operation: "drop", datasource: "testdb" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});
