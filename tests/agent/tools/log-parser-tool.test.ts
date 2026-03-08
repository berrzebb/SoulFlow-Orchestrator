/**
 * LogParserTool — 구조화 로그 파싱 테스트 (JSON/Apache/Nginx/syslog/custom/filter/stats/tail).
 */
import { describe, it, expect } from "vitest";
import { LogParserTool } from "../../../src/agent/tools/log-parser.js";

const tool = new LogParserTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const JSON_LINES = [
  JSON.stringify({ level: "info", message: "Server started", ts: 1000 }),
  JSON.stringify({ level: "warn", message: "High memory", ts: 2000 }),
  JSON.stringify({ level: "error", message: "DB failed", ts: 3000 }),
].join("\n");

const APACHE_LINE = '127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326';
const APACHE_DASH = '192.168.1.1 - - [01/Jan/2024:00:00:00 +0000] "POST /api HTTP/1.1" 201 -';

const NGINX_LINE = '10.0.0.1 - alice [01/Feb/2024:12:00:00 +0000] "GET /index.html HTTP/1.1" 200 1024 "https://example.com" "Mozilla/5.0"';

const SYSLOG_LINE = "Mar  1 10:23:45 myhost sshd[1234]: Accepted password for user";
const SYSLOG_NO_PID = "Mar  1 10:23:45 myhost kernel: eth0: link up";

describe("LogParserTool — parse_json", () => {
  it("유효한 JSON 라인 파싱", async () => {
    const r = await exec({ action: "parse_json", input: JSON_LINES }) as Record<string, unknown>;
    expect(r.count).toBe(3);
    expect((r.records as unknown[]).length).toBe(3);
    expect(r.errors).toBe(0);
  });

  it("비JSON 라인은 errors 로 계산", async () => {
    const input = `${JSON.stringify({ level: "info" })}\nnot json\nalso not json`;
    const r = await exec({ action: "parse_json", input }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    expect(r.errors).toBe(2);
  });

  it("빈 입력 → count 0", async () => {
    const r = await exec({ action: "parse_json", input: "" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });
});

describe("LogParserTool — parse_apache", () => {
  it("Apache Combined Log Format 파싱", async () => {
    const r = await exec({ action: "parse_apache", input: APACHE_LINE }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    const rec = (r.records as Record<string, unknown>[])[0];
    expect(rec.ip).toBe("127.0.0.1");
    expect(rec.method).toBe("GET");
    expect(rec.path).toBe("/apache_pb.gif");
    expect(rec.status).toBe(200);
    expect(rec.size).toBe(2326);
  });

  it("size가 - 인 경우 0으로 처리", async () => {
    const r = await exec({ action: "parse_apache", input: APACHE_DASH }) as Record<string, unknown>;
    const rec = (r.records as Record<string, unknown>[])[0];
    expect(rec.size).toBe(0);
    expect(rec.status).toBe(201);
  });

  it("잘못된 형식 → count 0", async () => {
    const r = await exec({ action: "parse_apache", input: "not apache log" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });
});

describe("LogParserTool — parse_nginx", () => {
  it("Nginx access log 파싱", async () => {
    const r = await exec({ action: "parse_nginx", input: NGINX_LINE }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    const rec = (r.records as Record<string, unknown>[])[0];
    expect(rec.ip).toBe("10.0.0.1");
    expect(rec.user).toBe("alice");
    expect(rec.method).toBe("GET");
    expect(rec.path).toBe("/index.html");
    expect(rec.status).toBe(200);
    expect(rec.size).toBe(1024);
    expect(rec.referer).toBe("https://example.com");
  });

  it("잘못된 형식 → count 0", async () => {
    const r = await exec({ action: "parse_nginx", input: "bad line" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });
});

describe("LogParserTool — parse_syslog", () => {
  it("syslog with PID 파싱", async () => {
    const r = await exec({ action: "parse_syslog", input: SYSLOG_LINE }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    const rec = (r.records as Record<string, unknown>[])[0];
    expect(rec.host).toBe("myhost");
    expect(rec.program).toBe("sshd");
    expect(rec.pid).toBe(1234);
    expect(String(rec.message)).toContain("Accepted password");
  });

  it("PID 없는 syslog 파싱", async () => {
    const r = await exec({ action: "parse_syslog", input: SYSLOG_NO_PID }) as Record<string, unknown>;
    const rec = (r.records as Record<string, unknown>[])[0];
    expect(rec.pid).toBeNull();
    expect(rec.program).toBe("kernel");
  });
});

describe("LogParserTool — parse_custom", () => {
  it("named group 패턴으로 파싱", async () => {
    const input = "2024-01-01 ERROR Something failed";
    const r = await exec({
      action: "parse_custom",
      input,
      pattern: "(?<date>\\d{4}-\\d{2}-\\d{2}) (?<level>\\w+) (?<message>.+)",
    }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    const rec = (r.records as Record<string, unknown>[])[0] as Record<string, string>;
    expect(rec.date).toBe("2024-01-01");
    expect(rec.level).toBe("ERROR");
    expect(rec.message).toBe("Something failed");
  });

  it("패턴 없음 → Error", async () => {
    const r = String(await exec({ action: "parse_custom", input: "test", pattern: "" }));
    expect(r).toContain("Error");
  });

  it("잘못된 정규식 → Error", async () => {
    const r = String(await exec({ action: "parse_custom", input: "test", pattern: "[invalid" }));
    expect(r).toContain("Error");
  });

  it("named group 없는 패턴 → groups 배열 반환", async () => {
    const r = await exec({
      action: "parse_custom",
      input: "GET /path",
      pattern: "(GET|POST) (/\\S+)",
    }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    const rec = (r.records as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(Array.isArray(rec.groups)).toBe(true);
  });
});

describe("LogParserTool — filter", () => {
  it("level 기준 필터링 (warn 이상)", async () => {
    const r = await exec({ action: "filter", input: JSON_LINES, level: "warn" }) as Record<string, unknown>;
    expect(r.total).toBe(3);
    expect(r.count).toBe(2); // warn, error
  });

  it("error 이상만 필터링", async () => {
    const r = await exec({ action: "filter", input: JSON_LINES, level: "error" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
  });

  it("field + value 필터링", async () => {
    const r = await exec({ action: "filter", input: JSON_LINES, field: "level", value: "info" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
  });

  it("field만 지정 (존재 여부)", async () => {
    const input = [
      JSON.stringify({ level: "info", extra: "yes" }),
      JSON.stringify({ level: "warn" }),
    ].join("\n");
    const r = await exec({ action: "filter", input, field: "extra" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
  });

  it("아무 조건 없음 → 전체 반환", async () => {
    const r = await exec({ action: "filter", input: JSON_LINES }) as Record<string, unknown>;
    expect(r.count).toBe(r.total);
  });
});

describe("LogParserTool — stats", () => {
  it("레벨별 통계", async () => {
    const r = await exec({ action: "stats", input: JSON_LINES }) as Record<string, unknown>;
    expect(r.total).toBe(3);
    expect(r.parse_errors).toBe(0);
    const by_level = r.by_level as Record<string, number>;
    expect(by_level.info).toBe(1);
    expect(by_level.warn).toBe(1);
    expect(by_level.error).toBe(1);
  });

  it("parse 오류 포함 통계", async () => {
    const input = JSON.stringify({ level: "info" }) + "\nbad line";
    const r = await exec({ action: "stats", input }) as Record<string, unknown>;
    expect(r.parse_errors).toBe(1);
    expect(r.total).toBe(1);
  });

  it("severity 필드 폴백", async () => {
    const input = JSON.stringify({ severity: "fatal", message: "crash" });
    const r = await exec({ action: "stats", input }) as Record<string, unknown>;
    const by_level = r.by_level as Record<string, number>;
    expect(by_level.fatal).toBe(1);
  });
});

describe("LogParserTool — tail", () => {
  it("마지막 N 라인 반환", async () => {
    const r = await exec({ action: "tail", input: JSON_LINES, count: 2 }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    const records = r.records as Record<string, unknown>[];
    expect(records[0].level).toBe("warn");
    expect(records[1].level).toBe("error");
  });

  it("count 기본값 (20)", async () => {
    const lines = Array.from({ length: 5 }, (_, i) => JSON.stringify({ i })).join("\n");
    const r = await exec({ action: "tail", input: lines }) as Record<string, unknown>;
    expect(r.count).toBe(5);
  });

  it("비JSON 라인은 raw 필드로 포함", async () => {
    const input = "raw log line";
    const r = await exec({ action: "tail", input }) as Record<string, unknown>;
    const records = r.records as Record<string, unknown>[];
    expect(records[0]).toEqual({ raw: "raw log line" });
  });
});
